import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware, businessContextMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';

const router = express.Router();

/**
 * GET /api/pos/cash-register/full-closing?date=YYYY-MM-DD
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
 */
router.get('/summary', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    // ✅ Ventas (MISMA lógica que ya validaste)
    const ventasRes = await query(
      `
      SELECT
        COALESCE(SUM(
          CASE 
            WHEN pp.payment_method = 'cash'
             AND pp.status = 'completed'
            THEN pp.amount ELSE 0 
          END
        ), 0) AS "ventasEfectivo",

        COALESCE(SUM(
          CASE 
            WHEN pp.payment_method = 'transfer'
             AND pp.status = 'completed'
            THEN pp.amount ELSE 0 
          END
        ), 0) AS "ventasTransferencia",

        COALESCE(SUM(
          CASE 
            WHEN pp.payment_method = 'card'
             AND pp.status = 'completed'
            THEN pp.amount ELSE 0 
          END
        ), 0) AS "ventasTarjeta",

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

    // ✅ Gastos
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

    const ventas = ventasRes.rows[0] || {};
    const gastos = gastosRes.rows || [];

    res.json({
      ...ventas,
      gastos
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pos/cash-register/closing?date=YYYY-MM-DD
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
 */
router.post('/closing', authMiddleware, businessContextMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      efectivoFisico, transferenciaFisico, tarjetaFisico,
      propinaFisico, comandasFisico, ventasFisico, date, remarks,
    } = req.body;

    const transferFisico = transferenciaFisico;

    // Ventas del sistema
    const summary = await query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN pp.payment_method = 'cash'     THEN pp.amount ELSE 0 END), 0) AS cash_system,
        COALESCE(SUM(CASE WHEN pp.payment_method = 'transfer' THEN pp.amount ELSE 0 END), 0) AS transfer_system,
        COALESCE(SUM(CASE WHEN pp.payment_method = 'card'     THEN pp.amount ELSE 0 END), 0) AS card_system,
        COUNT(DISTINCT po.id) AS orders_system
      FROM "${schema}".pos_orders po
      LEFT JOIN "${schema}".pos_payments pp ON pp.order_id = po.id
      WHERE DATE(po.created_at) = $1 AND po.status = 'paid'
      `,
      [date]
    );
    const s = summary?.rows[0] || {};

    const cashSystem     = Number(s.cash_system     || 0);
    const transferSystem = Number(s.transfer_system || 0);
    const cardSystem     = Number(s.card_system     || 0);
    const ordersSystem   = Number(s.orders_system   || 0);

    // Gastos reales del día
    const gastosRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM "${schema}".expenses WHERE date = $1`,
      [date]
    );
    const expensesTotal = Number(gastosRes.rows[0]?.total || 0);

    const diffCash      = Number(efectivoFisico)  - cashSystem;
    const diffTransfer  = Number(transferFisico)  - transferSystem;
    const diffCard      = Number(tarjetaFisico)   - cardSystem;
    const ordersCounted = Number(comandasFisico);
    const diffOrders    = ordersCounted - ordersSystem;

    const totalCounted  = Number(efectivoFisico) + Number(transferFisico) + Number(tarjetaFisico) + Number(propinaFisico || 0);
    const totalSystem   = cashSystem + transferSystem + cardSystem;
    const diffTotal     = totalCounted - totalSystem;

    const netSystem     = totalSystem  - expensesTotal;
    const netCounted    = totalCounted - expensesTotal;
    const diffNet       = netCounted   - netSystem;

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
        Number(efectivoFisico),  cashSystem,     diffCash,
        Number(transferFisico),  transferSystem, diffTransfer,
        Number(tarjetaFisico),   cardSystem,     diffCard,
        ordersCounted,           ordersSystem,   diffOrders,
        expensesTotal,           totalCounted,   totalSystem,  diffTotal,
        netSystem,               netCounted,     diffNet,
        remarks || null,
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

    const {
      moneda_001 = 0, moneda_005 = 0, moneda_010 = 0,
      moneda_025 = 0, moneda_050 = 0, moneda_100 = 0,
      billete_1  = 0, billete_5  = 0, billete_10  = 0,
      billete_20 = 0, billete_50 = 0, billete_100 = 0,
      monto_banca = 0, observaciones = null,
    } = req.body;

    // Calcular total de efectivo por denominación
    const totalEfectivo =
      moneda_001 * 0.01 + moneda_005 * 0.05 + moneda_010 * 0.10 +
      moneda_025 * 0.25 + moneda_050 * 0.50 + moneda_100 * 1.00 +
      billete_1  * 1    + billete_5  * 5    + billete_10  * 10   +
      billete_20 * 20   + billete_50 * 50   + billete_100 * 100;

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