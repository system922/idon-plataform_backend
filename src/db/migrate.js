// src/db/migrate.js
import { readdir, readFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { getClient, query } from '../config/database.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper para verificar existencia de directorio
const exists = async (p) => {
  try { await access(p); return true; }
  catch { return false; }
};

// ============================================================
// OBTENER MÓDULOS ACTIVOS DEL TENANT
// ============================================================
const getActiveModules = async (schemaName) => {
  try {
    // Verificar si el tenant tiene la tabla business_modules en el schema public
    const result = await query(`
      SELECT m.code 
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      JOIN public.businesses b ON bm.business_id = b.id
      WHERE b.schema_name = $1 AND bm.is_active = true
    `, [schemaName]);
    
    const modules = result.rows.map(row => row.code);
    logger.info(`📦 Módulos activos para ${schemaName}: ${modules.join(', ')}`);
    return modules;
  } catch (error) {
    logger.warn(`⚠️ No se pudo obtener módulos activos para ${schemaName}, usando core solamente:`, error.message);
    return ['core'];
  }
};

// ============================================================
// MIGRAR TENANT - SOLO MÓDULOS ACTIVOS
// ============================================================
export const migrateTenant = async (schemaName) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    
    // Crear schema si no existe
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    
    // Obtener módulos activos del tenant
    const activeModules = await getActiveModules(schemaName);
    
    // Siempre migrar core primero
    const modulesToMigrate = ['core', ...activeModules.filter(m => m !== 'core')];
    
    for (const moduleName of modulesToMigrate) {
      await migrateTenantModule(client, schemaName, moduleName);
    }
    
    await client.query('COMMIT');
    logger.info(`✅ Tenant schema ${schemaName} migrated successfully with modules: ${modulesToMigrate.join(', ')}`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`❌ Tenant migration for ${schemaName} failed:`, error);
    throw error;
  } finally {
    client.release();
  }
};

// ============================================================
// MIGRAR MÓDULO ESPECÍFICO DEL TENANT
// ============================================================
export const migrateTenantModule = async (client, schemaName, moduleName) => {
  const moduleDir = path.join(__dirname, 'migrations', 'tenant', moduleName);
  
  // Verificar si el directorio del módulo existe
  if (!(await exists(moduleDir))) {
    logger.warn(`⚠️ Módulo ${moduleName} no tiene migraciones, saltando`);
    return;
  }
  
  try {
    const files = await readdir(moduleDir);
    const sortedFiles = files.filter(f => f.endsWith('.sql')).sort();

    // Crear tabla de migraciones si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(50) NOT NULL UNIQUE,
        module VARCHAR(100) NOT NULL,
        description TEXT,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Obtener migraciones ya aplicadas
    let applied = new Set();
    try {
      const { rows } = await client.query(
        `SELECT version FROM "${schemaName}".schema_migrations WHERE module = $1`,
        [moduleName]
      );
      applied = new Set(rows.map(r => r.version));
    } catch {
      // Si la tabla no existe, se creó arriba
    }

    for (const file of sortedFiles) {
      const version = `${moduleName}_${file.replace('.sql', '')}`;
      if (applied.has(version)) {
        logger.debug(`⏭️ Saltando migración ya aplicada: ${file}`);
        continue;
      }

      const filePath = path.join(moduleDir, file);
      const sql = await readFile(filePath, 'utf-8');
      const processedSql = sql.replace(/{SCHEMA}/g, schemaName);
      
      logger.info(`📦 Ejecutando migración: ${moduleName}/${file}`);
      
      try {
        await client.query(processedSql);
        await client.query(
          `INSERT INTO "${schemaName}".schema_migrations (version, module, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (version) DO NOTHING`,
          [version, moduleName, file]
        );
        logger.info(`✅ Migración completada: ${file}`);
      } catch (err) {
        // Si el error es porque la tabla no existe, omitir y continuar
        if (err.message && err.message.includes('does not exist')) {
          logger.warn(`⚠️ Tabla no existe en ${moduleName}/${file}, omitiendo: ${err.message}`);
          continue;
        }
        throw err;
      }
    }
  } catch (error) {
    logger.error(`❌ Error migrating module ${moduleName} for schema ${schemaName}:`, error);
    throw error;
  }
};

// ============================================================
// MIGRAR CONTROL PLANE
// ============================================================
export const migrateControlPlane = async () => {
  // ── Step 1: Run schema migrations (one transaction) ──────────────────────
  const migClient = await getClient();
  try {
    await migClient.query('BEGIN');

    const controlPlaneMigrationsDir = path.join(__dirname, 'migrations', 'control-plane');
    
    if (await exists(controlPlaneMigrationsDir)) {
      const files = await readdir(controlPlaneMigrationsDir);
      const sortedFiles = files.filter(f => f.endsWith('.sql')).sort();

      for (const file of sortedFiles) {
        const filePath = path.join(controlPlaneMigrationsDir, file);
        const sql = await readFile(filePath, 'utf-8');
        logger.info(`📦 Running control-plane migration: ${file}`);
        await migClient.query(sql);
      }
    }

    await migClient.query('COMMIT');
    logger.info('✅ Control-plane migrations completed');
  } catch (error) {
    await migClient.query('ROLLBACK');
    logger.error({ err: error }, '❌ Control-plane migration failed');
    throw error;
  } finally {
    migClient.release();
  }

  // ── Step 2: Register PL/pgSQL functions (separate transaction) ───────────
  const fnClient = await getClient();
  try {
    const functionsDir = path.join(__dirname, 'functions');
    if (await exists(functionsDir)) {
      const fnFiles = (await readdir(functionsDir)).filter(f => f.endsWith('.sql')).sort();
      for (const file of fnFiles) {
        const fnPath = path.join(functionsDir, file);
        const fnSql = await readFile(fnPath, 'utf-8');
        logger.info(`📦 Registering DB function: ${file}`);
        await fnClient.query('BEGIN');
        await fnClient.query(fnSql);
        await fnClient.query('COMMIT');
      }
    }
    logger.info('✅ Control-plane migrations completed successfully');
  } catch (error) {
    await fnClient.query('ROLLBACK').catch(() => {});
    logger.error({ err: error }, '❌ DB function registration failed');
    throw error;
  } finally {
    fnClient.release();
  }
};

// ============================================================
// ROLLBACK TENANT
// ============================================================
export const rollbackTenant = async (schemaName) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await client.query('DELETE FROM public.businesses WHERE schema_name = $1', [schemaName]);
    await client.query('COMMIT');
    logger.info(`✅ Tenant schema ${schemaName} rolled back successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`❌ Tenant rollback for ${schemaName} failed:`, error);
    throw error;
  } finally {
    client.release();
  }
};

// ============================================================
// MAIN - EJECUTAR MIGRACIONES
// ============================================================
const run = async () => {
  try {
    // Primero migrar control plane
    await migrateControlPlane();
    
    // Luego migrar tenants existentes
    const tenants = await query(`
      SELECT schema_name FROM public.businesses WHERE is_active = true
    `);
    
    for (const tenant of tenants.rows) {
      if (tenant.schema_name) {
        try {
          await migrateTenant(tenant.schema_name);
        } catch (err) {
          logger.error(`❌ Error migrando tenant ${tenant.schema_name}:`, err.message);
        }
      }
    }
    
    logger.info('✅ Todas las migraciones completadas');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Error en migraciones:', error);
    process.exit(1);
  }
};

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  run();
}