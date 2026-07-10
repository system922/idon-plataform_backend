// src/services/auditLogService.js
import db from '../config/database.js';

// ============================================================
// CREAR LOG DE AUDITORÍA
// ============================================================
export const createAuditLog = async (schema, data) => {
  const {
    user_id,
    table_name,
    action,
    record_id,
    old_values,
    new_values,
    description
  } = data;

  const sql = `
    INSERT INTO "${schema}".audit_logs (
      user_id,
      table_name,
      action,
      record_id,
      old_values,
      new_values,
      description,
      created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    RETURNING *
  `;

  const result = await db.query(sql, [
    user_id,
    table_name,
    action,
    record_id,
    old_values ? JSON.stringify(old_values) : null,
    new_values ? JSON.stringify(new_values) : null,
    description || null
  ]);

  return result.rows[0];
};

// ============================================================
// LISTAR LOGS DE AUDITORÍA
// ============================================================
export const listAuditLogs = async (schema, filters = {}) => {
  const { table_name, action, user_id, limit = 100 } = filters;
  
  let sql = `
    SELECT * FROM "${schema}".audit_logs
    WHERE 1=1
  `;
  const values = [];
  let idx = 1;

  if (table_name) {
    sql += ` AND table_name = $${idx++}`;
    values.push(table_name);
  }
  if (action) {
    sql += ` AND action = $${idx++}`;
    values.push(action);
  }
  if (user_id) {
    sql += ` AND user_id = $${idx++}`;
    values.push(user_id);
  }

  sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
  values.push(limit);

  const result = await db.query(sql, values);
  return result.rows;
};

// ============================================================
// LISTAR LOGS CON INFORMACIÓN DE USUARIO
// ============================================================
export const listAuditLogsWithUser = async (schema, filters = {}) => {
  const { table_name, action, user_id, limit = 100 } = filters;
  
  let sql = `
    SELECT 
      al.*,
      u.email,
      u.full_name
    FROM "${schema}".audit_logs al
    LEFT JOIN "${schema}".users u ON al.user_id = u.id
    WHERE 1=1
  `;
  const values = [];
  let idx = 1;

  if (table_name) {
    sql += ` AND al.table_name = $${idx++}`;
    values.push(table_name);
  }
  if (action) {
    sql += ` AND al.action = $${idx++}`;
    values.push(action);
  }
  if (user_id) {
    sql += ` AND al.user_id = $${idx++}`;
    values.push(user_id);
  }

  sql += ` ORDER BY al.created_at DESC LIMIT $${idx}`;
  values.push(limit);

  const result = await db.query(sql, values);
  return result.rows;
};