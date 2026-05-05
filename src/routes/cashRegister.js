import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware, businessContextMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';

// ===============================
// 🔥 HELPERS PRO
// ===============================
const n = (v) => {
  const num = Number(v);
  return isNaN(num) ? 0 : num;
};

const safe = (v) => (v == null || isNaN(v) ? 0 : v);

const router = express.Router();

/**
 * GET /api/pos/cash-register/full-closing?date=YYYY-MM-DD
 * Trae el último cierre del día
 */
router.get('/full-closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    const result = await query(
      `
      SELECT
        id,
        closing_user_id,
        closing_date,
        closing_time,
        cash_counted,
        cash_system,
        diff_cash,
        transfer_counted,
        transfer_system,
        diff_transfer,
        card_counted,
        card_system,
        diff_card,
        orders_counted,
        orders_system,
        diff_orders,
        extras,
        expenses_total,
        total_counted,
        total_system,
        diff_total,
        net_system,
        net_counted,
        diff_net,
        remarks,
        created_at
      FROM "${schema}".cash_register_closing
      WHERE closing_date = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [date]
    );

    if (result.rows.length === 0) return res.status(404).json({});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
* GET /api/pos/cash-register/summary?date=YYYY-MM-DD
* Trae el resumen (ventas por método como array, propinas, comandas, gastos)
*/
// ===============================
// 📊 SUMMARY
// ===============================
router.get('/summary', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const date = req.query.date || ecuadorToday();

    // ===============================
    // 💰 VENTAS POR MÉTODO
    // ===============================
    const ventasRes = await query(
      `
      WITH pagos_normalizados AS (
        SELECT
          CASE
            WHEN LOWER(pp.payment_method) IN ('cash','efectivo') THEN 'cash'
            WHEN LOWER(pp.payment_method) IN ('transfer','transferencia') THEN 'transfer'
            WHEN LOWER(pp.payment_method) IN ('card','tarjeta') THEN 'card'
            ELSE LOWER(pp.payment_method)
          END AS payment_method,
          pp.amount,
          pp.id
        FROM "${schema}".pos_orders po
        INNER JOIN "${schema}".pos_payments pp 
          ON pp.order_id = po.id
        WHERE
          DATE(po.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') = $1
          AND po.status IN ('paid','completed')
          AND pp.status = 'completed'
          AND pp.amount::text != 'NaN'
      ),
      metodos AS (
        SELECT 'cash' AS payment_method
        UNION ALL SELECT 'transfer'
        UNION ALL SELECT 'card'
      ),
      totales AS (
        SELECT
          payment_method,
          SUM(amount) AS total_cobrado,
          COUNT(id) AS cantidad_pagos
        FROM pagos_normalizados
        WHERE payment_method IN ('cash', 'transfer', 'card')
        GROUP BY payment_method
      )
      SELECT
        m.payment_method,
        COALESCE(t.total_cobrado, 0) AS total_cobrado,
        COALESCE(t.cantidad_pagos, 0) AS cantidad_pagos
      FROM metodos m
      LEFT JOIN totales t ON t.payment_method = m.payment_method
      `,
      [date]
    );

    // ===============================
    // 💸 GASTOS
    // ===============================
    const gastosRes = await query(
      `
      SELECT
        COALESCE(ec.name, e.description, 'Gasto') AS concepto,
        e.description,
        e.amount AS monto
      FROM "${schema}".expenses e
      LEFT JOIN "${schema}".expense_categories ec ON ec.id = e.category_id
      WHERE e.date = $1
      `,
      [date]
    );

    res.json({
      metodos: ventasRes.rows || [],
      gastos: gastosRes.rows || []
    });

  } catch (err) {
    console.error("❌ SUMMARY ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});


// ===============================
// 💾 CLOSING (ÚNICO Y CORRECTO)
// ===============================
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {

    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    // ===============================
    // 📥 INPUTS
    // ===============================
    const efectivoFisico      = n(req.body.efectivoFisico);
    const transferenciaFisico = n(req.body.transferenciaFisico);
    const tarjetaFisico       = n(req.body.tarjetaFisico);
    const propinaFisico       = n(req.body.propinaFisico);
    const comandasFisico      = n(req.body.comandasFisico);

    const date    = req.body.date || ecuadorToday();
    const remarks = req.body.remarks || '';

    // ===============================
    // 📊 SYSTEM
    // ===============================
    const summary = await query(
      `
      SELECT
        COALESCE(SUM(CASE
          WHEN LOWER(pp.payment_method) IN ('cash','efectivo')
          AND pp.status = 'completed'
          AND pp.amount::text != 'NaN'
        THEN pp.amount END), 0) AS cash_system,

        COALESCE(SUM(CASE
          WHEN LOWER(pp.payment_method) IN ('transfer','transferencia')
          AND pp.status = 'completed'
          AND pp.amount::text != 'NaN'
        THEN pp.amount END), 0) AS transfer_system,

        COALESCE(SUM(CASE
          WHEN LOWER(pp.payment_method) IN ('card','tarjeta')
          AND pp.status = 'completed'
          AND pp.amount::text != 'NaN'
        THEN pp.amount END), 0) AS card_system,

        COUNT(DISTINCT po.id) AS orders_system

      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp
        ON pp.order_id = po.id

      WHERE DATE(po.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') = $1
        AND po.status IN ('paid','completed')
      `,
      [date]
    );

    const row = summary.rows[0] || {};

    const cashSystem     = n(row.cash_system);
    const transferSystem = n(row.transfer_system);
    const cardSystem     = n(row.card_system);
    const ordersSystem   = n(row.orders_system);

    // ===============================
    // 💸 GASTOS
    // ===============================
    const gastosRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM "${schema}".expenses WHERE date = $1`,
      [date]
    );

    const expensesTotal = n(gastosRes.rows[0]?.total);

    // ===============================
    // 🧮 CALCULOS
    // ===============================
    const diffCash     = efectivoFisico - cashSystem;
    const diffTransfer = transferenciaFisico - transferSystem;
    const diffCard     = tarjetaFisico - cardSystem;
    const diffOrders   = comandasFisico - ordersSystem;

    const totalCounted =
      efectivoFisico +
      transferenciaFisico +
      tarjetaFisico +
      propinaFisico;

    const totalSystem =
      cashSystem +
      transferSystem +
      cardSystem;

    const diffTotal = totalCounted - totalSystem;

    const netSystem  = totalSystem - expensesTotal;
    const netCounted = totalCounted - expensesTotal;
    const diffNet    = netCounted - netSystem;

    // ===============================
    // 🔍 DEBUG
    // ===============================
    console.log("💰 CLOSING:", {
      totalCounted,
      totalSystem,
      diffTotal
    });

    // ===============================
    // 💾 INSERT
    // ===============================
    const result = await query(
      `
      INSERT INTO "${schema}".cash_register_closing (
        closing_user_id, closing_date, closing_time,

        cash_counted, cash_system, diff_cash,
        transfer_counted, transfer_system, diff_transfer,
        card_counted, card_system, diff_card,

        orders_counted, orders_system, diff_orders,

        expenses_total,
        total_counted, total_system, diff_total,

        net_system, net_counted, diff_net,

        remarks
      )
      VALUES (
        $1,$2,NOW(),

        $3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,

        $12,$13,$14,

        $15,
        $16,$17,$18,

        $19,$20,$21,

        $22
      )
      RETURNING *
      `,
      [
        req.user?.id || 'demo',
        date,

        safe(efectivoFisico), safe(cashSystem), safe(diffCash),
        safe(transferenciaFisico), safe(transferSystem), safe(diffTransfer),
        safe(tarjetaFisico), safe(cardSystem), safe(diffCard),

        safe(comandasFisico), safe(ordersSystem), safe(diffOrders),

        safe(expensesTotal),

        safe(totalCounted), safe(totalSystem), safe(diffTotal),

        safe(netSystem), safe(netCounted), safe(diffNet),

        remarks
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error("❌ ERROR CLOSING:", err);
    res.status(500).json({
      error: err.message
    });
  }
});



/**
 * GET /api/pos/cash-register/opening?date=YYYY-MM-DD
 * Devuelve la apertura del día para el usuario autenticado.
 * Si no existe → 404 con {}.
 */
router.get('/opening', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date   = req.query.date || ecuadorToday();

    // 🔥 FIX: Buscar apertura de caja POR FECHA, no por usuario
    // Una sola apertura por día para todos los usuarios
    const result = await query(
      `SELECT * FROM "${schema}".cash_register_openings
       WHERE date = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [date]
    );

    if (result.rows.length === 0) return res.status(404).json({});
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pos/cash-register/opening
 * Crea la apertura del día. Solo una vez por usuario/día.
 */
router.post('/opening', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId   = req.user?.id || req.user?.userId || 'unknown';
    const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ')
                     || req.user?.email || userId;
    const date     = req.body.date || ecuadorToday();

    // 🔥 FIX: Verificar que no exista apertura POR FECHA
    // No por usuario. Una sola apertura por día para todos.
    const existing = await query(
      `SELECT id FROM "${schema}".cash_register_openings WHERE date = $1 LIMIT 1`,
      [date]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Ya existe una apertura de caja para hoy' });
    }

    // Parsing de denominaciones asegurando Number()
    const {
      moneda_001 = 0, moneda_005 = 0, moneda_010 = 0,
      moneda_025 = 0, moneda_050 = 0, moneda_100 = 0,
      billete_1  = 0, billete_5  = 0, billete_10  = 0,
      billete_20 = 0, billete_50 = 0, billete_100 = 0,
      monto_banca = 0, observaciones = null,
    } = req.body;

    // Calcular total de efectivo por denominación (si está mal escrito, lo fuerza a 0)
    const totalEfectivo =
      Number(moneda_001) * 0.01 + Number(moneda_005) * 0.05 + Number(moneda_010) * 0.10 +
      Number(moneda_025) * 0.25 + Number(moneda_050) * 0.50 + Number(moneda_100) * 1.00 +
      Number(billete_1)  * 1    + Number(billete_5)  * 5    + Number(billete_10)  * 10   +
      Number(billete_20) * 20   + Number(billete_50) * 50   + Number(billete_100) * 100;

    const totalInicial = totalEfectivo + Number(monto_banca);

    const result = await query(
      `INSERT INTO "${schema}".cash_register_openings (
        user_id, user_name, date,
        moneda_001, moneda_005, moneda_010, moneda_025, moneda_050, moneda_100,
        billete_1,  billete_5,  billete_10, billete_20, billete_50, billete_100,
        total_efectivo, monto_banca, total_inicial, observaciones
      ) VALUES (
        $1,  $2,  $3,
        $4,  $5,  $6,  $7,  $8,  $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19
      ) RETURNING *`,
      [
        userId, userName, date,
        Number(moneda_001), Number(moneda_005), Number(moneda_010),
        Number(moneda_025), Number(moneda_050), Number(moneda_100),
        Number(billete_1),  Number(billete_5),  Number(billete_10),
        Number(billete_20), Number(billete_50), Number(billete_100),
        parseFloat(totalEfectivo.toFixed(2)),
        Number(monto_banca),
        parseFloat(totalInicial.toFixed(2)),
        observaciones,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 💵 INGRESOS EXTRAS
// ===============================
router.get('/income-extra', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const date = req.query.date || ecuadorToday();
    const result = await query(
      `SELECT * FROM "${schema}".incomes_extras WHERE date = $1 ORDER BY created_at ASC`,
      [date]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/income-extra', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { date, amount, payment_method, description } = req.body;
    const userId   = req.user?.id || 'unknown';
    const userName = [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ')
                     || req.user?.email || userId;
    const result = await query(
      `INSERT INTO "${schema}".incomes_extras (date, amount, payment_method, description, user_id, user_name)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [date || ecuadorToday(), n(amount), payment_method || 'cash', description || null, userId, userName]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;