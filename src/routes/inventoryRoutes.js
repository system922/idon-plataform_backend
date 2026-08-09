import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/* ─────────────────────────────────────────────
   GET /api/inventory/physical
   Listar todos los inventarios físicos
───────────────────────────────────────────── */
router.get('/physical', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

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
    console.error('Error in GET /physical:', err);
    res.status(500).json({ error: err.message });
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
      return res.status(400).json({ error: 'Business context required' });
    }

    const { categories } = req.body;

    if (!categories?.length) {
      return res.status(400).json({ error: 'Categorías requeridas' });
    }

    // Crear el encabezado del inventario
    const inv = await query(`
      INSERT INTO "${schema}".inventory_physical 
        (started_date, started_time, status)
      VALUES (CURRENT_DATE, CURRENT_TIME, 'open')
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

    // Insertar productos de las categorías seleccionadas
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

    // Actualizar contadores
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
    console.error('Error in POST /physical:', err);
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
      return res.status(400).json({ error: 'Business context required' });
    }

    const { id } = req.params;

    const inventory = await query(`
      SELECT * FROM "${schema}".inventory_physical WHERE id = $1
    `, [id]);

    if (!inventory.rows.length) {
      return res.status(404).json({ error: 'Inventario no encontrado' });
    }

    const items = await query(`
      SELECT 
        ipi.id, 
        ipi.product_id, 
        ipi.product_name, 
        ipi.system_stock, 
        ipi.counted_stock, 
        ipi.difference, 
        ipi.status,
        ipi.updated_at,
        p.code AS product_code,
        p.barcode AS product_barcode,
        p.description AS product_description,
        p.category_id,
        c.name AS category_name
      FROM "${schema}".inventory_physical_items ipi
      LEFT JOIN "${schema}".products p ON p.id = ipi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE ipi.inventory_id = $1
      ORDER BY ipi.product_name
    `, [id]);

    res.json({ 
      inventory: inventory.rows[0], 
      items: items.rows 
    });
  } catch (err) {
    console.error('Error in GET /physical/:id:', err);
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
      return res.status(400).json({ error: 'Business context required' });
    }

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
    console.error('Error in PUT /physical/:id/items/:itemId:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/physical/:id/close
   Cerrar inventario
───────────────────────────────────────────── */
router.post('/physical/:id/close', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { id } = req.params;

    // Verificar que no queden items pendientes
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

    // Cerrar el inventario
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
    console.error('Error in POST /physical/:id/close:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   INVENTARIOS CERRADOS PARA AJUSTES
═══════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   GET /api/inventory/closed
   Obtener inventarios cerrados con diferencias
───────────────────────────────────────────── */
router.get('/closed', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

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
            'product_code', p.code,
            'product_barcode', p.barcode,
            'product_description', p.description,
            'category_id', p.category_id,
            'category_name', c.name,
            'system_stock', ipi.system_stock,
            'counted_stock', ipi.counted_stock,
            'difference', ipi.difference,
            'status', ipi.status
          ) ORDER BY ipi.product_name
        ) as items
      FROM "${schema}".inventory_physical ip
      LEFT JOIN "${schema}".inventory_physical_items ipi ON ipi.inventory_id = ip.id
      LEFT JOIN "${schema}".products p ON p.id = ipi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE ip.status = 'closed'
      GROUP BY ip.id
      ORDER BY ip.closed_date DESC, ip.closed_time DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error in GET /closed:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/closed/:id
   Obtener inventario cerrado con items
───────────────────────────────────────────── */
router.get('/closed/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

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
        ipi.id, 
        ipi.product_id, 
        ipi.product_name, 
        ipi.system_stock, 
        ipi.counted_stock, 
        ipi.difference, 
        ipi.status,
        ipi.updated_at,
        p.code AS product_code,
        p.barcode AS product_barcode,
        p.description AS product_description,
        p.category_id,
        c.name AS category_name
      FROM "${schema}".inventory_physical_items ipi
      LEFT JOIN "${schema}".products p ON p.id = ipi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE ipi.inventory_id = $1
      ORDER BY ipi.product_name
    `, [id]);

    res.json({ 
      inventory: inventory.rows[0], 
      items: items.rows 
    });
  } catch (err) {
    console.error('Error in GET /closed/:id:', err);
    res.status(500).json({ error: err.message });
  }
});


