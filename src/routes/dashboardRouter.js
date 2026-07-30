import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

// ─── Función para obtener fecha de Ecuador en formato YYYY-MM-DD ──────────
function getEcuadorDate() {
  const now = new Date();
  // Ecuador está en UTC-5 todo el año
  const ecuadorDate = new Date(now.getTime() - (5 * 60 * 60 * 1000));
  
  const year = ecuadorDate.getUTCFullYear();
  const month = String(ecuadorDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ecuadorDate.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * GET /api/dashboard/debug
 * Diagnóstico: muestra los últimos 10 registros de pos_orders y sus status/fechas.
 */
router.get('/debug', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const today = getEcuadorDate();
    
    // También obtenemos la fecha actual en diferentes formatos para depuración
    const now = new Date();
    const ecuadorNow = new Date(now.getTime() - (5 * 60 * 60 * 1000));

    const rawRows = await query(`
      SELECT 
        id, 
        status, 
        total, 
        created_at,
        created_at::date AS cast_date,
        DATE(created_at AT TIME ZONE 'America/Guayaquil') AS tz_date,
        created_at AT TIME ZONE 'America/Guayaquil' AS local_ts
      FROM "${schema}".pos_orders
      ORDER BY created_at DESC
      LIMIT 10
    `);

    // Órdenes pagadas hoy (usando la función de Ecuador)
    const paidToday = await query(`
      SELECT 
        COUNT(*)::INT AS cnt, 
        COALESCE(SUM(total), 0)::FLOAT AS total
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE 'America/Guayaquil') = $1
    `, [today]);

    // Todas las órdenes de hoy (sin importar status)
    const allToday = await query(`
      SELECT 
        COUNT(*)::INT AS cnt,
        status,
        DATE(created_at AT TIME ZONE 'America/Guayaquil') AS fecha_local
      FROM "${schema}".pos_orders
      WHERE DATE(created_at AT TIME ZONE 'America/Guayaquil') = $1
      GROUP BY status, fecha_local
    `, [today]);

    // Órdenes de los últimos 7 días
    const last7Days = await query(`
      SELECT 
        DATE(created_at AT TIME ZONE 'America/Guayaquil') AS fecha,
        status,
        COUNT(*) AS total
      FROM "${schema}".pos_orders
      WHERE created_at >= (NOW() - INTERVAL '7 days')
      GROUP BY fecha, status
      ORDER BY fecha DESC
    `, []);

    res.json({
      debug_info: {
        server_utc_now: now.toISOString(),
        ecuador_now: ecuadorNow.toISOString(),
        today_ecuador: today,
        today_formatted: new Date(ecuadorNow).toLocaleString('es-EC', { timeZone: 'America/Guayaquil' })
      },
      paid_today: paidToday.rows[0] || { cnt: 0, total: 0 },
      all_orders_today: allToday.rows,
      orders_last_7_days: last7Days.rows,
      last_10_orders: rawRows.rows,
    });
  } catch (err) {
    console.error('Error en /debug:', err);
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

    const today = getEcuadorDate();
    console.log('📊 Estadísticas para fecha:', today);

    // ── Ventas de hoy (pagadas) ────────────────────────────────────────────
    const salesRes = await query(`
      SELECT
        COUNT(*)::INT AS tickets_count,
        COALESCE(SUM(total), 0)::FLOAT AS total_cobrado
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE 'America/Guayaquil') = $1
    `, [today]);

    console.log('Ventas hoy:', salesRes.rows[0]);

    // ── Ventas de los últimos 30 días ──────────────────────────────────────
    const monthRes = await query(`
      SELECT 
        COALESCE(SUM(total), 0)::FLOAT AS total,
        COUNT(*)::INT AS count
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND DATE(created_at AT TIME ZONE 'America/Guayaquil') >= ($1::date - INTERVAL '29 days')
        AND DATE(created_at AT TIME ZONE 'America/Guayaquil') <= $1::date
    `, [today]);

    console.log('Ventas últimos 30 días:', monthRes.rows[0]);

    // ── Gastos de hoy ───────────────────────────────────────────────────────
    let expensesTotal = 0;
    try {
      const expRes = await query(`
        SELECT COALESCE(SUM(amount), 0)::FLOAT AS total
        FROM "${schema}".expenses
        WHERE DATE(date AT TIME ZONE 'America/Guayaquil') = $1
      `, [today]);
      expensesTotal = Number(expRes.rows[0]?.total) || 0;
      console.log('Gastos hoy:', expensesTotal);
    } catch (err) {
      console.error('Error al obtener gastos:', err);
    }

    // ── Órdenes pendientes (TODOS excepto paid y draft) ──────────────────
    let pendingCount = 0;
    try {
      const pendRes = await query(`
        SELECT COUNT(*)::INT AS count
        FROM "${schema}".pos_orders
        WHERE status NOT IN ('paid', 'draft')
          AND DATE(created_at AT TIME ZONE 'America/Guayaquil') = $1
      `, [today]);
      pendingCount = Number(pendRes.rows[0]?.count) || 0;
      console.log('📊 Órdenes por cobrar hoy:', pendingCount);
    } catch (err) {
      console.error('Error al obtener pendientes:', err);
    }

    const sales = salesRes.rows[0] || { tickets_count: 0, total_cobrado: 0 };
    const month = monthRes.rows[0] || { total: 0, count: 0 };

    // ── Respuesta ───────────────────────────────────────────────────────────
    res.json({
      ok: true,
      data: {
        tickets_count:  Number(sales.tickets_count)  || 0,
        total_cobrado:  Number(sales.total_cobrado)  || 0,
        expenses_total: expensesTotal,
        pending_count:  pendingCount,
        sales_month:    Number(month.total) || 0,
        month_count:    Number(month.count) || 0,
        // Información de depuración
        _debug: {
          today_used: today,
          query_date: today
        }
      },
    });
  } catch (err) {
    console.error('Error en /stats:', err);
    res.status(500).json({ 
      ok: false, 
      error: err.message,
      stack: err.stack 
    });
  }
});

export default router;