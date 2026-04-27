import { query }          from '../config/database.js';
import { getSchemaName }  from '../utils/tenantHelper.js';
import { applyDateRange } from '../utils/queryHelpers.js';

export const getSalesByDay = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const params = [];
    let sql = `
      SELECT to_char(o.created_at, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(p.amount), 0)           AS total
      FROM "${schema}".pos_orders  o
      JOIN "${schema}".pos_payments p ON p.order_id = o.id
      WHERE o.status = 'paid'
        AND p.status = 'completed'
    `;
    sql = applyDateRange(sql, params, req.query, 'o.created_at');
    sql += ` GROUP BY day ORDER BY day ASC`;

    const { rows } = await query(sql, params);
    res.json(rows.map(r => ({ day: r.day, total: Number(r.total) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPurchasesByDay = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const params = [];
    let sql = `SELECT to_char(date, 'YYYY-MM-DD') AS day, SUM(amount) AS total FROM "${schema}".expenses WHERE 1=1`;
    sql = applyDateRange(sql, params, req.query, 'date');
    sql += ` GROUP BY day ORDER BY day`;

    const { rows } = await query(sql, params);
    res.json(rows.map(r => ({ day: r.day, total: Number(r.total) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getHoursByDay = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const params = [];
    let sql = `SELECT to_char(date, 'YYYY-MM-DD') AS day, SUM(hours) AS hours FROM "${schema}".work_logs WHERE 1=1`;
    sql = applyDateRange(sql, params, req.query, 'date');
    sql += ` GROUP BY day ORDER BY day`;

    const { rows } = await query(sql, params);
    res.json(rows.map(r => ({ day: r.day, hours: Number(r.hours) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};