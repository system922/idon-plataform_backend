import { readdir, readFile, access } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { getClient } from '../config/database.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper para verificar existencia de directorio
const exists = async (p) => {
  try { await access(p); return true; }
  catch { return false; }
};

export const migrateControlPlane = async () => {
  // ── Step 1: Run schema migrations (one transaction) ──────────────────────
  const migClient = await getClient();
  try {
    await migClient.query('BEGIN');

    const controlPlaneMigrationsDir = path.join(__dirname, 'migrations', 'control-plane');
    const files = await readdir(controlPlaneMigrationsDir);
    const sortedFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sortedFiles) {
      const filePath = path.join(controlPlaneMigrationsDir, file);
      const sql = await readFile(filePath, 'utf-8');
      logger.info(`Running control-plane migration: ${file}`);
      await migClient.query(sql);
    }

    await migClient.query('COMMIT');
    logger.info('Control-plane migrations completed');
  } catch (error) {
    await migClient.query('ROLLBACK');
    logger.error({ err: error }, 'Control-plane migration failed');
    throw error;
  } finally {
    migClient.release();
  }

  // ── Step 2: Register PL/pgSQL functions (separate transaction) ───────────
  // Runs independently so a migration hiccup never blocks function updates.
  const fnClient = await getClient();
  try {
    const functionsDir = path.join(__dirname, 'functions');
    if (!(await exists(functionsDir))) return;

    const fnFiles = (await readdir(functionsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of fnFiles) {
      const fnPath = path.join(functionsDir, file);
      const fnSql = await readFile(fnPath, 'utf-8');
      logger.info(`Registering DB function: ${file}`);
      // Each function is CREATE OR REPLACE — runs outside the migration txn
      await fnClient.query('BEGIN');
      await fnClient.query(fnSql);
      await fnClient.query('COMMIT');
    }

    logger.info('Control-plane migrations completed successfully');
  } catch (error) {
    await fnClient.query('ROLLBACK').catch(() => {});
    logger.error({ err: error }, 'DB function registration failed');
    throw error;
  } finally {
    fnClient.release();
  }
};

// El resto de tus métodos no cambia (puedes mantenerlos igual):

export const migrateTenant = async (schemaName) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
    await migrateTenantModule(client, schemaName, 'core'); // core siempre requerido
    await client.query('COMMIT');
    logger.info(`Tenant schema ${schemaName} migrated successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Tenant migration for ${schemaName} failed:`, error);
    throw error;
  } finally {
    client.release();
  }
};

export const migrateTenantModule = async (client, schemaName, moduleName) => {
  const moduleDir = path.join(__dirname, 'migrations', 'tenant', moduleName);
  try {
    const files = await readdir(moduleDir);
    const sortedFiles = files.filter(f => f.endsWith('.sql')).sort();

    // Collect already-applied versions (schema_migrations may not exist yet for 'core')
    let applied = new Set();
    try {
      const { rows } = await client.query(
        `SELECT version FROM "${schemaName}".schema_migrations WHERE module = $1`,
        [moduleName]
      );
      applied = new Set(rows.map(r => r.version));
    } catch {
      // schema_migrations doesn't exist yet — will be created by the first core migration
    }

    for (const file of sortedFiles) {
      const version = `${moduleName}_${file.replace('.sql', '')}`;
      if (applied.has(version)) continue;  // already applied, skip

      const filePath = path.join(moduleDir, file);
      const sql = await readFile(filePath, 'utf-8');
      const processedSql = sql.replace(/{SCHEMA}/g, schemaName);
      logger.info(`Running tenant migration: ${moduleName}/${file}`);
      await client.query(processedSql);
      await client.query(
        `INSERT INTO "${schemaName}".schema_migrations (version, module, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (version) DO NOTHING`,
        [version, moduleName, file]
      );
    }
  } catch (error) {
    logger.error(`Error migrating module ${moduleName} for schema ${schemaName}:`, error);
    throw error;
  }
};

export const rollbackTenant = async (schemaName) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await client.query('DELETE FROM public.businesses WHERE schema_name = $1', [schemaName]);
    await client.query('COMMIT');
    logger.info(`Tenant schema ${schemaName} rolled back successfully`);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error(`Tenant rollback for ${schemaName} failed:`, error);
    throw error;
  } finally {
    client.release();
  }
};