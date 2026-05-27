import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/**
 * POST /api/ordenes
 * Crea una nueva orden POS con numeración diaria (USANDO FUNCIÓN DE BD)
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
      order_number: customOrderNumber,
    } = req.body;

    if (!items.length) {
      return res.status(400).json({ error: 'La orden debe tener al menos un ítem' });
    }

    await client.query('BEGIN');

    // Crear tabla para control de contador diario (si no existe)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".daily_order_counter (
        id SERIAL PRIMARY KEY,
        order_date DATE NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil'),
        updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'America/Guayaquil')
      )
    `);

    // 🔥🔥🔥 USAR LA FUNCIÓN DE BASE DE DATOS - SIMPLE, SEGURA Y CON HORA ECUADOR 🔥🔥🔥
    // La función get_next_order_number() obtiene la fecha de Ecuador automáticamente
    const counterResult = await client.query(`
      SELECT ${schema}.get_next_order_number() as next_number
    `);
    
    const dailyNumber = counterResult.rows[0].next_number;
    const datePrefix = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' }).replace(/-/g, '').slice(2); // "260512"
    const orderNumber = customOrderNumber || `${datePrefix}-${String(dailyNumber).padStart(3, '0')}`;

    console.log(`📊 Orden #${orderNumber} generada con función de BD`);

    let customerName = null;
    if (cliente_id) {
      const cRes = await client.query(
        `SELECT name FROM "${schema}".customers WHERE id = $1 LIMIT 1`,
        [cliente_id]
      );
      customerName = cRes.rows[0]?.name || null;
    }

    // Calcular totales y validar productos
    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedTotal = 0;
    const productosData = [];

    for (const item of items) {
      const productRes = await client.query(
        `SELECT id, name, selling_price, tax_rate FROM "${schema}".products WHERE id = $1`,
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
      productosData.push({ ...product, quantity, notes: item.notes || null });
    }

    // Insertar orden con el número diario
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

    // Insertar items
    const insertedItems = [];
    for (const prod of productosData) {
      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
           (order_id, product_id, quantity, notes)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [pedido.id, prod.id, prod.quantity, prod.notes]
      );
      insertedItems.push({
        ...itemRes.rows[0],
        product_name:  prod.name,
        selling_price: prod.selling_price,
        tax_rate:      prod.tax_rate,
      });
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
      emitToBusiness(businessId, 'new_order', { ...responsePayload, schema });
      emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'created' });
    }

    res.status(201).json(responsePayload);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear orden:', err);
    
    // Manejar error de duplicado (por si acaso)
    if (err.code === '23505') {
      return res.status(409).json({ 
        error: 'Conflicto al generar número de orden. Por favor intente nuevamente.',
        retry: true 
      });
    }
    
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * GET /api/ordenes
 * Lista órdenes con sus items (todo desde products mediante JOIN)
 * Parámetros: status, date (YYYY-MM-DD), limit
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { status, date, limit = 50 } = req.query;

    let conditions = '';
    let params = [];

    // 🔥 NUEVO: Agregar soporte para filtro por fecha
    if (date) {
      conditions = `WHERE DATE(o.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guayaquil') = $1`;
      params.push(date);
      let nextParam = 2;

      if (status) {
        if (status === 'kitchen') {
          conditions += ` AND (o.status IN ('pending', 'sent', 'completed') OR o.status IS NULL)`;
        } else if (status === 'active') {
          conditions += ` AND (o.status NOT IN ('paid', 'draft') OR o.status IS NULL)`;
        } else if (status === 'pending') {
          conditions += ` AND o.status = $${nextParam}`;
          params.push(status);
          nextParam++;
        } else {
          const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
          const placeholders = statuses.map((_, i) => `$${nextParam + i}`).join(', ');
          conditions += ` AND o.status IN (${placeholders})`;
          params.push(...statuses);
          nextParam += statuses.length;
        }
      }
    } else if (status) {
      if (status === 'kitchen') {
        conditions = `WHERE (o.status IN ('pending', 'sent', 'completed') OR o.status IS NULL)`;
        params = [];
      } else if (status === 'active') {
        // Todo excepto paid y draft
        conditions = `WHERE o.status NOT IN ('paid', 'draft') OR o.status IS NULL`;
        params = [];
      } else {
        const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
        const placeholders = statuses.map((_, i) => `$${i + 1}`).join(', ');
        conditions = `WHERE o.status IN (${placeholders})`;
        params = statuses;
      }
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
    console.error('Error en GET /ordenes:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/ordenes/unprinted
 * Órdenes pendientes recientes que no han sido impresas (para polling de cocina)
 */