/* ─────────────────────────────────────────────
   POST /api/inventory/closed/:id/apply
   Aplicar ajustes de inventario cerrado
───────────────────────────────────────────── */
router.post('/closed/:id/apply', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { id } = req.params;
    const { product_ids = [] } = req.body;

    // 1. Verificar que el inventario existe y está cerrado
    const invCheck = await query(`
      SELECT id FROM "${schema}".inventory_physical 
      WHERE id = $1 AND status = 'closed'
    `, [id]);

    if (!invCheck.rows.length) {
      return res.status(404).json({ error: 'Inventario cerrado no encontrado' });
    }

    // 2. Obtener items con diferencias que NO estén ajustados
    let itemsQuery = `
      SELECT 
        id, 
        product_id, 
        product_name,
        system_stock, 
        counted_stock, 
        difference
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 
        AND difference <> 0 
        AND status != 'adjusted'
    `;

    const params = [id];
    if (product_ids.length > 0) {
      itemsQuery += ` AND product_id = ANY($2::uuid[])`;
      params.push(product_ids);
    }

    const items = await query(itemsQuery, params);

    if (!items.rows.length) {
      const alreadyAdjusted = await query(`
        SELECT COUNT(*) as count
        FROM "${schema}".inventory_physical_items
        WHERE inventory_id = $1 AND status = 'adjusted'
      `, [id]);

      if (Number(alreadyAdjusted.rows[0].count) > 0) {
        const pendingItems = await query(`
          SELECT COUNT(*) as count
          FROM "${schema}".inventory_physical_items
          WHERE inventory_id = $1 AND difference <> 0 AND status != 'adjusted'
        `, [id]);

        if (Number(pendingItems.rows[0].count) === 0) {
          return res.status(400).json({ 
            error: 'Todos los productos de este inventario ya han sido ajustados.',
            code: 'ALL_ADJUSTED'
          });
        }
      }

      const hasDifferences = await query(`
        SELECT COUNT(*) as count
        FROM "${schema}".inventory_physical_items
        WHERE inventory_id = $1 AND difference <> 0
      `, [id]);

      if (Number(hasDifferences.rows[0].count) === 0) {
        return res.status(400).json({ error: 'No hay diferencias para ajustar' });
      }

      if (product_ids.length > 0) {
        return res.status(400).json({ 
          error: 'Los productos seleccionados ya han sido ajustados o no tienen diferencias.',
          code: 'PRODUCTS_ALREADY_ADJUSTED'
        });
      }

      return res.status(400).json({ error: 'No hay productos pendientes para ajustar' });
    }

    // 3. Registrar movimientos y actualizar stock
    let adjustmentsCount = 0;
    const adjustedProductIds = [];

    for (const item of items.rows) {
      const newStock = item.system_stock + item.difference;

      // ✅ REGISTRAR COMO ADJUSTMENT (NO como entrada/salida)
      // La cantidad siempre es positiva (valor absoluto de la diferencia)
      // El signo se infiere del contexto (diferencia positiva = aumento de stock)
      const adjustmentQuantity = Math.abs(item.difference);
      const sign = item.difference > 0 ? '+' : '-';

      // Registrar en inventory_movements como 'adjustment'
      await query(`
        INSERT INTO "${schema}".inventory_movements
        (product_id, type, quantity, unit_cost, reference_id, notes, applied)
        VALUES ($1, 'adjustment', $2, $3, $4, $5, true)
      `, [
        item.product_id,
        adjustmentQuantity,  // ✅ SIEMPRE POSITIVO
        null,  // unit_cost
        parseInt(id),
        `Ajuste aplicado desde inventario #${id} - ${item.product_name} (${sign}${adjustmentQuantity})`
      ]);

      // Actualizar stock del producto
      await query(`
        UPDATE "${schema}".products
        SET stock = GREATEST(0, $1), updated_at = NOW()
        WHERE id = $2
      `, [newStock, item.product_id]);

      // Marcar SOLO este item como ajustado
      await query(`
        UPDATE "${schema}".inventory_physical_items
        SET status = 'adjusted', updated_at = NOW()
        WHERE id = $1
      `, [item.id]);

      adjustmentsCount++;
      adjustedProductIds.push({
        product_id: item.product_id,
        product_name: item.product_name,
        difference: item.difference,
        adjustment_quantity: adjustmentQuantity,
        sign: sign
      });
    }

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'adjustments_applied' });

    // 4. Verificar si quedan productos pendientes
    const remainingItems = await query(`
      SELECT COUNT(*) as count
      FROM "${schema}".inventory_physical_items
      WHERE inventory_id = $1 AND difference <> 0 AND status != 'adjusted'
    `, [id]);

    const remainingCount = Number(remainingItems.rows[0].count);

    res.json({ 
      success: true, 
      message: `Se aplicaron ${adjustmentsCount} ajuste(s) correctamente. ${remainingCount > 0 ? `Quedan ${remainingCount} producto(s) pendientes por ajustar.` : 'Todos los productos han sido ajustados.'}`,
      adjustments: adjustmentsCount,
      remaining: remainingCount,
      adjusted_products: adjustedProductIds
    });
  } catch (err) {
    console.error('Error in POST /closed/:id/apply:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ═══════════════════════════════════════════════════════════
   MOVIMIENTOS DE INVENTARIO
═══════════════════════════════════════════════════════════ */

/* ─────────────────────────────────────────────
   GET /api/inventory/movements
   Listar movimientos de inventario
───────────────────────────────────────────── */
router.get('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

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
    console.error('Error in GET /movements:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/movements
   Crear movimiento manual (entrada/salida)
───────────────────────────────────────────── */
router.post('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { product_id, type, quantity, unit_cost, notes } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ error: 'product_id, type y quantity son requeridos' });
    }

    const qty = Math.abs(Number(quantity));
    const delta = type === 'entrada' ? qty : -qty;

    // Registrar movimiento
    const { rows } = await query(`
      INSERT INTO "${schema}".inventory_movements 
        (product_id, type, quantity, unit_cost, notes, applied)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING *
    `, [product_id, type, qty, unit_cost || null, notes || null]);

    // Actualizar stock
    await query(`
      UPDATE "${schema}".products
      SET stock = GREATEST(0, stock + $1), updated_at = NOW()
      WHERE id = $2
    `, [delta, product_id]);

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'inventory', action: 'updated' });

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Error in POST /movements:', err);
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
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

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
    console.error('Error in GET /movements/stats:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;