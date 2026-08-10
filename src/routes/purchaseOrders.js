// routes/purchaseOrders.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ============================================================
// GET /api/purchase-orders
// Listar todas las órdenes de compra
// ============================================================
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        po.*,
        COUNT(DISTINCT poi.id) as item_count,
        COUNT(DISTINCT pois.supplier_id) as supplier_count,
        COALESCE(SUM(pois.line_total), 0) as total
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".purchase_order_items poi ON po.id = poi.purchase_order_id
      LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON poi.id = pois.purchase_order_item_id
      GROUP BY po.id
      ORDER BY po.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/:id
// Obtener una orden de compra con sus items
// ============================================================
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    // Obtener la orden
    const orderResult = await query(`
      SELECT * FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    // Obtener items con sus proveedores asignados
    const itemsResult = await query(`
      SELECT 
        poi.*,
        p.code as product_code_full,
        p.barcode as product_barcode,
        p.min_stock,
        p.product_type,
        p.unit_cost as default_unit_cost,
        json_agg(
          json_build_object(
            'id', pois.id,
            'supplier_id', pois.supplier_id,
            'supplier_name', s.name,
            'quantity', pois.quantity,
            'unit_cost', pois.unit_cost,
            'line_total', pois.line_total,
            'received_qty', pois.received_qty
          )
        ) as suppliers
      FROM "${schema}".purchase_order_items poi
      LEFT JOIN "${schema}".products p ON poi.product_id = p.id
      LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON poi.id = pois.purchase_order_item_id
      LEFT JOIN "${schema}".suppliers s ON pois.supplier_id = s.id
      WHERE poi.purchase_order_id = $1
      GROUP BY poi.id, p.code, p.barcode, p.min_stock, p.product_type, p.unit_cost
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

// ============================================================
// GET /api/purchase-orders/suggestions/items
// Obtener sugerencias de productos con min_stock bajo
// ============================================================
router.get('/suggestions/items', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    // 1. Productos COMMERCIAL con min_stock bajo o igual
    const commercialResult = await query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.barcode,
        p.stock,
        p.min_stock,
        p.unit_cost,
        'COMMERCIAL' as source_type,
        NULL as recipe_id,
        NULL as yield_qty,
        NULL as yield_unit,
        NULL::jsonb as ingredients
      FROM "${schema}".products p
      WHERE p.product_type = 'COMMERCIAL' 
        AND p.is_active = true
        AND p.stock <= p.min_stock
      ORDER BY (p.min_stock - p.stock) DESC
    `);
    
    // 2. Productos MANUFACTURED con min_stock bajo
    const manufacturedResult = await query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.barcode,
        p.stock,
        p.min_stock,
        p.unit_cost,
        'MANUFACTURED' as source_type,
        r.id as recipe_id,
        r.yield_qty,
        r.yield_unit,
        COALESCE(
          json_agg(
            json_build_object(
              'raw_material_id', ri.raw_material_id,
              'raw_material_name', rm.name,
              'raw_material_code', rm.code,
              'quantity', ri.quantity,
              'unit', ri.unit,
              'unit_cost', rm.unit_cost,
              'total_cost', ri.quantity * rm.unit_cost
            )
          ) FILTER (WHERE ri.raw_material_id IS NOT NULL),
          '[]'::json
        ) as ingredients
      FROM "${schema}".products p
      JOIN "${schema}".recipes r ON p.id = r.product_id
      LEFT JOIN "${schema}".recipe_ingredients ri ON r.id = ri.recipe_id
      LEFT JOIN "${schema}".raw_materials rm ON ri.raw_material_id = rm.id
      WHERE p.product_type = 'MANUFACTURED' 
        AND p.is_active = true
        AND p.stock <= p.min_stock
      GROUP BY p.id, r.id
      ORDER BY (p.min_stock - p.stock) DESC
    `);
    
    res.json({
      commercial: commercialResult.rows,
      manufactured: manufacturedResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/suppliers/:productId
// Obtener proveedores que han vendido un producto
// ============================================================
router.get('/suppliers/:productId', authMiddleware, async (req, res) => {
  try {
    const { productId } = req.params;
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT DISTINCT
        s.id,
        s.name,
        s.tax_id,
        s.phone,
        s.email,
        psh.last_unit_cost,
        psh.total_orders,
        psh.last_order_date
      FROM "${schema}".suppliers s
      JOIN "${schema}".product_supplier_history psh ON s.id = psh.supplier_id
      WHERE psh.product_id = $1
      ORDER BY psh.total_orders DESC, psh.last_order_date DESC
    `, [productId]);
    
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /api/purchase-orders
// Crear una nueva orden de compra
// ============================================================
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { 
      order_date, 
      expected_at,
      notes, 
      items,
      supplier_assignments // { item_index: { supplier_id, quantity, unit_cost } }
    } = req.body;
    
    const schema = await getSchemaName(req);
    const userId = req.user.id;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Se requieren items para la orden' });
    }
    
    // Generar número de orden
    const numberResult = await query(`
      SELECT 'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
      LPAD(COALESCE(MAX(CAST(SUBSTRING(order_number FROM '-(\\d+)$') AS INTEGER)), 0) + 1, 4, '0') as order_number
      FROM "${schema}".purchase_orders
      WHERE order_number LIKE 'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '%'
    `);
    
    const orderNumber = numberResult.rows[0].order_number;
    
    await query('BEGIN');
    
    // 1. Crear orden
    const orderResult = await query(`
      INSERT INTO "${schema}".purchase_orders (
        order_number,
        order_date,
        expected_at,
        notes,
        created_by,
        status
      ) VALUES ($1, $2, $3, $4, $5, 'draft')
      RETURNING *
    `, [orderNumber, order_date || new Date(), expected_at, notes, userId]);
    
    const order = orderResult.rows[0];
    
    // 2. Insertar items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      const itemResult = await query(`
        INSERT INTO "${schema}".purchase_order_items (
          purchase_order_id,
          source_type,
          product_id,
          recipe_id,
          product_name,
          product_code,
          barcode,
          quantity,
          notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
      `, [
        order.id,
        item.source_type,
        item.product_id || null,
        item.recipe_id || null,
        item.product_name,
        item.product_code || null,
        item.barcode || null,
        item.quantity,
        item.notes || null
      ]);
      
      const itemId = itemResult.rows[0].id;
      
      // 3. Asignar proveedores si existen
      if (supplier_assignments && supplier_assignments[i]) {
        const assignment = supplier_assignments[i];
        
        await query(`
          INSERT INTO "${schema}".purchase_order_item_suppliers (
            purchase_order_item_id,
            supplier_id,
            quantity,
            unit_cost,
            line_total
          ) VALUES ($1, $2, $3, $4, $5)
        `, [
          itemId,
          assignment.supplier_id,
          assignment.quantity || item.quantity,
          assignment.unit_cost || 0,
          (assignment.quantity || item.quantity) * (assignment.unit_cost || 0)
        ]);
      }
    }
    
    await query('COMMIT');
    
    res.status(201).json(order);
  } catch (err) {
    await query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PUT /api/purchase-orders/:id/status
// Cambiar estado de una orden
// ============================================================
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
      SET 
        status = $1,
        received_at = CASE WHEN $1 = 'received' THEN CURRENT_TIMESTAMP ELSE received_at END,
        updated_at = CURRENT_TIMESTAMP
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

// ============================================================
// DELETE /api/purchase-orders/:id
// Eliminar una orden (solo si está en draft)
// ============================================================
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
    
    await query(`
      DELETE FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    res.json({ success: true, message: 'Orden eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;