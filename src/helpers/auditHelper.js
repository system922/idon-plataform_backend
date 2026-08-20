// helpers/auditHelper.js
import { getClient } from '../config/database.js';

export async function logAudit(schema, data) {
  const {
    userId,
    userName,
    userEmail,
    tableName,
    action,      // 'INSERT', 'UPDATE', 'DELETE'
    oldValues,
    newValues,
    description
  } = data;

  const client = await getClient();
  try {
    await client.query(`
      INSERT INTO "${schema}".audit_logs 
      (user_id, user_name, user_email, table_name, action, record_id, old_values, new_values, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
    `, [
      userId || null,
      userName || 'Usuario',
      userEmail || null,
      tableName,
      action,
      null,  // ← record_id siempre NULL
      oldValues || null,
      newValues || null,
      description || `${action} en ${tableName}`
    ]);
    return true;
  } catch (err) {
    console.error('Error al registrar auditoría:', err);
    return false;
  } finally {
    client.release();
  }
}