router.get('/unprinted', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    await query(`
      ALTER TABLE "${schema}".pos_orders
      ADD COLUMN IF NOT EXISTS printed BOOLEAN NOT NULL DEFAULT FALSE
    `);

    const result = await query(
      `SELECT
         o.id, o.order_number, o.order_number AS numero_pedido,
         o.order_type, o.status, o.mesa_numero, o.notes AS notas,
         o.created_at,
         COALESCE(
           json_agg(
             json_build_object(
               'id',           i.id,
               'product_id',   i.product_id,
               'product_name', p.name,
               'quantity',     i.quantity,
               'notes',        i.notes,
               'paid',         COALESCE(i.paid, false)
             ) ORDER BY i.created_at
           ) FILTER (WHERE i.id IS NOT NULL),
           '[]'::json
         ) AS items
       FROM "${schema}".pos_orders o
       LEFT JOIN "${schema}".pos_order_items i ON i.order_id = o.id
       LEFT JOIN "${schema}".products p ON i.product_id = p.id
       WHERE o.printed = FALSE
         AND o.status NOT IN ('cancelled')
         AND o.created_at > NOW() - INTERVAL '2 hours'
       GROUP BY o.id
       ORDER BY o.created_at ASC
       LIMIT 20`
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /ordenes/unprinted:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ordenes/mark-printed
 * Marca órdenes como impresas
 * Body: { order_ids: [uuid, ...] }
 */
router.post('/mark-printed', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { order_ids = [] } = req.body;
    if (!order_ids.length) return res.json({ success: true, updated: 0 });

    await query(`
      ALTER TABLE "${schema}".pos_orders
      ADD COLUMN IF NOT EXISTS printed BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // Atomic claim: solo actualiza si aún NO está impresa → evita doble impresión entre pestañas
    const result = await query(
      `UPDATE "${schema}".pos_orders SET printed = TRUE
       WHERE id = ANY($1::uuid[]) AND printed = FALSE
       RETURNING id`,
      [order_ids]
    );

    res.json({ success: true, updated: result.rowCount, claimed_ids: result.rows.map(r => r.id) });
  } catch (err) {
    console.error('Error en POST /ordenes/mark-printed:', err);
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
    console.error('Error en GET /ordenes/:id:', err);
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
      emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'updated' });
    }

    res.json(updatedOrder);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en PATCH /ordenes/:id/status:', err);
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

    console.log('=== pay-items request ===');
    console.log('order_id:', id);
    console.log('item_ids recibidos:', item_ids);
    console.log('tipo primer item_id:', typeof item_ids[0]);

    if (!item_ids.length) {
      return res.status(400).json({ error: 'Debe enviar items a cobrar' });
    }

    // Verificar existencia de items
    const checkExist = await client.query(
      `SELECT id, paid FROM "${schema}".pos_order_items WHERE id = ANY($1::uuid[]) AND order_id = $2`,
      [item_ids, id]
    );
    if (checkExist.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se encontraron items con esos IDs en esta orden' });
    }

    const itemsPorPagar = checkExist.rows.filter(row => !row.paid);
    if (itemsPorPagar.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Todos los items ya estaban pagados' });
    }
    const realItemIds = itemsPorPagar.map(row => row.id);

    await client.query('BEGIN');

    // Obtener precios
    const itemsRes = await client.query(
      `SELECT i.id, i.quantity, p.selling_price, p.tax_rate
       FROM "${schema}".pos_order_items i
       LEFT JOIN "${schema}".products p ON i.product_id = p.id
       WHERE i.id = ANY($1::uuid[]) AND i.order_id = $2`,
      [realItemIds, id]
    );

    if (itemsRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No se pudieron obtener los detalles de los items' });
    }

    let subtotal = 0, taxTotal = 0, total = 0;
    for (const i of itemsRes.rows) {
      const price = i.selling_price || 0;
      const tax = i.tax_rate || 0;
      const qty = i.quantity || 1;
      subtotal += price * qty;
      taxTotal += tax * qty;
      total += (price + tax) * qty;
    }

    // Insertar pago
    await client.query(
      `INSERT INTO "${schema}".pos_payments
       (order_id, payment_method, amount, status, paid_at)
       VALUES ($1, $2, $3, 'completed', NOW())`,
      [id, payment_method, total]
    );

    // Marcar items como pagados
    const updateRes = await client.query(
      `UPDATE "${schema}".pos_order_items SET paid = TRUE WHERE id = ANY($1::uuid[]) RETURNING id`,
      [realItemIds]
    );
    console.log(`✅ Items marcados como pagados: ${updateRes.rowCount}`);

    // Calcular restantes
    const remainingRes = await client.query(
      `SELECT
         COALESCE(SUM(p.selling_price * i.quantity), 0) as subtotal,
         COALESCE(SUM(p.tax_rate * i.quantity), 0) as tax,
         COALESCE(SUM((p.selling_price + p.tax_rate) * i.quantity), 0) as total
       FROM "${schema}".pos_order_items i
       LEFT JOIN "${schema}".products p ON i.product_id = p.id
       WHERE i.order_id = $1 AND COALESCE(i.paid, false) = false`,
      [id]
    );

    const remainingSubtotal = parseFloat(remainingRes.rows[0].subtotal);
    const remainingTax = parseFloat(remainingRes.rows[0].tax);
    const remainingTotal = parseFloat(remainingRes.rows[0].total);
    const newStatus = remainingTotal === 0 ? 'paid' : 'pending';

    // Actualizar la orden
    if (newStatus === 'paid') {
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
    } else {
      await client.query(
        `UPDATE "${schema}".pos_orders
         SET subtotal = $1,
             tax_amount = $2,
             total = $3,
             updated_at = NOW()
         WHERE id = $4`,
        [remainingSubtotal, remainingTax, remainingTotal, id]
      );
    }

    await client.query('COMMIT');
    console.log(`Transacción completada. Estado de la orden: ${newStatus}`);

    res.json({
      success: true,
      paid: { subtotal, tax: taxTotal, total },
      remaining: { subtotal: remainingSubtotal, tax: remainingTax, total: remainingTotal },
      status: newStatus
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en pay-items:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/ordenes/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    await client.query('BEGIN');
    await client.query(`DELETE FROM "${schema}".pos_order_items WHERE order_id = $1`, [id]);
    await client.query(`DELETE FROM "${schema}".pos_payments WHERE order_id = $1`, [id]);
    const result = await client.query(`DELETE FROM "${schema}".pos_orders WHERE id = $1 RETURNING id`, [id]);
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    await client.query('COMMIT');
    const businessId = req.user?.businessId;
    if (businessId) emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'deleted' });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en DELETE /ordenes/:id:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/ordenes/:id/kitchen-ready
 * Notifica a caja que la orden está lista en cocina (emite socket order_ready)
 */
router.post('/:id/kitchen-ready', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const businessId = req.user?.businessId;
    const schema = await getSchemaName(req);

    await query(
      `UPDATE "${schema}".pos_orders SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [id]
    );

    const orderRes = await query(
      `SELECT order_number, mesa_numero FROM "${schema}".pos_orders WHERE id = $1 LIMIT 1`,
      [id]
    );
    const order = orderRes.rows[0] || {};

    emitToBusiness(businessId, 'order_ready', {
      order_id:     id,
      order_number: order.order_number,
      mesa_numero:  order.mesa_numero,
    });
    emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'updated' });

    res.json({ success: true });
  } catch (err) {
    console.error('Error kitchen-ready:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/ordenes/:id
 * Actualiza los items de una orden (edición desde historial)
 * Body: { items: [{ product_id, quantity, notes }], subtotal, tax_amount, total }
 */
router.patch('/:id', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { items, subtotal: frontSubtotal, tax_amount: frontTax, total: frontTotal } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requieren items válidos' });
    }

    await client.query('BEGIN');

    const orderRes = await client.query(
      `SELECT id FROM "${schema}".pos_orders WHERE id = $1`, [id]
    );
    if (!orderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }

    // Recalcular totales desde BD (igual que POST)
    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedTotal = 0;
    const productosData = [];

    for (const item of items) {
      const productRes = await client.query(
        `SELECT id, name, selling_price, tax_rate FROM "${schema}".products WHERE id = $1`,
        [item.product_id]
      );
      if (productRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Producto no encontrado: ${item.product_id}` });
      }
      const product = productRes.rows[0];
      const quantity        = Number(item.quantity) || 1;
      const sellingPrice    = Number(product.selling_price) || 0;
      const taxRate         = Number(product.tax_rate)      || 0;
      calculatedSubtotal   += sellingPrice * quantity;
      calculatedTax        += taxRate      * quantity;
      calculatedTotal      += (sellingPrice + taxRate) * quantity;
      productosData.push({ ...product, quantity, notes: item.notes || null });
    }

    await client.query(`DELETE FROM "${schema}".pos_order_items WHERE order_id = $1`, [id]);
    for (const prod of productosData) {
      await client.query(
        `INSERT INTO "${schema}".pos_order_items (order_id, product_id, quantity, notes)
         VALUES ($1, $2, $3, $4)`,
        [id, prod.id, prod.quantity, prod.notes]
      );
    }

    // Usar recalculado si es > 0, sino confiar en el frontend
    const finalSubtotal = calculatedSubtotal > 0 ? calculatedSubtotal : (Number(frontSubtotal) || 0);
    const finalTax      = calculatedTax      > 0 ? calculatedTax      : (Number(frontTax)      || 0);
    const finalTotal    = calculatedTotal    > 0 ? calculatedTotal    : (Number(frontTotal)    || 0);

    await client.query(
      `UPDATE "${schema}".pos_orders
       SET subtotal=$1, tax_amount=$2, total=$3, updated_at=NOW()
       WHERE id=$4`,
      [finalSubtotal, finalTax, finalTotal, id]
    );

    await client.query('COMMIT');
    const businessId = req.user?.businessId;
    if (businessId) emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'updated' });
    res.json({ success: true, subtotal: finalSubtotal, tax_amount: finalTax, total: finalTotal });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en PATCH /ordenes/:id:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;