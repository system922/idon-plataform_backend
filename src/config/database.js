import pg from 'pg';
import env from './env.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: env.database.connectionString,
});

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
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('Database error:', error.message);
    throw error;
  }
};

export const getClient = async () => {
  return pool.connect();
};