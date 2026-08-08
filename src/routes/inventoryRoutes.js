import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

/* ─────────────────────────────────────────────
   GET /api/inventory/movements
   Listar todos los movimientos con información del producto
───────────────────────────────────────────── */
router.get('/movements', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
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
      ORDER BY m.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando movimientos:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   GET /api/inventory/movements/product/:productId
   Listar movimientos de un producto específico
───────────────────────────────────────────── */
router.get('/movements/product/:productId', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { productId } = req.params;
    const result = await query(`
      SELECT 
        m.id, 
        m.type, 
        m.quantity, 
        m.unit_cost, 
        m.reference_id, 
        m.notes, 
        m.created_at,
        p.name AS product_name,
        p.code AS product_code
      FROM "${schema}".inventory_movements m
      LEFT JOIN "${schema}".products p ON p.id = m.product_id
      WHERE m.product_id = $1
      ORDER BY m.created_at DESC
    `, [productId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error listando movimientos del producto:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/movements
   Crear un movimiento manual (ajuste manual)
───────────────────────────────────────────── */
router.post('/movements', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    const { product_id, type, quantity, unit_cost, notes } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ error: 'product_id, type y quantity son requeridos' });
    }

    const qty = Math.abs(Number(quantity));
    const delta = type === 'entrada' ? qty : -qty;

    await client.query('BEGIN');

    // 1. Registrar el movimiento
    const { rows } = await client.query(`
      INSERT INTO "${schema}".inventory_movements 
        (product_id, type, quantity, unit_cost, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [product_id, type, qty, unit_cost || null, notes || null]);

    // 2. Actualizar el stock del producto
    await client.query(`
      UPDATE "${schema}".products
      SET 
        stock = GREATEST(0, stock + $1),
        updated_at = NOW()
      WHERE id = $2
    `, [delta, product_id]);

    await client.query('COMMIT');

    // 3. Emitir evento para actualizar en tiempo real
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { 
      entity: 'inventory', 
      action: 'movement_created',
      data: rows[0]
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creando movimiento:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ─────────────────────────────────────────────
   POST /api/inventory/movements/:id/apply
   Aplicar un ajuste pendiente (si existe)
───────────────────────────────────────────── */
router.post('/movements/:id/apply', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    await client.query('BEGIN');

    // 1. Obtener el movimiento
    const { rows: moveRows } = await client.query(`
      SELECT * FROM "${schema}".inventory_movements 
      WHERE id = $1 AND type = 'adjustment'
    `, [id]);

    if (!moveRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Movimiento no encontrado o no es ajuste' });
    }

    const movement = moveRows[0];
    const delta = movement.type === 'entrada' ? movement.quantity : -movement.quantity;

    // 2. Actualizar el stock
    await client.query(`
      UPDATE "${schema}".products
      SET 
        stock = GREATEST(0, stock + $1),
        updated_at = NOW()
      WHERE id = $2
    `, [delta, movement.product_id]);

    // 3. Marcar como aplicado (opcional: agregar columna applied_at)
    // Nota: Si quieres saber si un ajuste ya fue aplicado, agrega la columna applied_at

    await client.query('COMMIT');

    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { 
      entity: 'inventory', 
      action: 'movement_applied'
    });

    res.json({ success: true, message: 'Ajuste aplicado correctamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error aplicando ajuste:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

export default router;