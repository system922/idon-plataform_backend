// routes/purchaseOrders.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/purchase-orders
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT 
        po.*,
        s.name as supplier_name,
        COUNT(poi.id) as item_count,
        COALESCE(SUM(poi.received_qty), 0) as total_received
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".suppliers s ON po.supplier_id = s.id
      LEFT JOIN "${schema}".purchase_order_items poi ON po.id = poi.purchase_order_id
      GROUP BY po.id, s.name
      ORDER BY po.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    // Obtener la orden
    const orderResult = await query(`
      SELECT 
        po.*,
        s.name as supplier_name
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".suppliers s ON po.supplier_id = s.id
      WHERE po.id = $1
    `, [id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    // Obtener los items
    const itemsResult = await query(`
      SELECT 
        poi.*,
        p.code as product_code,
        p.name as product_name_full
      FROM "${schema}".purchase_order_items poi
      LEFT JOIN "${schema}".products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.created_at ASC
    `, [id]);
    
    res.json({
      order: orderResult.rows[0],
      items: itemsResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/purchase-orders
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { supplier_id, expected_at, notes, items } = req.body;
    const schema = await getSchemaName(req);
    
    if (!supplier_id || !items || items.length === 0) {
      return res.status(400).json({ error: 'Proveedor y items son requeridos' });
    }
    
    // Generar número de orden
    const numberResult = await query(`
      SELECT 'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(COALESCE(MAX(CAST(SUBSTRING(order_number FROM '-(\\d+)$') AS INTEGER)), 0) + 1, 4, '0') as order_number
      FROM "${schema}".purchase_orders
      WHERE order_number LIKE 'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%'
    `);
    
    const orderNumber = numberResult.rows[0].order_number;
    
    // Calcular totales
    let subtotal = 0;
    let total = 0;
    
    // Iniciar transacción
    await query('BEGIN');
    
    // Crear orden
    const orderResult = await query(`
      INSERT INTO "${schema}".purchase_orders (
        order_number, supplier_id, expected_at, notes, subtotal, total
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [orderNumber, supplier_id, expected_at, notes, 0, 0]);
    
    const order = orderResult.rows[0];
    
    // Insertar items
    for (const item of items) {
      const lineTotal = item.quantity * item.unit_cost;
      subtotal += lineTotal;
      
      await query(`
        INSERT INTO "${schema}".purchase_order_items (
          purchase_order_id, product_id, product_name, quantity, unit_cost, line_total, received_qty
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        order.id,
        item.product_id,
        item.product_name,
        item.quantity,
        item.unit_cost,
        lineTotal,
        0
      ]);
    }
    
    total = subtotal; // Sin impuestos por ahora
    
    // Actualizar totales
    await query(`
      UPDATE "${schema}".purchase_orders 
      SET subtotal = $1, total = $2
      WHERE id = $3
    `, [subtotal, total, order.id]);
    
    await query('COMMIT');
    
    // Obtener la orden completa
    const result = await query(`
      SELECT 
        po.*,
        s.name as supplier_name
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".suppliers s ON po.supplier_id = s.id
      WHERE po.id = $1
    `, [order.id]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/purchase-orders/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { supplier_id, expected_at, notes, status } = req.body;
    const schema = await getSchemaName(req);
    
    const result = await query(`
      UPDATE "${schema}".purchase_orders 
      SET 
        supplier_id = COALESCE($1, supplier_id),
        expected_at = COALESCE($2, expected_at),
        notes = COALESCE($3, notes),
        status = COALESCE($4, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [supplier_id, expected_at, notes, status, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/purchase-orders/:id/status
router.put('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const schema = await getSchemaName(req);
    
    const validStatuses = ['draft', 'pending', 'approved', 'received', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Estado no válido' });
    }
    
    const result = await query(`
      UPDATE "${schema}".purchase_orders 
      SET status = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [status, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/purchase-orders/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    // Verificar que la orden esté en draft
    const checkResult = await query(`
      SELECT status FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    if (checkResult.rows[0].status !== 'draft') {
      return res.status(400).json({ error: 'Solo se pueden eliminar órdenes en borrador' });
    }
    
    const result = await query(`
      DELETE FROM "${schema}".purchase_orders 
      WHERE id = $1
      RETURNING id
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    res.json({ success: true, message: 'Orden eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/purchase-orders/:id/receive
router.post('/:id/receive', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { items } = req.body; // [{item_id, received_qty}]
    const schema = await getSchemaName(req);
    
    // Verificar que la orden existe
    const checkOrder = await query(`
      SELECT status FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    if (checkOrder.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    if (checkOrder.rows[0].status !== 'approved') {
      return res.status(400).json({ error: 'Solo se pueden recibir órdenes aprobadas' });
    }
    
    await query('BEGIN');
    
    // Actualizar cantidades recibidas
    for (const item of items) {
      await query(`
        UPDATE "${schema}".purchase_order_items 
        SET received_qty = $1
        WHERE id = $2 AND purchase_order_id = $3
      `, [item.received_qty, item.item_id, id]);
    }
    
    // Actualizar estado de la orden
    await query(`
      UPDATE "${schema}".purchase_orders 
      SET status = 'received', received_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);
    
    await query('COMMIT');
    
    res.json({ success: true, message: 'Orden recibida correctamente' });
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

export default router;