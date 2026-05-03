import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/**
 * POST /api/ordenes
 * Crea una nueva orden POS
 */
router.post('/', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const {
      numero_mesa,
      cliente_id,
      items = [],
      notas = '',
      order_type = 'dine_in',
    } = req.body;

    if (!items.length) {
      return res.status(400).json({ error: 'La orden debe tener al menos un ítem' });
    }

    await client.query('BEGIN');

    const countRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM "${schema}".pos_orders`
    );
    const orderNumber = String(parseInt(countRes.rows[0].cnt, 10) + 1).padStart(4, '0');

    let customerName = null;
    if (cliente_id) {
      const cRes = await client.query(
        `SELECT name FROM "${schema}".customers WHERE id = $1 LIMIT 1`,
        [cliente_id]
      );
      customerName = cRes.rows[0]?.name || null;
    }

    // Calcular totales desde products
    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedTotal = 0;

    for (const item of items) {
      const productRes = await client.query(
        `SELECT selling_price, tax_rate FROM "${schema}".products WHERE id = $1`,
        [item.product_id]
      );
      
      if (productRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Producto no encontrado: ${item.product_id}` });
      }
      
      const product = productRes.rows[0];
      const quantity = item.quantity || 1;
      const itemSubtotal = product.selling_price * quantity;
      const itemTax = product.tax_rate * quantity;
      
      calculatedSubtotal += itemSubtotal;
      calculatedTax += itemTax;
      calculatedTotal += itemSubtotal + itemTax;
    }

    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_orders
         (order_number, order_type, status,
          customer_id, customer_name, mesa_numero,
          subtotal, tax_amount, total, notes)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        orderNumber,
        order_type,
        cliente_id || null,
        customerName,
        numero_mesa ? parseInt(numero_mesa, 10) : null,
        calculatedSubtotal,
        calculatedTax,
        calculatedTotal,
        notas,
      ]
    );

    const pedido = insertRes.rows[0];

    // Insertar items - SOLO guardamos product_id y quantity (product_name viene de products en el GET)
    const insertedItems = [];
    for (const item of items) {
      // Verificar que el producto existe
      const productCheck = await client.query(
        `SELECT id FROM "${schema}".products WHERE id = $1`,
        [item.product_id]
      );
      
      if (productCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Producto no encontrado: ${item.product_id}` });
      }
      
      const quantity = item.quantity || 1;

      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
           (order_id, product_id, quantity, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [
          pedido.id,
          item.product_id,
          quantity,
          item.notes || null,
        ]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    await client.query('COMMIT');

    const responsePayload = {
      pedido: {
        ...pedido,
        numero_pedido: orderNumber,
      },
      items: insertedItems,
    };

    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'new_order', {
        ...responsePayload,
        schema,
      });
    }

    res.status(201).json(responsePayload);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/ordenes
 * Lista órdenes con sus items (todo desde products mediante JOIN)
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { status, limit = 50 } = req.query;

    let conditions = '';
    let params = [];
    
    if (status) {
      conditions = `WHERE o.status = $1`;
      params = [status];
    }

    const result = await query(
      `SELECT
         o.id, o.order_number,
         o.order_number AS numero_pedido,
         o.order_type, o.status,
         o.customer_id, o.customer_name,
         o.mesa_numero,
         o.subtotal, o.tax_amount, o.total,
         o.notes AS notas,
         o.created_at AS sale_date,
         o.updated_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id',           i.id,
               'product_id',   i.product_id,
               'product_name', p.name,
               'quantity',     i.quantity,
               'selling_price', p.selling_price,
               'tax_rate',     p.tax_rate,
               'notes',        i.notes,
               'paid',         COALESCE(i.paid, false)
             ) ORDER BY i.created_at
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM "${schema}".pos_orders o
       LEFT JOIN "${schema}".pos_order_items i ON i.order_id = o.id
       LEFT JOIN "${schema}".products p ON i.product_id = p.id
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
 * Obtiene una orden específica con sus items
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
               'product_name', p.name,
               'quantity',     i.quantity,
               'selling_price', p.selling_price,
               'tax_rate',     p.tax_rate,
               'notes',        i.notes,
               'paid',         COALESCE(i.paid, false)
             ) ORDER BY i.created_at
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM "${schema}".pos_orders o
       LEFT JOIN "${schema}".pos_order_items i ON i.order_id = o.id
       LEFT JOIN "${schema}".products p ON i.product_id = p.id
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
 * Actualiza estado de orden y registra pagos
 */
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { 
      status, 
      payment_method, 
      amount_paid, 
      reference_number, 
      payments,
      cliente_id,
      customer_name,
      customer_document_number,
      notes
    } = req.body;

    if (!status) return res.status(400).json({ error: 'status es requerido' });

    await client.query('BEGIN');

    const result = await client.query(
      `UPDATE "${schema}".pos_orders
      SET 
        status = $1,
        customer_id = COALESCE($2, customer_id),
        customer_name = COALESCE($3, customer_name),
        notes = COALESCE($4, notes),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *`,
      [
        status,
        cliente_id || null,
        customer_name || null,
        notes || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    if (status === 'paid') {
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

      const insertPayment = (orderId, method, amount, refNum) =>
        client.query(
          `INSERT INTO "${schema}".pos_payments
             (order_id, payment_method, amount, reference_number, status, paid_at)
           VALUES ($1, $2, $3, $4, 'completed', NOW())`,
          [orderId, method, parseFloat(amount) || 0, refNum || null]
        );

      if (payments && Array.isArray(payments) && payments.length > 0) {
        for (const p of payments) {
          if ((parseFloat(p.amount) || 0) > 0) {
            await insertPayment(id, p.method, p.amount, p.reference_number);
          }
        }
      } else {
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

    const updatedOrder = result.rows[0];
    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'order_updated', {
        id:           updatedOrder.id,
        status:       updatedOrder.status,
        order_number: updatedOrder.order_number,
        schema,
      });
    }

    res.json(updatedOrder);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/ordenes/:id/pay-items
 * Cobra SOLO algunos items de la orden (Split Payment)
 */
router.post('/:id/pay-items', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { item_ids = [], amount_paid, payment_method = 'cash', cliente_id, notes } = req.body;

    if (!item_ids.length) {
      return res.status(400).json({ error: 'Debe enviar items a cobrar' });
    }

    await client.query('BEGIN');

    const itemsRes = await client.query(
      `SELECT i.*, p.selling_price, p.tax_rate
      FROM "${schema}".pos_order_items i
      LEFT JOIN "${schema}".products p ON i.product_id = p.id
      WHERE i.id = ANY($1::uuid[]) 
        AND i.order_id = $2
        AND COALESCE(i.paid, false) = false`,
      [item_ids, id]
    );

    const items = itemsRes.rows;

    if (!items.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Items no encontrados' });
    }

    let subtotal = 0;
    let taxTotal = 0;
    let total = 0;

    for (const i of items) {
      const itemSubtotal = i.selling_price * i.quantity;
      const itemTax = i.tax_rate * i.quantity;
      
      subtotal += itemSubtotal;
      taxTotal += itemTax;
      total += itemSubtotal + itemTax;
    }

    await client.query(
      `INSERT INTO "${schema}".pos_payments
       (order_id, payment_method, amount, status, paid_at)
       VALUES ($1, $2, $3, 'completed', NOW())`,
      [id, payment_method, total]
    );

    await client.query(
      `UPDATE "${schema}".pos_order_items
      SET paid = TRUE
      WHERE id = ANY($1::uuid[])`,
      [item_ids]
    );

    const remainingRes = await client.query(
      `SELECT 
        COALESCE(SUM(p.selling_price * i.quantity), 0) as subtotal,
        COALESCE(SUM(p.tax_rate * i.quantity), 0) as tax,
        COALESCE(SUM((p.selling_price + p.tax_rate) * i.quantity), 0) as total
      FROM "${schema}".pos_order_items i
      LEFT JOIN "${schema}".products p ON i.product_id = p.id
      WHERE i.order_id = $1 AND i.paid = FALSE`,
      [id]
    );

    const remainingSubtotal = parseFloat(remainingRes.rows[0].subtotal) || 0;
    const remainingTax = parseFloat(remainingRes.rows[0].tax) || 0;
    const remainingTotal = parseFloat(remainingRes.rows[0].total) || 0;

    let newStatus = 'partial';
    if (remainingTotal === 0) {
      newStatus = 'paid';
    }

    await client.query(
      `UPDATE "${schema}".pos_orders
       SET subtotal = $1,
           tax_amount = $2,
           total = $3,
           status = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [remainingSubtotal, remainingTax, remainingTotal, newStatus, id]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      paid: {
        subtotal,
        tax: taxTotal,
        total
      },
      remaining: {
        subtotal: remainingSubtotal,
        tax: remainingTax,
        total: remainingTotal
      },
      status: newStatus
    });

  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;