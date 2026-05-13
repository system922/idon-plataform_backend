import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

const TZ = 'America/Guayaquil';

/**
 * GET /api/dashboard/debug
 * Diagnóstico: muestra los últimos 10 registros de pos_orders y sus status/fechas.
 */
router.get('/debug', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

    const rawRows = await query(`
      SELECT id, status, total, created_at,
             created_at::date                                  AS cast_date,
             DATE(created_at AT TIME ZONE '${TZ}')            AS tz_date,
             created_at AT TIME ZONE '${TZ}'                  AS local_ts
      FROM "${schema}".pos_orders
      ORDER BY created_at DESC
      LIMIT 10
    `);

    const statusCount = await query(`
      SELECT status, COUNT(*) AS cnt
      FROM "${schema}".pos_orders
      GROUP BY status
    `);

    const paidToday_cast = await query(`
      SELECT COUNT(*)::INT AS cnt, COALESCE(SUM(total),0)::FLOAT AS total
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND created_at::date = $1::date
    `, [today]);

    const paidToday_tz = await query(`
      SELECT COUNT(*)::INT AS cnt, COALESCE(SUM(total),0)::FLOAT AS total
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE '${TZ}') = $1
    `, [today]);

    res.json({
      server_today: today,
      server_now_utc: new Date().toISOString(),
      status_counts: statusCount.rows,
      paid_today_direct_cast: paidToday_cast.rows[0],
      paid_today_tz_convert: paidToday_tz.rows[0],
      last_10_orders: rawRows.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/dashboard/stats
 * Estadísticas del día para el DashboardPage principal.
 */
router.get('/stats', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

    // ── DIAGNÓSTICO: ver todos los status y las últimas órdenes ──
    const diagRes = await query(`
      SELECT status, COUNT(*)::INT AS cnt,
             MAX(created_at) AS ultima,
             MAX(DATE(created_at AT TIME ZONE '${TZ}')) AS ultima_fecha_tz
      FROM "${schema}".pos_orders
      GROUP BY status
      ORDER BY cnt DESC
    `);
    console.log('[dashboard/stats] schema:', schema, '| today:', today);
    console.log('[dashboard/stats] status_counts:', JSON.stringify(diagRes.rows));
    // ────────────────────────────────────────────────────────────

    const salesRes = await query(`
      SELECT
        COUNT(*)::INT                    AS tickets_count,
        COALESCE(SUM(total), 0)::FLOAT   AS total_cobrado
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE '${TZ}') = $1
    `, [today]);

    const monthRes = await query(`
      SELECT COALESCE(SUM(total), 0)::FLOAT AS total
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE '${TZ}') >= ($1::date - INTERVAL '29 days')
    `, [today]);

    let expensesTotal = 0;
    try {
      const expRes = await query(`
        SELECT COALESCE(SUM(amount), 0)::FLOAT AS total
        FROM "${schema}".expenses
        WHERE DATE(date) = $1
      `, [today]);
      expensesTotal = Number(expRes.rows[0]?.total) || 0;
    } catch (_) {}

    let pendingCount = 0;
    try {
      const pendRes = await query(`
        SELECT COUNT(*)::INT AS count
        FROM "${schema}".pos_orders
        WHERE status IN ('pending', 'open', 'in_progress')
      `);
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
        sales_month:    Number(monthRes.rows[0]?.total) || 0,
        debug_date:     today,
        debug_status_counts: diagRes.rows,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
