/**
 * seed.js
 * Corre todos los seeds en orden.
 * Uso: node src/db/seed.js
 */

import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getClient } from '../config/database.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SEEDS_DIR = path.join(__dirname, 'migrations', 'seeds');

// Orden obligatorio por dependencias entre tablas
const SEEDS_ORDER = [
  'seed-business-types.sql',
  'seed-modules.sql',
  'seed-roles.sql',
  'seed-features.sql',       // depende de modules
  'seed-fiscal-config.sql',  // configuración fiscal Ecuador
];

const runSeeds = async () => {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    for (const file of SEEDS_ORDER) {
      const filePath = path.join(SEEDS_DIR, file);
      const sql = await readFile(filePath, 'utf-8');
      logger.info(`Running seed: ${file}`);
      await client.query(sql);
    }

    await client.query('COMMIT');
    logger.info('✅ Seeds completados correctamente');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('❌ Error en seeds:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
};

runSeeds();
