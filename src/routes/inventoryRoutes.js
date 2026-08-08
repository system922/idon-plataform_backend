import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/* ═══════════════════════════════════════════════════════════
   INVENTARIOS FÍSICOS
═══════════════════════════════════════════════════════════ */

// GET /api/inventory/physical - Listar todos los inventarios
router.get('/physical', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT 
        ip.*,
        COUNT(ipi.id) as total_items,
        COUNT(CASE WHEN ipi.status = 'counted' THEN 1 END) as counted_items,
        COUNT(CASE WHEN ipi.status = 'pending' THEN 1 END) as pending_items
      FROM "${schema}".inventory_physical ip
      LEFT JOIN "${schema}".inventory_physical_items ipi ON ipi.inventory_id = ip.id
      GROUP BY ip.id
      ORDER BY ip.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando inventarios:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/physical - Crear inventario
router.post('/physical', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { categories } = req.body;

    if (!categories?.length) {
      return res.status(400).json({ error: 'Categorías requeridas' });
    }

    const inv = await query(`
      INSERT INTO "${schema}".inventory_physical 
        (started_date, started_time, status)
      VALUES (CURRENT_DATE, CURRENT_TIME, 'open')
      RETURNING *
    `);
    const inventoryId = inv.rows[0].id;

    for (const catId of categories) {
      await query(`
        INSERT INTO "${schema}".inventory_physical_categories
        (inventory_id, category_id)
        VALUES ($1, $2)
      `, [inventoryId, catId]);
    }

    await query(`
      INSERT INTO "${schema}".inventory_physical_items
      (inventory_id, product_id, product_name, system_stock, counted_stock, difference, status)
      SELECT
        $1,
        p.id,
        p.name,
        p.stock,
        0,
        0,
        'pending'
      FROM "${schema}".products p
      WHERE p.category_id = ANY(
        SELECT category_id 
        FROM "${schema}".inventory_physical_categories 
        WHERE inventory_id = $1
      )
    `, [inventoryId]);

    await query(`
      UPDATE "${schema}".inventory_physical
      SET 
        total_items = (SELECT COUNT(*) FROM "${schema}".inventory_physical_items WHERE inventory_id = $1)
      WHERE id = $1
    `, [inventoryId]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'created' });

    res.status(201).json(inv.rows[0]);
  } catch (err) {
    console.error('Error creando inventario:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/physical/:id - Obtener detalles de un inventario
router.get('/physical/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    const inventory = await query(`
      SELECT * FROM "${schema}".inventory_physical WHERE id = $1
    `, [id]);

    if (!inventory.rows.length) {
      return res.status(404).json({ error: 'Inventario no encontrado' });
    }

    const items = await query(`
      SELECT 
        id, 
        product_id, 
        product_name, 
        system_stock, 
        counted_stock, 
        difference, 
        status,
        updated_at
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1
      ORDER BY product_name
    `, [id]);

    res.json({ 
      inventory: inventory.rows[0], 
      items: items.rows 
    });
  } catch (err) {
    console.error('Error obteniendo inventario:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/physical/:id/items/:itemId - Actualizar conteo
router.put('/physical/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id, itemId } = req.params;
    const { counted_stock } = req.body;

    if (counted_stock === undefined || counted_stock < 0) {
      return res.status(400).json({ error: 'Conteo inválido' });
    }

    await query(`
      UPDATE "${schema}".inventory_physical_items
      SET
        counted_stock = $1,
        difference = $1 - system_stock,
        status = 'counted',
        updated_at = NOW()
      WHERE id = $2 AND inventory_id = $3
    `, [counted_stock, itemId, id]);

    await query(`
      UPDATE "${schema}".inventory_physical
      SET 
        counted_items = (SELECT COUNT(*) FROM "${schema}".inventory_physical_items WHERE inventory_id = $1 AND status = 'counted'),
        pending_items = (SELECT COUNT(*) FROM "${schema}".inventory_physical_items WHERE inventory_id = $1 AND status = 'pending')
      WHERE id = $1
    `, [id]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'updated' });

    res.json({ success: true });
  } catch (err) {
    console.error('Error actualizando item:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/physical/:id/close - Cerrar inventario (SOLO guarda en inventory_physical)
router.post('/physical/:id/close', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    const pending = await query(`
      SELECT COUNT(*) as count
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND status = 'pending'
    `, [id]);

    if (Number(pending.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: `Inventario incompleto: ${pending.rows[0].count} productos pendientes` 
      });
    }

    await query(`
      UPDATE "${schema}".inventory_physical
      SET
        status = 'closed',
        closed_date = CURRENT_DATE,
        closed_time = CURRENT_TIME,
        updated_at = NOW()
      WHERE id = $1
    `, [id]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'closed' });

    res.json({ 
      success: true, 
      message: 'Inventario cerrado correctamente'
    });
  } catch (err) {
    console.error('Error cerrando inventario:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   INVENTARIOS CERRADOS PARA AJUSTES
═══════════════════════════════════════════════════════════ */

// GET /api/inventory/closed - Obtener inventarios cerrados con diferencias
router.get('/closed', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT 
        ip.id,
        ip.created_at,
        ip.closed_date,
        ip.closed_time,
        ip.total_items,
        COUNT(CASE WHEN ipi.difference <> 0 THEN 1 END) as items_with_difference,
        json_agg(
          json_build_object(
            'id', ipi.id,
            'product_id', ipi.product_id,
            'product_name', ipi.product_name,
            'system_stock', ipi.system_stock,
            'counted_stock', ipi.counted_stock,
            'difference', ipi.difference,
            'status', ipi.status
          ) ORDER BY ipi.product_name
        ) as items
      FROM "${schema}".inventory_physical ip
      LEFT JOIN "${schema}".inventory_physical_items ipi ON ipi.inventory_id = ip.id
      WHERE ip.status = 'closed'
      GROUP BY ip.id
      ORDER BY ip.closed_date DESC, ip.closed_time DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error obteniendo inventarios cerrados:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/closed/:id - Obtener inventario cerrado con items
router.get('/closed/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    const inventory = await query(`
      SELECT * FROM "${schema}".inventory_physical 
      WHERE id = $1 AND status = 'closed'
    `, [id]);

    if (!inventory.rows.length) {
      return res.status(404).json({ error: 'Inventario cerrado no encontrado' });
    }

    const items = await query(`
      SELECT 
        id, 
        product_id, 
        product_name, 
        system_stock, 
        counted_stock, 
        difference, 
        status,
        updated_at
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1
      ORDER BY product_name
    `, [id]);

    res.json({ 
      inventory: inventory.rows[0], 
      items: items.rows 
    });
  } catch (err) {
    console.error('Error obteniendo inventario cerrado:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/closed/:id/apply - Aplicar ajustes de inventario cerrado
router.post('/closed/:id/apply', authMiddleware, async (req, res) => {
  const client = await query.constructor.client;
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { product_ids = [] } = req.body;

    await client.query('BEGIN');

    // Verificar que el inventario existe y está cerrado
    const invCheck = await client.query(`
      SELECT id FROM "${schema}".inventory_physical 
      WHERE id = $1 AND status = 'closed'
    `, [id]);

    if (!invCheck.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Inventario cerrado no encontrado' });
    }

    // Obtener items con diferencias
    let itemsQuery = `
      SELECT 
        id, 
        product_id, 
        product_name,
        system_stock, 
        counted_stock, 
        difference
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND difference <> 0
    `;

    const params = [id];
    if (product_ids.length > 0) {
      itemsQuery += ` AND product_id = ANY($2)`;
      params.push(product_ids);
    }

    const items = await client.query(itemsQuery, params);

    if (!items.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No hay diferencias para ajustar' });
    }

    // Registrar movimientos y actualizar stock
    for (const item of items.rows) {
      // Calcular nuevo stock
      const newStock = item.system_stock + item.difference;

      // Registrar en inventory_movements
      await client.query(`
        INSERT INTO "${schema}".inventory_movements
        (product_id, type, quantity, reference_id, notes, applied)
        VALUES ($1, 'adjustment', $2, $3, $4, true)
      `, [
        item.product_id,
        Math.abs(item.difference),
        id,
        `Ajuste aplicado desde inventario #${id} - ${item.product_name}`
      ]);

      // Actualizar stock del producto
      await client.query(`
        UPDATE "${schema}".products
        SET stock = GREATEST(0, $1), updated_at = NOW()
        WHERE id = $2
      `, [newStock, item.product_id]);
    }

    // Marcar los items como ajustados (opcional: agregar columna adjusted)
    await client.query(`
      UPDATE "${schema}".inventory_physical_items
      SET status = 'adjusted', updated_at = NOW()
      WHERE inventory_id = $1 AND difference <> 0
    `, [id]);

    await client.query('COMMIT');

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'adjustments_applied' });

    res.json({ 
      success: true, 
      message: `Se aplicaron ${items.rows.length} ajuste(s) correctamente`,
      adjustments: items.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error aplicando ajustes:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ═══════════════════════════════════════════════════════════
   MOVIMIENTOS DE INVENTARIO (para la tabla de la página)
═══════════════════════════════════════════════════════════ */

// GET /api/inventory/movements - Listar movimientos
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
        m.applied,
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

// GET /api/inventory/movements/stats - Estadísticas
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

// POST /api/inventory/movements - Crear movimiento manual
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

    const { rows } = await client.query(`
      INSERT INTO "${schema}".inventory_movements 
        (product_id, type, quantity, unit_cost, notes, applied)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `, [product_id, type, qty, unit_cost || null, notes || null]);

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