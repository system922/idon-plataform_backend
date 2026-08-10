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
    console.error('Error en GET /purchase-orders:', err);
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
        COALESCE(
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
          ) FILTER (WHERE pois.id IS NOT NULL),
          '[]'::json
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
    console.error('Error en GET /purchase-orders/:id:', err);
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
              'total_cost', ri.quantity * rm.unit_cost,
              'stock', rm.stock,
              'min_stock', rm.min_stock
            )
          ) FILTER (WHERE ri.raw_material_id IS NOT NULL),
          '[]'::json
        ) as ingredients
      FROM "${schema}".products p
      INNER JOIN "${schema}".recipes r ON p.id = r.product_id AND r.is_active = true
      LEFT JOIN "${schema}".recipe_ingredients ri ON r.id = ri.recipe_id
      LEFT JOIN "${schema}".raw_materials rm ON ri.raw_material_id = rm.id AND rm.is_active = true
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
    console.error('Error en GET /purchase-orders/suggestions/items:', err);
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
    console.error('Error en GET /purchase-orders/suppliers/:productId:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/products/with-recipe
// Obtener productos con sus recetas y materiales (OPTIMIZADO)
// ============================================================
router.get('/products/with-recipe', authMiddleware, async (req, res) => {
  try {
    const { product_type } = req.query;
    
    if (!['COMMERCIAL', 'MANUFACTURED'].includes(product_type)) {
      return res.status(400).json({
        error: 'product_type debe ser COMMERCIAL o MANUFACTURED'
      });
    }
    
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT
        p.id,
        p.code,
        p.name,
        p.description,
        p.category_id,
        p.unit_cost,
        p.selling_price,
        p.tax_rate,
        p.is_taxable,
        p.is_active,
        p.sku,
        p.barcode,
        p.stock,
        p.min_stock,
        p.created_at,
        p.updated_at,
        p.product_type,

        r.id AS recipe_id,
        r.description AS recipe_description,
        r.yield_qty,
        r.yield_unit,
        r.total_cost AS recipe_total_cost,

        CASE
            WHEN p.product_type = 'MANUFACTURED'
            THEN COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'id', rm.id,
                        'code', rm.code,
                        'name', rm.name,
                        'description', rm.description,
                        'unit', rm.unit,
                        'quantity', ri.quantity,
                        'conversion_factor', ri.conversion_factor,
                        'unit_cost', ri.unit_cost,
                        'total_cost', ri.total_cost,
                        'stock', rm.stock,
                        'min_stock', rm.min_stock,
                        'is_active', rm.is_active,
                        'barcode', rm.barcode,
                        'sku', rm.sku
                    )
                    ORDER BY rm.name
                ) FILTER (WHERE rm.id IS NOT NULL),
                '[]'::jsonb
            )
            ELSE '[]'::jsonb
        END AS materials

    FROM "${schema}".products p

    LEFT JOIN "${schema}".recipes r
        ON r.product_id = p.id
        AND r.is_active = true

    LEFT JOIN "${schema}".recipe_ingredients ri
        ON ri.recipe_id = r.id

    LEFT JOIN "${schema}".raw_materials rm
        ON rm.id = ri.raw_material_id
        AND rm.is_active = true

    WHERE
        p.is_active = true
        AND p.product_type = $1
        AND (
            p.product_type = 'COMMERCIAL'
            OR (
                p.product_type = 'MANUFACTURED'
                AND r.id IS NOT NULL
            )
        )

    GROUP BY
        p.id,
        p.code,
        p.name,
        p.description,
        p.category_id,
        p.unit_cost,
        p.selling_price,
        p.tax_rate,
        p.is_taxable,
        p.is_active,
        p.sku,
        p.barcode,
        p.stock,
        p.min_stock,
        p.created_at,
        p.updated_at,
        p.product_type,
        r.id,
        r.description,
        r.yield_qty,
        r.yield_unit,
        r.total_cost

    ORDER BY p.name
    `, [product_type]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-orders/products/with-recipe:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/products/commercial
// Obtener solo productos comerciales con su stock
// ============================================================
router.get('/products/commercial', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { search, category_id } = req.query;
    
    let whereClause = `p.product_type = 'COMMERCIAL' AND p.is_active = true`;
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.code ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (category_id) {
      whereClause += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }
    
    const result = await query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.description,
        p.barcode,
        p.sku,
        p.stock,
        p.min_stock,
        p.unit_cost,
        p.selling_price,
        p.category_id,
        c.name as category_name,
        p.is_active,
        p.created_at,
        p.updated_at
      FROM "${schema}".products p
      LEFT JOIN "${schema}".categories c ON p.category_id = c.id
      WHERE ${whereClause}
      ORDER BY p.name ASC
    `, params);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-orders/products/commercial:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/products/manufactured
