import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.database.connectionString,
});

// Establece zona horaria Ecuador en cada conexión del pool.
// Así NOW() y CURRENT_TIMESTAMP devuelven hora Ecuador y DATE() opera correctamente.
pool.on('connect', (client) => {
  client.query("SET timezone = 'America/Guayaquil'").catch((err) => {
    console.error('Error setting timezone on DB connection:', err.message);
  });
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export default pool;

export const query = async (text, params) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Executed query', { text, duration, rows: result.rowCount });
    return result;
  } catch (error) {
    console.error('Database error', { text, error });
    throw error;
  }
};

export const getClient = async () => {
  return pool.connect();
};
