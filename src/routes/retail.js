import express from 'express';
import { getClient } from '../config/database.js';
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
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      items = [],
      subtotal,
      iva_amount,
      total,
      customer_document_number,
      customer_name,
      discount_id,
      discount_amount = 0,
      payment_method = 'cash',
      payments = [],
      amount_paid,
      reference_number,
    } = req.body;

    if (!items.length) return res.status(400).json({ error: 'La venta debe tener al menos un ítem' });

    await client.query('BEGIN');

    // Numeración diaria (misma lógica que ordenes.js)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".daily_order_counter (
        id SERIAL PRIMARY KEY,
        order_date DATE NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil'),
        updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')
      )
    `);

    const counterResult = await client.query(
      `SELECT ${schema}.get_next_order_number() as next_number`
    );
    const dailyNumber = counterResult.rows[0].next_number;
    const datePrefix = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' })
      .replace(/-/g, '')
      .slice(2);
    const orderNumber = `${datePrefix}-${String(dailyNumber).padStart(3, '0')}`;

    // Asegurar columna printed
    await client.query(`
      ALTER TABLE "${schema}".pos_orders
      ADD COLUMN IF NOT EXISTS printed BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Insertar orden como pagada y ya impresa (retail no usa cocina)
    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_orders
         (order_number, order_type, status,
          customer_name, subtotal, tax_amount, total,
          discount_id, discount_amount,
          printed, notes)
       VALUES ($1, 'takeout', 'paid', $2, $3, $4, $5, $6, $7, TRUE, '')
       RETURNING id, order_number`,
      [
        orderNumber,
        customer_name || 'CONSUMIDOR FINAL',
        parseFloat(subtotal) || 0,
        parseFloat(iva_amount) || 0,
        parseFloat(total) || 0,
        discount_id || null,
        parseFloat(discount_amount) || 0,
      ]
    );

    const order = insertRes.rows[0];

    // Insertar items con todos los campos de precio (no dejar en cero)
    const insertedItems = [];
    for (const item of items) {
      const unitPrice  = parseFloat(item.unit_price)  || 0;
      const taxRate    = parseFloat(item.tax_rate)    || 0;
      const ivaAmount  = parseFloat(item.iva_amount)  || 0;
      const lineTotal  = parseFloat(item.line_total)  || unitPrice * item.quantity;

      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
           (order_id, product_id, product_name, code,
            quantity, unit_price, tax_rate, iva_amount, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '')
         RETURNING id`,
        [
          order.id,
          item.product_id,
          item.product_name || '',
          item.code || '',
          item.quantity,
          unitPrice,
          taxRate,
          ivaAmount,
          lineTotal,
        ]
      );
      insertedItems.push({
        id: itemRes.rows[0].id,
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: unitPrice,
        selling_price: unitPrice,
        tax_rate: taxRate,
        iva_amount: ivaAmount,
        code: item.code || '',
        line_total: lineTotal,
      });
    }

    // Crear tabla de pagos si no existe
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".pos_payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         UUID NOT NULL REFERENCES "${schema}".pos_orders(id) ON DELETE RESTRICT,
        payment_method   VARCHAR(50)   NOT NULL DEFAULT 'cash',
        amount           NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(100),
        status           VARCHAR(50)   NOT NULL DEFAULT 'pending',
        paid_at          TIMESTAMP,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Registrar pagos
    const insertPayment = (method, amount, ref = null) =>
      client.query(
        `INSERT INTO "${schema}".pos_payments
           (order_id, payment_method, amount, reference_number, status, paid_at)
         VALUES ($1, $2, $3, $4, 'completed', NOW())`,
        [order.id, method, parseFloat(amount) || 0, ref]
      );

    if (payments.length > 0) {
      for (const p of payments) {
        if ((parseFloat(p.amount) || 0) > 0) {
          await insertPayment(p.method, p.amount, p.reference_number || null);
        }
      }
    } else {
      await insertPayment(payment_method, amount_paid ?? total, reference_number || null);
    }

    await client.query('COMMIT');

    // Solo notificar cambio en datos (sin new_order para no disparar cocina)
    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'created' });
    }

    res.status(201).json({
      id: order.id,
      order_number: order.order_number,
      items: insertedItems,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /retail/orders:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Conflicto al generar número de orden. Reintente.', retry: true });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
