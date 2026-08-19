import express from 'express';
import { getClient, query as dbQuery } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/**
 * POST /api/retail/orders
 * Crea una venta de POS Retail: orden + items + pago en una sola transacción.
 * NO emite new_order (sin impresión de cocina/comanda).
 * Retorna { id, order_number, items } plano para uso inmediato en facturación.
 */
router.post('/orders', authMiddleware, async (req, res) => {
  const client = await getClient();

  try {
    const schema = await getSchemaName(req);

    if (!schema) {
      return res.status(400).json({
        error: 'Business context required'
      });
    }

    const {
      numero_mesa,
      cliente_id,
      items = [],
      notas = '',
      order_type = 'takeout',
      order_number: customOrderNumber,

      // Compatibilidad con tu frontend actual
      customer_document_number,
      customer_name,

      // Descuento
      discount_id,
      discount_amount = 0,

      // Pagos
      payment_method = 'cash',
      payments = [],
      amount_paid,
      reference_number,
    } = req.body;

    if (!items.length) {
      return res.status(400).json({
        error: 'La venta debe tener al menos un ítem'
      });
    }

    await client.query('BEGIN');

    // ============================================================
    // NUMERACIÓN DIARIA
    // ============================================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".daily_order_counter (
        id SERIAL PRIMARY KEY,
        order_date DATE NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT (
          CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil'
        ),
        updated_at TIMESTAMP DEFAULT (
          CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil'
        )
      )
    `);

    const counterResult = await client.query(
      `SELECT ${schema}.get_next_order_number() AS next_number`
    );

    const dailyNumber = counterResult.rows[0].next_number;

    const datePrefix = new Date()
      .toLocaleDateString('en-CA', {
        timeZone: 'America/Guayaquil'
      })
      .replace(/-/g, '')
      .slice(2);

    const orderNumber =
      customOrderNumber ||
      `${datePrefix}-${String(dailyNumber).padStart(3, '0')}`;

    // ============================================================
    // OBTENER CLIENTE
    // Misma lógica que /orders
    // ============================================================

    let customerName = customer_name || 'CONSUMIDOR FINAL';

    if (cliente_id) {
      const customerRes = await client.query(
        `SELECT name
           FROM "${schema}".customers
          WHERE id = $1
          LIMIT 1`,
        [cliente_id]
      );

      customerName =
        customerRes.rows[0]?.name ||
        customer_name ||
        'CONSUMIDOR FINAL';
    }

    // ============================================================
    // CALCULAR TOTALES DESDE LOS ÍTEMS
    // Misma lógica que /orders
    // ============================================================

    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedTotal = 0;

    for (const item of items) {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      const ivaAmount = Number(item.iva_amount) || 0;

      const lineTotal =
        Number(item.line_total) ||
        (unitPrice * quantity + ivaAmount);

      calculatedSubtotal += unitPrice * quantity;
      calculatedTax += ivaAmount;
      calculatedTotal += lineTotal;
    }

    // ============================================================
    // INSERTAR ORDEN
    // Misma estructura que /orders
    //
    // Se mantiene:
    // - status = paid
    // - printed = TRUE
    // porque retail no pasa por cocina.
    // ============================================================

    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_orders
         (
           order_number,
           order_type,
           status,
           customer_id,
           customer_name,
           mesa_numero,
           subtotal,
           tax_amount,
           total,
           discount_id,
           discount_amount,
           printed,
           notes
         )
       VALUES
         (
           $1,
           $2,
           'paid',
           $3,
           $4,
           $5,
           $6,
           $7,
           $8,
           $9,
           $10,
           TRUE,
           $11
         )
       RETURNING *`,
      [
        orderNumber,
        order_type,
        cliente_id || null,
        customerName,
        numero_mesa
          ? parseInt(numero_mesa, 10)
          : null,
        calculatedSubtotal,
        calculatedTax,
        calculatedTotal,
        discount_id || null,
        Number(discount_amount) || 0,
        notas,
      ]
    );

    const order = insertRes.rows[0];

    // ============================================================
    // INSERTAR ITEMS
    // Misma lógica que /orders
    // ============================================================

    const insertedItems = []

    // Usar los valores que envía el frontend
    for (const item of items) {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      const ivaAmount = Number(item.iva_amount) || 0;  // ← Usar el valor del frontend
      const lineTotal = Number(item.line_total) || 0;  // ← Usar el valor del frontend

  calculatedSubtotal += unitPrice * quantity;
  calculatedTax += ivaAmount;        // ← Debe ser 0.13
  calculatedTotal += lineTotal;      // ← Debe ser 1.00
}

      const lineTotal =
        Number(item.line_total) ||
        (unitPrice * quantity + ivaAmount);

      const productName =
        item.product_name || 'Producto';

      const itemNotes =
        item.notes || null;

      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
           (
             order_id,
             product_id,
             product_name,
             code,
             quantity,
             unit_price,
             tax_rate,
             iva_amount,
             line_total,
             notes
           )
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          order.id,
          item.product_id,
          productName,
          item.code || '',
          quantity,
          unitPrice,
          taxRate,
          ivaAmount,
          lineTotal,
          itemNotes,
        ]
      );

      insertedItems.push(itemRes.rows[0]);
    }

    // ============================================================
    // CREAR TABLA DE PAGOS SI NO EXISTE
    // ============================================================

    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".pos_payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         UUID NOT NULL
          REFERENCES "${schema}".pos_orders(id)
          ON DELETE RESTRICT,
        payment_method   VARCHAR(50) NOT NULL DEFAULT 'cash',
        amount           NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(100),
        status           VARCHAR(50) NOT NULL DEFAULT 'pending',
        paid_at          TIMESTAMP,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ============================================================
    // REGISTRAR PAGOS
    // ============================================================

    const insertPayment = (method, amount, ref = null) =>
      client.query(
        `INSERT INTO "${schema}".pos_payments
           (
             order_id,
             payment_method,
             amount,
             reference_number,
             status,
             paid_at
           )
         VALUES
           ($1, $2, $3, $4, 'completed', NOW())`,
        [
          order.id,
          method,
          parseFloat(amount) || 0,
          ref
        ]
      );

    if (payments.length > 0) {
      for (const p of payments) {
        if ((parseFloat(p.amount) || 0) > 0) {
          await insertPayment(
            p.method || 'cash',
            p.amount,
            p.reference_number || null
          );
        }
      }
    } else {
      await insertPayment(
        payment_method,
        amount_paid ?? calculatedTotal,
        reference_number || null
      );
    }

    // ============================================================
    // COMMIT
    // ============================================================

    await client.query('COMMIT');

    // ============================================================
    // NOTIFICACIÓN
    // Se mantiene como tu retail actual:
    // NO dispara new_order para cocina.
    // ============================================================

    const businessId = req.user?.businessId;

    if (businessId) {
      emitToBusiness(
        businessId,
        'data_changed',
        {
          entity: 'orders',
          action: 'created'
        }
      );
    }

    // ============================================================
    // RESPUESTA
    // ============================================================

    return res.status(201).json({
      id: order.id,
      order_number: order.order_number,
      items: insertedItems,
    });

  } catch (err) {
    await client.query('ROLLBACK');

    console.error(
      'Error en POST /retail/orders:',
      err
    );

    if (err.code === '23505') {
      return res.status(409).json({
        error:
          'Conflicto al generar número de orden. Reintente.',
        retry: true
      });
    }

    return res.status(500).json({
      error: err.message
    });

  } finally {
    client.release();
  }
});



