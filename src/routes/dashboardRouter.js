import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

const TZ = 'America/Guayaquil';

/**
 * GET /api/dashboard/stats?date=YYYY-MM-DD
 * Estadísticas del día para el DashboardPage principal.
 * - Ventas: lee pos_orders.total directamente (no depende de pos_payments)
 * - Gastos: tabla expenses
 * - Pendientes: órdenes en estado pending / open / in_progress
 */
router.get('/stats', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const targetDate = req.query.date
      || new Date().toLocaleDateString('en-CA', { timeZone: TZ });

    // ── Ventas del día ──────────────────────────────────────────────────────
    const salesRes = await query(
      `SELECT
         COUNT(*)::INT                    AS tickets_count,
         COALESCE(SUM(total), 0)::FLOAT   AS total_cobrado
       FROM "${schema}".pos_orders
       WHERE status = 'paid'
         AND DATE(created_at AT TIME ZONE '${TZ}') = $1`,
      [targetDate]
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

    // ── Órdenes pendientes de cobro ─────────────────────────────────────────
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

    // ── Ventas de los últimos 30 días (para contexto) ───────────────────────
    let salesMonth = 0;
    try {
      const mRes = await query(
        `SELECT COALESCE(SUM(total), 0)::FLOAT AS total
         FROM "${schema}".pos_orders
         WHERE status = 'paid'
           AND created_at AT TIME ZONE '${TZ}' >= (CURRENT_DATE - INTERVAL '29 days') AT TIME ZONE '${TZ}'`,
        []
      );
      salesMonth = Number(mRes.rows[0]?.total) || 0;
    } catch (_) {}

    const sales = salesRes.rows[0] || { tickets_count: 0, total_cobrado: 0 };

    res.json({
      ok: true,
      data: {
        tickets_count:  Number(sales.tickets_count)  || 0,
        total_cobrado:  Number(sales.total_cobrado)  || 0,
        expenses_total: expensesTotal,
        pending_count:  pendingCount,
        sales_month:    salesMonth,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
