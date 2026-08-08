import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/* ─────────────────────────────────────────────
   GET /api/inventory/physical
───────────────────────────────────────────── */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT *
      FROM "${schema}".inventory_physical
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/physical
───────────────────────────────────────────── */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { categories } = req.body;

    if (!categories?.length) {
      return res.status(400).json({ error: 'Categorías requeridas' });
    }

    // Crear el encabezado del inventario
    const inv = await query(`
      INSERT INTO "${schema}".inventory_physical DEFAULT VALUES
      RETURNING *
    `);
    const inventoryId = inv.rows[0].id;

    // Guardar las categorías seleccionadas
    for (const catId of categories) {
      await query(`
        INSERT INTO "${schema}".inventory_physical_categories
        (inventory_id, category_id)
        VALUES ($1, $2)
      `, [inventoryId, catId]);
    }

    // Insertar productos usando category_id (corregido)
    await query(`
      INSERT INTO "${schema}".inventory_physical_items
      (inventory_id, product_id, product_name, system_stock)
      SELECT
        $1,
        p.id,
        p.name,
        p.stock
      FROM "${schema}".products p
      JOIN "${schema}".inventory_physical_categories ic
        ON ic.category_id = p.category_id
      WHERE ic.inventory_id = $1
    `, [inventoryId]);

    res.status(201).json({ id: inventoryId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/movements
───────────────────────────────────────────── */
router.get('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT m.id, m.type, m.quantity, m.unit_cost, m.notes, m.created_at,
             p.id AS product_id, p.name AS product_name, p.code AS product_code
      FROM "${schema}".inventory_movements m
      LEFT JOIN "${schema}".products p ON p.id = m.product_id
      ORDER BY m.created_at DESC
      LIMIT 300
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/movements
───────────────────────────────────────────── */
router.post('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { product_id, type, quantity, unit_cost, notes } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ error: 'product_id, type y quantity son requeridos' });
    }

    const delta = type === 'entrada' ? Math.abs(Number(quantity)) : -Math.abs(Number(quantity));

    const { rows } = await query(`
      INSERT INTO "${schema}".inventory_movements (product_id, type, quantity, unit_cost, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [product_id, type, Math.abs(Number(quantity)), unit_cost || null, notes || null]);

    await query(`
      UPDATE "${schema}".products
      SET stock = GREATEST(0, stock + $1), updated_at = NOW()
      WHERE id = $2
    `, [delta, product_id]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'updated' });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/physical/:id
───────────────────────────────────────────── */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const items = await query(`
      SELECT *
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1
      ORDER BY product_name
    `, [req.params.id]);
    res.json({ items: items.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   PUT /api/inventory/physical/:id/items/:itemId
───────────────────────────────────────────── */
router.put('/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { counted_stock } = req.body;

    await query(`
      UPDATE "${schema}".inventory_physical_items
      SET
        counted_stock = $1,
        difference = $1 - system_stock,
        status = 'counted',
        updated_at = NOW()
      WHERE id = $2
    `, [counted_stock, req.params.itemId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/physical/:id/close
───────────────────────────────────────────── */
router.post('/:id/close', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);

    // Verificar que no queden items pendientes
    const pending = await query(`
      SELECT COUNT(*) 
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND status = 'pending'
    `, [req.params.id]);

    if (Number(pending.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Inventario incompleto' });
    }

    // Generar movimientos de ajuste
    await query(`
      INSERT INTO "${schema}".inventory_movements
      (product_id, type, quantity, reference_id)
      SELECT
        product_id,
        'adjustment',
        ABS(difference),
        inventory_id
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND difference <> 0
    `, [req.params.id]);

    // Cerrar el inventario
    await query(`
      UPDATE "${schema}".inventory_physical
      SET
        status = 'closed',
        closed_date = CURRENT_DATE,
        closed_time = CURRENT_TIME
      WHERE id = $1
    `, [req.params.id]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'closed' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/movements
   Listar movimientos de inventario
───────────────────────────────────────────── */
router.get('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { product_id, type, limit = 100 } = req.query;

    let whereClause = '';
    let params = [];

    if (product_id) {
      whereClause = 'WHERE m.product_id = $1';
      params.push(product_id);
    }

    if (type) {
      if (product_id) {
        whereClause += ' AND m.type = $2';
        params.push(type);
      } else {
        whereClause = 'WHERE m.type = $1';
        params.push(type);
      }
    }

    const result = await query(`
      SELECT 
        m.id, 
        m.type, 
        m.quantity, 
        m.unit_cost, 
        m.reference_id, 
        m.notes, 
        m.created_at,
        p.id AS product_id, 
        p.name AS product_name, 
        p.code AS product_code,
        p.stock AS current_stock
      FROM "${schema}".inventory_movements m
      LEFT JOIN "${schema}".products p ON p.id = m.product_id
      ${whereClause}
      ORDER BY m.created_at DESC
      LIMIT ${parseInt(limit)}
    `, params);

    res.json(result.rows);
  } catch (err) {
    console.error('Error listando movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/movements/stats
   Estadísticas de movimientos
───────────────────────────────────────────── */
router.get('/movements/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN type = 'entrada' THEN 1 END) as entradas,
        COUNT(CASE WHEN type = 'salida' THEN 1 END) as salidas,
        COUNT(CASE WHEN type = 'adjustment' THEN 1 END) as ajustes,
        SUM(CASE WHEN type = 'entrada' THEN quantity ELSE 0 END) as total_entradas,
        SUM(CASE WHEN type = 'salida' THEN quantity ELSE 0 END) as total_salidas,
        COUNT(DISTINCT product_id) as productos_afectados
      FROM "${schema}".inventory_movements
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo estadísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/movements/:id
   Obtener un movimiento específico
───────────────────────────────────────────── */
router.get('/movements/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const result = await query(`
      SELECT 
        m.id, 
        m.type, 
        m.quantity, 
        m.unit_cost, 
        m.reference_id, 
        m.notes, 
        m.created_at,
        p.id AS product_id, 
        p.name AS product_name, 
        p.code AS product_code
      FROM "${schema}".inventory_movements m
      LEFT JOIN "${schema}".products p ON p.id = m.product_id
      WHERE m.id = $1
    `, [id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Movimiento no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error obteniendo movimiento:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/movements
   Crear movimiento manual
───────────────────────────────────────────── */
router.post('/movements', authMiddleware, async (req, res) => {
  const client = await query.constructor.client;
  try {
    const schema = await getSchemaName(req);
    const { product_id, type, quantity, unit_cost, notes } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ error: 'product_id, type y quantity son requeridos' });
    }

    const qty = Math.abs(Number(quantity));
    const delta = type === 'entrada' ? qty : -qty;

    await client.query('BEGIN');

    // Registrar movimiento
    const { rows } = await client.query(`
      INSERT INTO "${schema}".inventory_movements 
        (product_id, type, quantity, unit_cost, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [product_id, type, qty, unit_cost || null, notes || null]);

    // Actualizar stock
    await client.query(`
      UPDATE "${schema}".products
      SET stock = GREATEST(0, stock + $1), updated_at = NOW()
      WHERE id = $2
    `, [delta, product_id]);

    await client.query('COMMIT');

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'updated' });

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando movimiento:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;