// Obtener solo productos manufacturados con su receta
// ============================================================
router.get('/products/manufactured', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { search, category_id } = req.query;
    
    let whereClause = `p.product_type = 'MANUFACTURED' AND p.is_active = true`;
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause += ` AND (p.name ILIKE $${paramIndex} OR p.code ILIKE $${paramIndex} OR p.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (category_id) {
      whereClause += ` AND p.category_id = $${paramIndex}`;
      params.push(category_id);
      paramIndex++;
    }
    
    const result = await query(`
      SELECT 
        p.id,
        p.code,
        p.name,
        p.description,
        p.barcode,
        p.sku,
        p.stock,
        p.min_stock,
        p.unit_cost,
        p.selling_price,
        p.category_id,
        c.name as category_name,
        p.is_active,
        p.created_at,
        p.updated_at,
        r.id as recipe_id,
        r.description as recipe_description,
        r.yield_qty,
        r.yield_unit,
        r.total_cost as recipe_total_cost,
        COALESCE(
          json_agg(
            json_build_object(
              'id', rm.id,
              'code', rm.code,
              'name', rm.name,
              'description', rm.description,
              'unit', rm.unit,
              'quantity', ri.quantity,
              'conversion_factor', ri.conversion_factor,
              'unit_cost', ri.unit_cost,
              'total_cost', ri.total_cost,
              'stock', rm.stock,
              'min_stock', rm.min_stock,
              'barcode', rm.barcode,
              'sku', rm.sku
            )
            ORDER BY rm.name
          ) FILTER (WHERE rm.id IS NOT NULL),
          '[]'::json
        ) as materials
      FROM "${schema}".products p
      INNER JOIN "${schema}".recipes r ON p.id = r.product_id AND r.is_active = true
      LEFT JOIN "${schema}".recipe_ingredients ri ON r.id = ri.recipe_id
      LEFT JOIN "${schema}".raw_materials rm ON ri.raw_material_id = rm.id AND rm.is_active = true
      LEFT JOIN "${schema}".categories c ON p.category_id = c.id
      WHERE ${whereClause}
      GROUP BY p.id, c.name, r.id
      ORDER BY p.name ASC
    `, params);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-orders/products/manufactured:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/raw-materials
// Obtener materias primas con su stock
// ============================================================
router.get('/raw-materials', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { search, is_active } = req.query;
    
    let whereClause = `1 = 1`;
    const params = [];
    let paramIndex = 1;
    
    if (search) {
      whereClause += ` AND (rm.name ILIKE $${paramIndex} OR rm.code ILIKE $${paramIndex} OR rm.barcode ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      whereClause += ` AND rm.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    const result = await query(`
      SELECT 
        rm.id,
        rm.code,
        rm.name,
        rm.description,
        rm.unit,
        rm.stock,
        rm.min_stock,
        rm.unit_cost,
        rm.barcode,
        rm.sku,
        rm.is_active,
        rm.is_composite,
        rm.recipe_id,
        rm.created_at,
        rm.updated_at,
        r.description as recipe_description,
        r.yield_qty as recipe_yield_qty,
        r.yield_unit as recipe_yield_unit
      FROM "${schema}".raw_materials rm
      LEFT JOIN "${schema}".recipes r ON rm.recipe_id = r.id AND r.is_active = true
      WHERE ${whereClause}
      ORDER BY rm.name ASC
    `, params);
    
    res.json(result.rows);
  } catch (err) {
    console.error('Error en GET /purchase-orders/raw-materials:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/raw-materials/:id
// Obtener una materia prima específica
// ============================================================
router.get('/raw-materials/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        rm.id,
        rm.code,
        rm.name,
        rm.description,
        rm.unit,
        rm.stock,
        rm.min_stock,
        rm.unit_cost,
        rm.barcode,
        rm.sku,
        rm.is_active,
        rm.is_composite,
        rm.recipe_id,
        rm.created_at,
        rm.updated_at,
        r.description as recipe_description,
        r.yield_qty as recipe_yield_qty,
        r.yield_unit as recipe_yield_unit
      FROM "${schema}".raw_materials rm
      LEFT JOIN "${schema}".recipes r ON rm.recipe_id = r.id AND r.is_active = true
      WHERE rm.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Materia prima no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /purchase-orders/raw-materials/:id:', err);
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
      items
    } = req.body;
    
    const schema = await getSchemaName(req);
    const userId = req.user.id;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Se requieren items para la orden' });
    }
    
    // Validar items
    for (const item of items) {
      if (!item.source_type || !['COMMERCIAL', 'MANUFACTURED'].includes(item.source_type)) {
        return res.status(400).json({ error: 'Tipo de fuente inválido' });
      }
      if (!item.quantity || item.quantity <= 0) {
        return res.status(400).json({ error: 'Cantidad debe ser mayor a 0' });
      }
    }
    
    // Generar número de orden
    const numberResult = await query(`
      SELECT 
        'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
        LPAD(COALESCE(
          (SELECT MAX(CAST(SUBSTRING(order_number FROM '-(\\d+)$') AS INTEGER)) 
           FROM "${schema}".purchase_orders 
           WHERE order_number LIKE 'OC-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-%'), 
          0)::text, 
        4, 
        '0'
        ) as order_number
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
    for (const item of items) {
      await query(`
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
    }
    
    await query('COMMIT');
    
    // Obtener la orden creada con sus items
    const result = await query(`
      SELECT 
        po.*,
        COUNT(DISTINCT poi.id) as item_count,
        COUNT(DISTINCT pois.supplier_id) as supplier_count,
        COALESCE(SUM(pois.line_total), 0) as total
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".purchase_order_items poi ON po.id = poi.purchase_order_id
      LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON poi.id = pois.purchase_order_item_id
      WHERE po.id = $1
      GROUP BY po.id
    `, [order.id]);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await query('ROLLBACK');
    console.error('Error en POST /purchase-orders:', err);
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
    
    // Verificar que la orden existe
    const checkResult = await query(`
      SELECT status FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    
    const currentStatus = checkResult.rows[0].status;
    
    // Validar transiciones de estado
    const validTransitions = {
      'draft': ['pending', 'cancelled'],
      'pending': ['approved', 'cancelled'],
      'approved': ['received', 'cancelled'],
      'received': [],
      'cancelled': []
    };
    
    if (!validTransitions[currentStatus].includes(status)) {
      return res.status(400).json({ 
        error: `No se puede cambiar de "${currentStatus}" a "${status}"` 
      });
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
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en PUT /purchase-orders/:id/status:', err);
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
    
    // Eliminar los items primero (por FK)
    await query(`
      DELETE FROM "${schema}".purchase_order_items WHERE purchase_order_id = $1
    `, [id]);
    
    // Eliminar la orden
    await query(`
      DELETE FROM "${schema}".purchase_orders WHERE id = $1
    `, [id]);
    
    res.json({ success: true, message: 'Orden eliminada correctamente' });
  } catch (err) {
    console.error('Error en DELETE /purchase-orders/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET /api/purchase-orders/stats
// Obtener estadísticas de órdenes
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    
    const result = await query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) as draft_count,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN status = 'approved' THEN 1 END) as approved_count,
        COUNT(CASE WHEN status = 'received' THEN 1 END) as received_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_count,
        COALESCE(SUM(pois.line_total), 0) as total_value
      FROM "${schema}".purchase_orders po
      LEFT JOIN "${schema}".purchase_order_items poi ON po.id = poi.purchase_order_id
      LEFT JOIN "${schema}".purchase_order_item_suppliers pois ON poi.id = pois.purchase_order_item_id
    `);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error en GET /purchase-orders/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;