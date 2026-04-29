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
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    // Nueva consulta: SIEMPRE aparecerán los 3 métodos (cash, transfer, card)
    const ventasPorMetodoRes = await query(
      `
      WITH metodos AS (
        SELECT 'cash' AS payment_method
        UNION ALL SELECT 'transfer'
        UNION ALL SELECT 'card'
      ),
      totales AS (
        SELECT
          pp.payment_method,
          SUM(pp.amount) AS total_cobrado,
          COUNT(pp.id) AS cantidad_pagos
        FROM
          "${schema}".pos_orders po
          INNER JOIN "${schema}".pos_payments pp ON pp.order_id = po.id
        WHERE
          DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1
          AND po.status IN ('paid','completed')
          AND pp.status = 'completed'
          AND pp.payment_method IN ('cash','transfer','card')
        GROUP BY
          pp.payment_method
      )
      SELECT
        m.payment_method,
        COALESCE(t.total_cobrado,0)    AS total_cobrado,
        COALESCE(t.cantidad_pagos,0)   AS cantidad_pagos
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

    // Consulta adicional para PROPINA, COMANDAS y GASTOS, igual que antes:
    const extrasRes = await query(
      `
      SELECT
        COALESCE(SUM(
          CASE 
            WHEN pp.payment_method = 'propina'
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
        AND po.status IN ('paid','completed')
      `,
      [date]
    );
    const extras = extrasRes.rows[0] || {};

    // GASTOS del día
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

    // Respondemos con los 3 métodos siempre, y extras aparte (propinas, comandas, gastos)
    res.json({
      metodos: ventasPorMetodo,      // Array de cash, transfer, card SIEMPRE presentes
      propinas: Number(extras.propinas || 0),
      comandasSistema: Number(extras.comandasSistema || 0),
      gastos
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pos/cash-register/closing?date=YYYY-MM-DD
 * Trae información del último cierre simple (para auto-llenar el form)
 */
router.get('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    const result = await query(
      `
      SELECT
        id,
        cash_counted        AS efectivoFisico,
        transfer_counted    AS transferenciaFisico,
        card_counted        AS tarjetaFisico,
        orders_counted      AS comandasFisico,
        closing_date        AS "date",
        created_at,
        NULL::NUMERIC(14,2) AS propinaFisico,
        NULL::NUMERIC(14,2) AS ventasFisico
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
 * POST /api/pos/cash-register/closing
 * Guarda el cuadre/final de caja. 
 */
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // --- OJO: el front puede mandar valores tipo string. Aseguramos números válidos.
    const efectivoFisico      = Number(req.body.efectivoFisico)      || 0;
    const transferenciaFisico = Number(req.body.transferenciaFisico) || 0;
    const tarjetaFisico       = Number(req.body.tarjetaFisico)       || 0;
    const propinaFisico       = Number(req.body.propinaFisico)       || 0; // si no usas, déjalo en 0
    const comandasFisico      = Number(req.body.comandasFisico)      || 0;
    const date                = req.body.date || ecuadorToday();
    const remarks             = req.body.remarks || null;
    // const ventasFisico      = Number(req.body.ventasFisico) || 0; // No usado realmente

    // --- Cálculo de ventas del sistema ---
    // Cambia el filtro: ahora incluye 'paid', 'completed' Y usa zona horaria correcta
    const summary = await query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN pp.payment_method = 'cash'
                          AND pp.status IN ('completed', 'paid')
                     THEN pp.amount ELSE 0 END), 0) AS cash_system,
        COALESCE(SUM(CASE WHEN pp.payment_method = 'transfer'
                          AND pp.status IN ('completed', 'paid')
                     THEN pp.amount ELSE 0 END), 0) AS transfer_system,
        COALESCE(SUM(CASE WHEN pp.payment_method = 'card'
                          AND pp.status IN ('completed', 'paid')
                     THEN pp.amount ELSE 0 END), 0) AS card_system,
        COUNT(DISTINCT po.id) AS orders_system
      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp ON pp.order_id = po.id
      WHERE DATE(po.created_at AT TIME ZONE 'America/Guayaquil') = $1
        AND po.status IN ('paid','completed')
      `,
      [date]
    );

    const s = summary?.rows[0] || {};

    const cashSystem     = Number(s.cash_system     || 0);
    const transferSystem = Number(s.transfer_system || 0);
    const cardSystem     = Number(s.card_system     || 0);
    const ordersSystem   = Number(s.orders_system   || 0);

    // --- Gastos del día ---
    const gastosRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM "${schema}".expenses WHERE date = $1`,
      [date]
    );
    const expensesTotal = Number(gastosRes.rows[0]?.total || 0);

    // --- Cálculos de diferencias y totales ---
    const diffCash      = efectivoFisico      - cashSystem;
    const diffTransfer  = transferenciaFisico - transferSystem;
    const diffCard      = tarjetaFisico       - cardSystem;
    const ordersCounted = comandasFisico;
    const diffOrders    = ordersCounted - ordersSystem;

    const totalCounted  = efectivoFisico + transferenciaFisico + tarjetaFisico + propinaFisico;
    const totalSystem   = cashSystem + transferSystem + cardSystem;
    const diffTotal     = totalCounted - totalSystem;

    const netSystem     = totalSystem  - expensesTotal;
    const netCounted    = totalCounted - expensesTotal;
    const diffNet       = netCounted   - netSystem;

    // --- Guarda el cierre ---
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
        req.user?.id || 'demo', date,
        efectivoFisico,           cashSystem,     diffCash,
        transferenciaFisico,      transferSystem, diffTransfer,
        tarjetaFisico,            cardSystem,     diffCard,
        ordersCounted,            ordersSystem,   diffOrders,
        expensesTotal,            totalCounted,   totalSystem,  diffTotal,
        netSystem,                netCounted,     diffNet,
        remarks,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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