/**
 * GET /api/retail/stats
 * Estadísticas del día para el dashboard de retail.
 */
router.get('/stats', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const tz = 'America/Guayaquil';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    // Ventas del día: total, transacciones, ticket promedio
    const summaryRes = await dbQuery(`
      SELECT
        COUNT(*)::int                        AS transacciones,
        COALESCE(SUM(total), 0)::numeric     AS total_ventas,
        COALESCE(AVG(total), 0)::numeric     AS ticket_promedio
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND printed = TRUE
        AND DATE(created_at AT TIME ZONE '${tz}') = $1
    `, [today]);

    // Distribución por método de pago
    const paymentRes = await dbQuery(`
      SELECT pp.payment_method,
             COUNT(*)::int            AS cantidad,
             SUM(pp.amount)::numeric  AS monto
      FROM "${schema}".pos_payments pp
      JOIN "${schema}".pos_orders po ON pp.order_id = po.id
      WHERE po.status = 'paid'
        AND po.printed = TRUE
        AND DATE(po.created_at AT TIME ZONE '${tz}') = $1
        AND pp.status = 'completed'
      GROUP BY pp.payment_method
      ORDER BY monto DESC
    `, [today]);

    // Top 5 productos más vendidos hoy
    const topProductsRes = await dbQuery(`
      SELECT oi.product_name,
             SUM(oi.quantity)::int          AS cantidad,
             SUM(oi.line_total)::numeric    AS total
      FROM "${schema}".pos_order_items oi
      JOIN "${schema}".pos_orders po ON oi.order_id = po.id
      WHERE po.status = 'paid'
        AND po.printed = TRUE
        AND DATE(po.created_at AT TIME ZONE '${tz}') = $1
      GROUP BY oi.product_name
      ORDER BY cantidad DESC
      LIMIT 5
    `, [today]);

    // Ventas por hora del día actual
    const byHourRes = await dbQuery(`
      SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE '${tz}')::int AS hora,
             COUNT(*)::int              AS transacciones,
             SUM(total)::numeric        AS total
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND printed = TRUE
        AND DATE(created_at AT TIME ZONE '${tz}') = $1
      GROUP BY hora
      ORDER BY hora ASC
    `, [today]);

    const summary = summaryRes.rows[0];

    res.json({
      ok: true,
      data: {
        transacciones:  summary.transacciones,
        total_ventas:   parseFloat(summary.total_ventas),
        ticket_promedio: parseFloat(summary.ticket_promedio),
        pagos:          paymentRes.rows.map(r => ({
          method: r.payment_method,
          cantidad: r.cantidad,
          monto: parseFloat(r.monto),
        })),
        top_productos:  topProductsRes.rows.map(r => ({
          name: r.product_name,
          cantidad: r.cantidad,
          total: parseFloat(r.total),
        })),
        por_hora: byHourRes.rows.map(r => ({
          hora: r.hora,
          label: `${String(r.hora).padStart(2, '0')}:00`,
          transacciones: r.transacciones,
          total: parseFloat(r.total),
        })),
      },
    });
  } catch (err) {
    console.error('Error en GET /retail/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
