// routes/inventory.routes.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/* ─────────────────────────────────────────────
   GET /api/inventory/physical
   Lista todos los inventarios físicos
───────────────────────────────────────────── */
router.get('/physical', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Schema no encontrado' });
    }

    const result = await query(`
      SELECT 
        ip.id, 
        ip.status, 
        ip.started_date, 
        ip.started_time,
        ip.closed_date, 
        ip.closed_time,
        ip.total_items,
        ip.counted_items,
        ip.pending_items,
        ip.notes,
        ip.created_at,
        COUNT(ipi.id) as total_products,
        COUNT(CASE WHEN ipi.status = 'counted' THEN 1 END) as counted_products,
        COUNT(CASE WHEN ipi.status = 'pending' THEN 1 END) as pending_products
      FROM "${schema}".inventory_physical ip
      LEFT JOIN "${schema}".inventory_physical_items ipi ON ipi.inventory_id = ip.id
      GROUP BY ip.id
      ORDER BY ip.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando inventarios:', err);
    res.status(500).json({ error: err.message || 'Error cargando inventarios' });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/physical
   Crear un nuevo inventario físico
───────────────────────────────────────────── */
router.post('/physical', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Schema no encontrado' });
    }

    const { categories } = req.body;

    if (!categories?.length) {
      return res.status(400).json({ error: 'Categorías requeridas' });
    }

    // 1. Crear el encabezado del inventario
    const inv = await query(`
      INSERT INTO "${schema}".inventory_physical 
        (started_date, started_time, status)
      VALUES (CURRENT_DATE, CURRENT_TIME, 'open')
      RETURNING *
    `);
    const inventoryId = inv.rows[0].id;

    // 2. Guardar las categorías seleccionadas
    for (const catId of categories) {
      await query(`
        INSERT INTO "${schema}".inventory_physical_categories
        (inventory_id, category_id)
        VALUES ($1, $2)
      `, [inventoryId, catId]);
    }

    // 3. Insertar productos de las categorías seleccionadas
    await query(`
      INSERT INTO "${schema}".inventory_physical_items
      (inventory_id, product_id, product_name, system_stock, counted_stock, difference, status)
      SELECT
        $1 AS inventory_id,
        p.id,
        p.name,
        p.stock,
        0 AS counted_stock,
        0 AS difference,
        'pending' AS status
      FROM "${schema}".products p
      WHERE p.category_id = ANY(
        SELECT category_id 
        FROM "${schema}".inventory_physical_categories 
        WHERE inventory_id = $1
      )
    `, [inventoryId]);

    // 4. Actualizar contadores
    await query(`
      UPDATE "${schema}".inventory_physical
      SET 
        total_items = (SELECT COUNT(*) FROM "${schema}".inventory_physical_items WHERE inventory_id = $1),
        pending_items = (SELECT COUNT(*) FROM "${schema}".inventory_physical_items WHERE inventory_id = $1 AND status = 'pending')
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

/* ─────────────────────────────────────────────
   GET /api/inventory/physical/:id
   Obtener detalles de un inventario
───────────────────────────────────────────── */
router.get('/physical/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Schema no encontrado' });
    }

    const { id } = req.params;

    // Obtener el inventario
    const inventory = await query(`
      SELECT * FROM "${schema}".inventory_physical WHERE id = $1
    `, [id]);

    if (!inventory.rows.length) {
      return res.status(404).json({ error: 'Inventario no encontrado' });
    }

    // Obtener los items
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

/* ─────────────────────────────────────────────
   PUT /api/inventory/physical/:id/items/:itemId
   Actualizar conteo de un producto
───────────────────────────────────────────── */
router.put('/physical/:id/items/:itemId', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Schema no encontrado' });
    }

    const { id, itemId } = req.params;
    const { counted_stock } = req.body;

    if (counted_stock === undefined || counted_stock < 0) {
      return res.status(400).json({ error: 'Conteo inválido' });
    }

    // Actualizar el item
    await query(`
      UPDATE "${schema}".inventory_physical_items
      SET
        counted_stock = $1,
        difference = $1 - system_stock,
        status = 'counted',
        updated_at = NOW()
      WHERE id = $2 AND inventory_id = $3
    `, [counted_stock, itemId, id]);

    // Actualizar contadores del inventario
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

/* ─────────────────────────────────────────────
   POST /api/inventory/physical/:id/close
   Cerrar inventario y generar ajustes
───────────────────────────────────────────── */
router.post('/physical/:id/close', authMiddleware, async (req, res) => {
  const client = await query.constructor.client;
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Schema no encontrado' });
    }

    const { id } = req.params;

    await client.query('BEGIN');

    // 1. Verificar que no queden items pendientes
    const pending = await client.query(`
      SELECT COUNT(*) as count
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND status = 'pending'
    `, [id]);

    if (Number(pending.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Inventario incompleto' });
    }

    // 2. Obtener items con diferencias
    const diffItems = await client.query(`
      SELECT 
        product_id, 
        difference,
        system_stock,
        counted_stock
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND difference <> 0
    `, [id]);

    // 3. Generar movimientos de ajuste para cada producto con diferencia
    for (const item of diffItems.rows) {
      const adjustedStock = item.system_stock + item.difference;
      
      // Registrar movimiento de ajuste
      await client.query(`
        INSERT INTO "${schema}".inventory_movements 
          (product_id, type, quantity, unit_cost, notes, reference_id)
        VALUES (
          $1, 
          'adjustment', 
          $2, 
          NULL,
          $3,
          $4
        )
      `, [
        item.product_id,
        Math.abs(item.difference),
        `Ajuste por inventario físico #${id}`,
        id
      ]);

      // Actualizar stock del producto
      await client.query(`
        UPDATE "${schema}".products
        SET 
          stock = GREATEST(0, $1),
          updated_at = NOW()
        WHERE id = $2
      `, [adjustedStock, item.product_id]);
    }

    // 4. Cerrar el inventario
    await client.query(`
      UPDATE "${schema}".inventory_physical
      SET
        status = 'closed',
        closed_date = CURRENT_DATE,
        closed_time = CURRENT_TIME,
        updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await client.query('COMMIT');

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'closed' });

    res.json({ 
      success: true, 
      message: 'Inventario cerrado correctamente',
      adjustments: diffItems.rows.length
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error cerrando inventario:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;