// src/services/cashRegisterService.js
import { query } from '../config/database.js';
import bcrypt from 'bcrypt';

// ------- SEGURIDAD -------
export async function findUserByEmail(schema, email) {
  const sql = `SELECT * FROM ${schema}.users WHERE email = $1 AND is_active = true LIMIT 1`;
  const result = await query(sql, [email]);
  return result.rows[0];
}

export async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

export async function getRoleById(schema, role_id) {
  const sql = `SELECT * FROM ${schema}.roles WHERE id = $1 LIMIT 1`;
  const result = await query(sql, [role_id]);
  return result.rows[0];
}

// ------- CAJA -------
export async function createCashEntry(schema, { efectivo, date }) {
  const sql = `
    INSERT INTO ${schema}.cash_register_openings (efectivo, date)
    VALUES ($1, $2)
    RETURNING *
  `;
  const result = await query(sql, [efectivo, date]);
  return result.rows[0];
}

export async function createBankEntry(schema, { banco, date, autorizado_por }) {
  const sql = `
    INSERT INTO ${schema}.cash_register_openings (banco, date, autorizado_por)
    VALUES ($1, $2, $3)
    RETURNING *
  `;
  const result = await query(sql, [banco, date, autorizado_por]);
  return result.rows[0];
}

export async function getOpeningByDate(schema, date) {
  const sql = `SELECT * FROM ${schema}.cash_register_openings WHERE date = $1 LIMIT 1`;
  const result = await query(sql, [date]);
  return result.rows[0] || null;
}