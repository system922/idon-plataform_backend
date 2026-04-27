// src/models/cashRegisterModel.js
import { query } from '../config/database.js'; // <--- tu conexión pool PG
import bcrypt from 'bcrypt';

// Encuentra el usuario activo por email, en el schema correspondiente
export async function findUserByEmail(schema, email) {
  const sql = `SELECT * FROM ${schema}.users WHERE email = $1 AND is_active = true LIMIT 1`;
  const result = await query(sql, [email]);
  return result.rows[0];
}

// Chequea la contraseña (bcrypt)
export async function checkPassword(plain, hash) {
  return await bcrypt.compare(plain, hash);
}

// Obtiene el rol por ID, en el schema correspondiente
export async function getRoleById(schema, role_id) {
  const sql = `SELECT * FROM ${schema}.roles WHERE id = $1 LIMIT 1`;
  const result = await query(sql, [role_id]);
  return result.rows[0];
}

// Crea la apertura de efectivo
export async function createCashEntry(schema, { efectivo, date }) {
  // Puedes ajustar los campos si usas otros nombres
  const sql = `
    INSERT INTO ${schema}.cash_register_openings (efectivo, date)
    VALUES ($1, $2)
    RETURNING *
  `;
  const result = await query(sql, [efectivo, date]);
  return result.rows[0];
}

// Crea la apertura de banco/autorizado
export async function createBankEntry(schema, { banco, date, autorizado_por }) {
  const sql = `
    INSERT INTO ${schema}.cash_register_openings (banco, date, autorizado_por)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const result = await query(sql, [banco, date, autorizado_por]);
  return result.rows[0];
}