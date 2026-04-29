import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware, businessContextMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';

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
router.get('/summary', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    // ✅ FECHA ECUADOR REAL DESDE DB
    const dateRes = await query(`
      SELECT DATE(NOW() AT TIME ZONE 'America/Guayaquil') AS today
    `);

    const date = req.query.date || dateRes.rows[0].today;

    // ===============================
    // 🔥 VENTAS POR MÉTODO (FIX REAL)
    // ===============================
    const ventasPorMetodoRes = await query(
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
          DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1

          -- 🔥 FIX REAL AQUÍ
          AND po.status IN ('paid','completed')

          -- 🔥 ENUM CORRECTO
          AND pp.status = 'completed'
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
        WHERE payment_method IN ('cash','transfer','card')
        GROUP BY payment_method
      )

      SELECT
        m.payment_method,
        COALESCE(t.total_cobrado, 0) AS total_cobrado,
        COALESCE(t.cantidad_pagos, 0) AS cantidad_pagos
      FROM metodos m
      LEFT JOIN totales t ON t.payment_method = m.payment_method
      ORDER BY
        CASE m.payment_method
          WHEN 'cash' THEN 1
          WHEN 'transfer' THEN 2
          WHEN 'card' THEN 3
          ELSE 4
        END
      `,
      [date]
    );

    const ventasPorMetodo = ventasPorMetodoRes.rows || [];

    // ===============================
    // 🔥 EXTRAS (BIEN)
    // ===============================
    const extrasRes = await query(
      `
      SELECT
        COALESCE(SUM(
          CASE 
            WHEN LOWER(pp.payment_method) IN ('propina','tip')
             AND pp.status = 'completed'
            THEN pp.amount ELSE 0 
          END
        ), 0) AS "propinas",

        COUNT(DISTINCT po.id) AS "comandasSistema"

      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp 
        ON pp.order_id = po.id
      WHERE 
        DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1

        -- 🔥 IMPORTANTE
        AND po.status IN ('paid','completed')
      `,
      [date]
    );

    const extras = extrasRes.rows[0] || {};

    // ===============================
    // 🔥 GASTOS (OK)
    // ===============================
    const gastosRes = await query(
      `
      SELECT
        COALESCE(category, 'Gasto') AS concepto,
        description,
        amount AS monto
      FROM "${schema}".expenses
      WHERE date = $1
      ORDER BY created_at ASC
      `,
      [date]
    );

    const gastos = gastosRes.rows || [];

    // ===============================
    // 🔥 DEBUG PRO
    // ===============================
    console.log("📊 SUMMARY OK:", {
      date,
      ventasPorMetodo,
      totalVentas: ventasPorMetodo.reduce((a, b) => a + Number(b.total_cobrado), 0),
      propinas: extras.propinas,
      comandasSistema: extras.comandasSistema,
      gastosCount: gastos.length
    });

    // ===============================
    // 🔥 RESPUESTA FINAL
    // ===============================
    res.json({
      metodos: ventasPorMetodo,
      propinas: Number(extras.propinas || 0),
      comandasSistema: Number(extras.comandasSistema || 0),
      gastos
    });

  } catch (err) {
    console.error("❌ ERROR SUMMARY:", err);
    res.status(500).json({ error: err.message });
  }
});



/**
 * GET /api/pos/cash-register/closing?date=YYYY-MM-DD
 * Trae información del último cierre simple (para auto-llenar el form)
 */
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.body.date || await getEcuadorDate();

    const efectivoFisico      = Number(req.body.efectivoFisico) || 0;
    const transferenciaFisico = Number(req.body.transferenciaFisico) || 0;
    const tarjetaFisico       = Number(req.body.tarjetaFisico) || 0;
    const propinaFisico       = Number(req.body.propinaFisico) || 0;
    const comandasFisico      = Number(req.body.comandasFisico) || 0;
    const remarks             = req.body.remarks || null;

    const summary = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN pp.payment_method = 'cash'
                          AND pp.status = 'completed'
                     THEN pp.amount ELSE 0 END), 0) AS cash_system,

        COALESCE(SUM(CASE WHEN pp.payment_method = 'transfer'
                          AND pp.status = 'completed'
                     THEN pp.amount ELSE 0 END), 0) AS transfer_system,

        COALESCE(SUM(CASE WHEN pp.payment_method = 'card'
                          AND pp.status = 'completed'
                     THEN pp.amount ELSE 0 END), 0) AS card_system,

        COUNT(DISTINCT po.id) AS orders_system

      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp ON pp.order_id = po.id
      WHERE DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1
        AND po.status = 'completed'
    `, [date]);

    const s = summary.rows[0];

    const gastosRes = await query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM "${schema}".expenses WHERE date = $1`,
      [date]
    );

    const expensesTotal = Number(gastosRes.rows[0].total || 0);

    const totalCounted = efectivoFisico + transferenciaFisico + tarjetaFisico + propinaFisico;
    const totalSystem  = Number(s.cash_system) + Number(s.transfer_system) + Number(s.card_system);

    const result = await query(`
      INSERT INTO "${schema}".cash_register_closing (
        closing_user_id, closing_date, closing_time,
        cash_counted, cash_system,
        transfer_counted, transfer_system,
        card_counted, card_system,
        orders_counted, orders_system,
        expenses_total, total_counted, total_system,
        net_system, net_counted,
        remarks
      )
      VALUES (
        $1,$2,NOW(),
        $3,$4,
        $5,$6,
        $7,$8,
        $9,$10,
        $11,$12,$13,
        $14,$15,
        $16
      )
      RETURNING *
    `, [
      req.user?.id || 'demo',
      date,
      efectivoFisico, s.cash_system,
      transferenciaFisico, s.transfer_system,
      tarjetaFisico, s.card_system,
      comandasFisico, s.orders_system,
      expensesTotal,
      totalCounted,
      totalSystem,
      totalSystem - expensesTotal,
      totalCounted - expensesTotal,
      remarks
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error("❌ ERROR CLOSING:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pos/cash-register/closing
 * Guarda el cuadre/final de caja. 
 */
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    console.log("🔥 BODY RAW:", req.body);


    // ===============================
    // 🔒 HELPERS PRO
    // ===============================
    const toNumber = (v) => {
      if (v === null || v === undefined || v === '') return 0;
      const n = Number(v);
      return isNaN(n) ? 0 : n;
    };


    const safe = (n) => (isNaN(n) ? 0 : n);

    // ===============================
    // 📥 INPUT SEGURO
    // ===============================
    const efectivoFisico      = toNumber(req.body.efectivoFisico);
    const transferenciaFisico = toNumber(req.body.transferenciaFisico);
    const tarjetaFisico       = toNumber(req.body.tarjetaFisico);
    const propinaFisico       = toNumber(req.body.propinaFisico);
    const comandasFisico      = parseInt(req.body.comandasFisico) || 0;

    const date    = req.body.date || ecuadorToday();
    const remarks = req.body.remarks || null;

    // ===============================
    // 📊 RESUMEN DEL SISTEMA (FIX REAL)
    // ===============================
    const summary = await query(
      `
      SELECT
        COALESCE(SUM(CASE 
          WHEN LOWER(pp.payment_method) IN ('cash','efectivo')
           AND pp.status = 'completed'
        THEN pp.amount ELSE 0 END), 0) AS cash_system,

        COALESCE(SUM(CASE 
          WHEN LOWER(pp.payment_method) IN ('transfer','transferencia')
           AND pp.status = 'completed'
        THEN pp.amount ELSE 0 END), 0) AS transfer_system,

        COALESCE(SUM(CASE 
          WHEN LOWER(pp.payment_method) IN ('card','tarjeta')
           AND pp.status = 'completed'
        THEN pp.amount ELSE 0 END), 0) AS card_system,

        COUNT(DISTINCT po.id) AS orders_system

      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp 
        ON pp.order_id = po.id

      WHERE DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1
        AND po.status IN ('paid','completed')
      `,
      [date]
    );

    const s = summary?.rows?.[0] ?? {};

    const cashSystem     = toNumber(s.cash_system);
    const transferSystem = toNumber(s.transfer_system);
    const cardSystem     = toNumber(s.card_system);
    const ordersSystem   = parseInt(s.orders_system) || 0;

    // ===============================
    // 💸 GASTOS
    // ===============================
    const gastosRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total 
       FROM "${schema}".expenses 
       WHERE date = $1`,
      [date]
    );

    const expensesTotal = toNumber(gastosRes.rows?.[0]?.total);

    // ===============================
    // 🧮 CÁLCULOS SEGUROS
    // ===============================
    const diffCash      = safe(efectivoFisico - cashSystem);
    const diffTransfer  = safe(transferenciaFisico - transferSystem);
    const diffCard      = safe(tarjetaFisico - cardSystem);

    const ordersCounted = comandasFisico;
    const diffOrders    = safe(ordersCounted - ordersSystem);

    const totalCounted  = safe(
      efectivoFisico + transferenciaFisico + tarjetaFisico + propinaFisico
    );

    const totalSystem = safe(
      cashSystem + transferSystem + cardSystem
    );

    const diffTotal = safe(totalCounted - totalSystem);

    const netSystem  = safe(totalSystem - expensesTotal);
    const netCounted = safe(totalCounted - expensesTotal);
    const diffNet    = safe(netCounted - netSystem);

    // ===============================
    // 🔍 DEBUG PRO (puedes quitar luego)
    // ===============================
    console.log("💰 CIERRE DEBUG:", {
      date,
      efectivoFisico,
      cashSystem,
      diffCash,
      totalSystem,
      totalCounted
    });

    // ===============================
    // 💾 INSERT FINAL (100% SEGURO)
    // ===============================
    const result = await query(
      `
      INSERT INTO "${schema}".cash_register_closing (
        closing_user_id, closing_date, closing_time,
        cash_counted,     cash_system,     diff_cash,
        transfer_counted, transfer_system, diff_transfer,
        card_counted,     card_system,     diff_card,
        orders_counted,   orders_system,   diff_orders,
        expenses_total,   total_counted,   total_system,  diff_total,
        net_system,       net_counted,     diff_net,
        remarks
      )
      VALUES (
        $1,  $2,  NOW(),
        $3,  $4,  $5,
        $6,  $7,  $8,
        $9,  $10, $11,
        $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21,
        $22
      )
      RETURNING *
      `,
      [
        req.user?.id || 'demo',
        date,

        efectivoFisico,      cashSystem,     diffCash,
        transferenciaFisico, transferSystem, diffTransfer,
        tarjetaFisico,       cardSystem,     diffCard,

        ordersCounted,       ordersSystem,   diffOrders,

        expensesTotal,
        totalCounted,
        totalSystem,
        diffTotal,

        netSystem,
        netCounted,
        diffNet,

        remarks
      ]
    );

    return res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error("❌ ERROR CLOSING:", err);
    return res.status(500).json({ error: err.message });
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
    const userId = req.user?.id || req.user?.userId || '';

    const result = await query(
      `SELECT * FROM "${schema}".cash_register_openings
       WHERE date = $1 AND user_id = $2
       LIMIT 1`,
      [date, userId]
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

    // Verificar que no exista ya apertura hoy para este usuario
    const existing = await query(
      `SELECT id FROM "${schema}".cash_register_openings WHERE date = $1 AND user_id = $2 LIMIT 1`,
      [date, userId]
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

export default router;