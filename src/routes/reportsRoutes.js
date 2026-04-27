import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';

const router = express.Router();

// GET /api/reports/sales-today?date=YYYY-MM-DD
router.get('/sales-today', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema)
      return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    const result = await query(
      `SELECT
         COUNT(DISTINCT o.id)::INT            AS tickets_count,
         COALESCE(SUM(p.amount),0)            AS total_cobrado
       FROM "${schema}".pos_orders o
       JOIN "${schema}".pos_payments p
         ON p.order_id = o.id
       WHERE DATE(o.created_at) = $1
         AND o.status = 'paid'
         AND p.status = 'completed'
      `,
      [date]
    );

    res.json(result.rows[0] || { tickets_count: 0, total_cobrado: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/pending
 */
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT COUNT(*)::INT AS count
       FROM "${schema}".pos_orders
       WHERE status IN ('pending','sent')`
    );

    res.json({ count: result.rows[0]?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;