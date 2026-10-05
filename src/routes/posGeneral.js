// src/routes/posGeneral.js
import express from 'express';
import { getClient, query as dbQuery } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/**
 * GET /api/pos-general/collaborators
 * Lista los colaboradores (employees) activos del tenant para asociarlos a una venta.
 */
router.get('/collaborators', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await dbQuery(`
      SELECT id, full_name, email, position, department, status
      FROM "${schema}".employees
      WHERE status IS NULL OR status NOT IN ('inactive', 'terminated')
      ORDER BY full_name ASC NULLS LAST, email ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /pos-general/collaborators:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pos-general/orders
 * Crea una venta asociando colaborador (employees.id) OBLIGATORIO.
 */
router.post('/orders', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      items = [],
      customer_document_number,
      customer_name,
      discount_id,
      discount_amount = 0,
      payment_method = 'cash',
      payments = [],
      amount_paid,
      reference_number,
      collaborator_id,          // employees.id
    } = req.body;

    // ── Validaciones ──
    if (!items.length) {
      return res.status(400).json({ error: 'La venta debe tener al menos un ítem' });
    }
    if (!collaborator_id) {
      return res.status(400).json({ error: 'El colaborador es obligatorio' });
    }

    await client.query('BEGIN');

    // ── Verificar que el colaborador (empleado) existe y está activo ──
    const colabRes = await client.query(
      `SELECT id FROM "${schema}".employees
       WHERE id = $1 AND (status IS NULL OR status NOT IN ('inactive','terminated'))
       LIMIT 1`,
      [collaborator_id]
    );
    if (colabRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Colaborador inválido o inactivo' });
    }

    // ── Numeración diaria ──
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
      `SELECT ${schema}.get_next_order_number() AS next_number`
    );
    const dailyNumber = counterResult.rows[0].next_number;

    const datePrefix = new Date()
      .toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' })
      .replace(/-/g, '')
      .slice(2);

    const orderNumber = `${datePrefix}-${String(dailyNumber).padStart(3, '0')}`;

    // ── Cliente ──
    let customerName = customer_name || 'CONSUMIDOR FINAL';

    // ── Totales ──
    let calculatedSubtotal = 0;
    let calculatedTax = 0;
    let calculatedTotal = 0;
    for (const item of items) {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      const ivaAmount = Number(item.iva_amount) || 0;
      const lineTotal = Number(item.line_total) || (unitPrice * quantity + ivaAmount);
      calculatedSubtotal += unitPrice * quantity;
      calculatedTax += ivaAmount;
      calculatedTotal += lineTotal;
    }

    // ── Insertar orden ──
    const insertRes = await client.query(
      `INSERT INTO "${schema}".pos_orders
        (order_number, order_type, status, customer_name, subtotal, tax_amount, total,
         discount_id, discount_amount, printed, notes)
       VALUES ($1, 'takeout', 'paid', $2, $3, $4, $5, $6, $7, TRUE, $8)
       RETURNING *`,
      [
        orderNumber, customerName, calculatedSubtotal, calculatedTax, calculatedTotal,
        discount_id || null, Number(discount_amount) || 0, null,
      ]
    );
    const order = insertRes.rows[0];

    // ── Insertar items ──
    const insertedItems = [];
    for (const item of items) {
      const unitPrice = Number(item.unit_price) || 0;
      const quantity = Number(item.quantity) || 1;
      const ivaAmount = Number(item.iva_amount) || 0;
      const taxRate = Number(item.tax_rate) || 0;
      const lineTotal = Number(item.line_total) || (unitPrice * quantity + ivaAmount);
      const productName = item.product_name || 'Producto';

      const itemRes = await client.query(
        `INSERT INTO "${schema}".pos_order_items
          (order_id, product_id, product_name, code, quantity, unit_price, tax_rate,
           iva_amount, line_total, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [order.id, item.product_id, productName, item.code || '', quantity,
         unitPrice, taxRate, ivaAmount, lineTotal, item.notes || null]
      );
      insertedItems.push(itemRes.rows[0]);
    }

    // ── Asociar colaborador (employees) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".order_collaborators (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id          UUID NOT NULL REFERENCES "${schema}".pos_orders(id) ON DELETE CASCADE,
        collaborator_id   UUID NOT NULL REFERENCES "${schema}".employees(id)  ON DELETE RESTRICT,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_order_collaborator UNIQUE (order_id, collaborator_id)
      )
    `);
    await client.query(
      `INSERT INTO "${schema}".order_collaborators (order_id, collaborator_id)
       VALUES ($1, $2)
       ON CONFLICT (order_id, collaborator_id) DO NOTHING`,
      [order.id, collaborator_id]
    );

    // ── Pagos ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schema}".pos_payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID NOT NULL REFERENCES "${schema}".pos_orders(id) ON DELETE RESTRICT,
        payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
        amount NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
          await insertPayment(p.method || 'cash', p.amount, p.reference_number || null);
        }
      }
    } else {
      await insertPayment(payment_method, amount_paid ?? calculatedTotal, reference_number || null);
    }

    await client.query('COMMIT');

    const businessId = req.user?.businessId;
    if (businessId) {
      emitToBusiness(businessId, 'data_changed', { entity: 'orders', action: 'created' });
    }

    return res.status(201).json({
      id: order.id,
      order_number: order.order_number,
      items: insertedItems,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error en POST /pos-general/orders:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Conflicto al generar número de orden. Reintente.', retry: true });
    }
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

export default router;