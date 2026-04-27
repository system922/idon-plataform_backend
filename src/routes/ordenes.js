import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * POST /api/ordenes
 * Creates a new POS order + its line items (sends to kitchen).
 * Headers: Authorization, X-DB-Name, X-Business-ID
 * Body: { numero_mesa, cliente_id, items, notas, order_type,
 *         tax_rate, tax_amount, subtotal, total }
 * Response: { pedido: { id, order_number, ... }, items: [...] }
 */
router.post('/', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required (X-DB-Name o X-Business-ID)' });
    }

    const {
      numero_mesa,
      cliente_id,
      items = [],
      notas = '',
      order_type = 'dine_in',
      // Accept both new (tax_*) and legacy (iva_*, vat_*) field names
      tax_rate,
      vat_rate,
      iva_percentage,
      tax_amount,
      iva_amount,
      subtotal   = 0,
      total      = 0,
    } = req.body;

    // Resolve tax fields: prefer explicit numeric value, fallback to legacy names
    const resolvedTaxRate   = tax_rate   ?? (vat_rate != null ? vat_rate * 100 : null) ?? iva_percentage ?? 15;
    const resolvedTaxAmount = tax_amount ?? iva_amount ?? 0;

    if (!items.length) {
      return res.status(400).json({ error: 'La orden debe tener al menos un ítem' });
    }

    await client.query('BEGIN');

    // Generar número de orden secuencial dentro del negocio
    const countRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM "${schema}".pos_orders`
    );
    const orderNumber = String(parseInt(countRes.rows[0].cnt, 10) + 1).padStart(4, '0');

    // Nombre del cliente
    let customerName = null;
    if (cliente_id) {
      const cRes = await client.query(
        `SELECT name FROM "${schema}".customers WHERE id = $1 LIMIT 1`,
        [cliente_id]
      );
      customerName = cRes.rows[0]?.name || null;
    }

    // Insertar cabecera en pos_orders
    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_orders
         (order_number, order_type, status,
          customer_id, customer_name, mesa_numero,
          subtotal, tax_rate, tax_amount, total, notes)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        orderNumber,
        order_type,
        cliente_id || null,
        customerName,
        numero_mesa ? parseInt(numero_mesa, 10) : null,
        subtotal,
        resolvedTaxRate,
        resolvedTaxAmount,
        total,
        notas,
      ]
    );

    const pedido = insertRes.rows[0];

    // Insertar ítems en pos_order_items
    const insertedItems = [];
    for (const item of items) {
      const resolvedProductId   = item.product_id   || item.producto_id || item.productoId || null;
      const resolvedProductName = item.product_name || item.name        || item.nombre    || 'Producto';
      const resolvedProductCode = item.product_code || item.code        || item.codigo    || null;
      const resolvedQty         = item.quantity     || item.cantidad    || 1;
      const resolvedPrice       = item.unit_price   || item.price       || item.precio    || 0;
      const resolvedLineTotal   = item.line_total   || item.subtotal    || (resolvedPrice * resolvedQty);
      const resolvedNotes       = item.notes        || item.notas       || null;

      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
           (order_id, product_id, product_name, product_code,
            quantity, unit_price, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          pedido.id,
          resolvedProductId,
          resolvedProductName,
          resolvedProductCode,
          resolvedQty,
          resolvedPrice,
          resolvedLineTotal,
          resolvedNotes,
        ]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      pedido: {
        ...pedido,
        numero_pedido: orderNumber, // alias for frontend compatibility
      },
      items: insertedItems,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/ordenes
 * Lists recent orders with their items (kitchen queue).
 * Headers: Authorization, X-DB-Name
 * Query: status, limit
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { status, limit = 50 } = req.query;

    const conditions = status ? `WHERE o.status = $1` : '';
    const params     = status ? [status]              : [];

    const result = await query(
      `SELECT
         o.id, o.order_number,
         o.order_number AS numero_pedido,
         o.order_type, o.status,
         o.customer_id, o.customer_name,
         o.mesa_numero,
         o.subtotal, o.tax_rate, o.tax_amount, o.total,
         o.notes AS notas,
         o.created_at AS sale_date,
         o.updated_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id',           i.id,
               'product_id',   i.product_id,
               'product_name', i.product_name,
               'product_code', i.product_code,
               'quantity',     i.quantity,
               'unit_price',   i.unit_price,
               'line_total',   i.line_total,
               'notes',        i.notes
             ) ORDER BY i.created_at
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM "${schema}".pos_orders o
       LEFT JOIN "${schema}".pos_order_items i ON i.order_id = o.id
       ${conditions}
       GROUP BY o.id
       ORDER BY o.created_at DESC
       LIMIT ${parseInt(limit, 10)}`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ordenes/:id
 * Returns a single order with its items.
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    const result = await query(
      `SELECT
         o.*,
         o.order_number AS numero_pedido,
         COALESCE(
           json_agg(
             json_build_object(
               'id',           i.id,
               'product_id',   i.product_id,
               'product_name', i.product_name,
               'product_code', i.product_code,
               'quantity',     i.quantity,
               'unit_price',   i.unit_price,
               'line_total',   i.line_total,
               'notes',        i.notes
             ) ORDER BY i.created_at
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM "${schema}".pos_orders o
       LEFT JOIN "${schema}".pos_order_items i ON i.order_id = o.id
       WHERE o.id = $1
       GROUP BY o.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ordenes/:id/status
 * Updates the status of an order (pending → sent → completed → paid).
 */
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { status, payment_method, amount_paid, reference_number, payments } = req.body;
    if (!status) return res.status(400).json({ error: 'status es requerido' });

    await client.query('BEGIN');

    // Cambia el estado de la orden
    const result = await client.query(
      `UPDATE "${schema}".pos_orders
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    // SOLO si el status va a 'paid', guardamos en .pos_payments
    if (status === 'paid') {
      // Garantizar que la tabla existe (por si el tenant fue provisionado antes de que se agregara)
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

      // Helper — usa literal 'completed' en SQL para evitar problemas de cast con ENUMs schema-qualified
      const insertPayment = (orderId, method, amount, refNum) =>
        client.query(
          `INSERT INTO "${schema}".pos_payments
             (order_id, payment_method, amount, reference_number, status, paid_at)
           VALUES ($1, $2, $3, $4, 'completed', NOW())`,
          [orderId, method, parseFloat(amount) || 0, refNum || null]
        );

      if (payments && Array.isArray(payments) && payments.length > 0) {
        // Pago mixto: un registro por cada método con monto > 0
        for (const p of payments) {
          if ((parseFloat(p.amount) || 0) > 0) {
            await insertPayment(id, p.method, p.amount, p.reference_number);
          }
        }
      } else {
        // Pago simple (efectivo / tarjeta / transferencia)
        let paymentAmount = amount_paid;
        if (paymentAmount === undefined || paymentAmount === null) {
          const totalRes = await client.query(
            `SELECT total FROM "${schema}".pos_orders WHERE id = $1 LIMIT 1`,
            [id]
          );
          paymentAmount = totalRes.rows[0]?.total || 0;
        }
        await insertPayment(id, payment_method || 'cash', paymentAmount, reference_number);
      }
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;
