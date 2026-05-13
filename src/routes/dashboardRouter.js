import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

/**
 * GET /api/dashboard/stats?date=YYYY-MM-DD
 * Estadísticas del día para el DashboardPage principal.
 * Lee pos_orders.total directamente — no depende de pos_payments.
 */
router.get('/stats', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const tz = 'America/Guayaquil';
    const targetDate = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: tz });

    // ── Ventas del día (desde pos_orders directamente) ──────────────────────
    const salesRes = await query(
      `SELECT
         COUNT(*)::INT                       AS tickets_count,
         COALESCE(SUM(total), 0)::FLOAT      AS total_cobrado
       FROM "${schema}".pos_orders
       WHERE status = 'paid'
         AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE $2) = $1`,
      [targetDate, tz]
    );

    // ── Gastos del día ──────────────────────────────────────────────────────
    let expensesTotal = 0;
    try {
      const expRes = await query(
        `SELECT COALESCE(SUM(amount), 0)::FLOAT AS total
         FROM "${schema}".expenses
         WHERE DATE(date) = $1`,
        [targetDate]
      );
      expensesTotal = Number(expRes.rows[0]?.total) || 0;
    } catch (_) {}

    // ── Órdenes pendientes ──────────────────────────────────────────────────
    let pendingCount = 0;
    try {
      const pendRes = await query(
        `SELECT COUNT(*)::INT AS count
         FROM "${schema}".pos_orders
         WHERE status IN ('pending', 'open', 'in_progress')`,
        []
      );
      pendingCount = Number(pendRes.rows[0]?.count) || 0;
    } catch (_) {}

    const sales = salesRes.rows[0] || { tickets_count: 0, total_cobrado: 0 };

    res.json({
      ok: true,
      data: {
        tickets_count:  Number(sales.tickets_count)  || 0,
        total_cobrado:  Number(sales.total_cobrado)  || 0,
        expenses_total: expensesTotal,
        pending_count:  pendingCount,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
