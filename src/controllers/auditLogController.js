import db from '../config/database.js';
import * as auditLogService from '../services/auditLogService.js';
import { getSchemaName } from '../utils/tenantHelper.js';

// POST /api/audit-log
export const createAuditLog = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      table_name,
      action,
      record_id,
      old_values,
      new_values,
      description,
      user_id
    } = req.body;
    if (!user_id || !table_name || !action)
      return res.status(400).json({ error: 'user_id, table_name y action requeridos' });

    // Insertar auditoría
    const log = await auditLogService.createAuditLog(schema, {
      user_id,
      table_name,
      action,
      record_id,
      old_values,
      new_values,
      description
    });

    // --- Si es egreso por compra, guarda también en expenses ---
    let expense = null;
    if (
      action === 'drawer_expense' &&
      new_values &&
      typeof new_values.amount === 'number'
    ) {
      const insertQuery = `
        INSERT INTO "${schema}".expenses
          (date, category, description, amount, reference, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `;
      const today = new Date();
      const result = await db.query(insertQuery, [
        today,
        'Egreso de Caja',
        req.body.reason || '',   // <--- SOLO el campo motivo
        new_values.amount,
        log.id,
        user_id
      ]);
      expense = result.rows[0];
    }

    res.status(201).json({ log, expense });
  } catch (e) {
    console.error('Error registrando log de auditoría/gasto:', e);
    res.status(500).json({ error: 'Error registrando log de auditoría/gasto', detail: e.message });
  }
};

// Opcional: GET /api/audit
export const listAuditLogs = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { table_name, action, user_id, limit } = req.query;
    // Usa la función nueva:
    const logs = await auditLogService.listAuditLogsWithUser(schema, { table_name, action, user_id, limit });
    res.json({ logs });
  } catch (e) {
    res.status(500).json({ error: 'Error listando logs de auditoría', detail: e.message });
  }
};