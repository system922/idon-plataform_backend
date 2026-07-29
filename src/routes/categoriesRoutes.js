import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { emitToBusiness } from '../socket.js';

const router = express.Router();

const SELECT_COLS = `
  id, 
  name, 
  description,
  is_active,
  created_at,
  updated_at
`;

/**
 * GET /api/inventory/categories
 * Obtiene todas las categorías con conteo de productos
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT 
        c.id,
        c.name,
        c.description,
        c.is_active,
        c.created_at,
        c.updated_at,
        COUNT(p.id) AS product_count
       FROM "${schema}".categories c
       LEFT JOIN "${schema}".products p ON p.category_id = c.id
       GROUP BY c.id, c.name, c.description, c.is_active, c.created_at, c.updated_at
       ORDER BY c.is_active DESC, c.name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching categories:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/inventory/categories
 * { name, description, is_active }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { name, description, is_active = true } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await query(
      `INSERT INTO "${schema}".categories (name, description, is_active)
       VALUES ($1, $2, $3) RETURNING ${SELECT_COLS}`,
      [name.trim(), description || null, is_active === true || is_active === 'true']
    );
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'created' });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    console.error('Error creating category:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/inventory/categories/:id
 * { name, description, is_active }
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { name, description, is_active } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await query(
      `UPDATE "${schema}".categories
       SET name = $1, description = $2, is_active = $3, updated_at = NOW()
       WHERE id = $4 RETURNING ${SELECT_COLS}`,
      [name.trim(), description || null, is_active === true || is_active === 'true', req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Categoría no encontrada' });
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'updated' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    console.error('Error updating category:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/inventory/categories/:id
 * Elimina una categoría solo si no tiene productos asociados
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // Verificar si tiene productos asociados
    const productCheck = await query(
      `SELECT COUNT(*) as product_count 
       FROM "${schema}".products 
       WHERE category_id = $1`,
      [req.params.id]
    );
    
    const productCount = parseInt(productCheck.rows[0].product_count) || 0;
    
    if (productCount > 0) {
      return res.status(409).json({ 
        error: `No se puede eliminar la categoría porque tiene ${productCount} ${productCount === 1 ? 'producto' : 'productos'} asociados`
      });
    }

    // Borrado físico
    const result = await query(
      `DELETE FROM "${schema}".categories WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Categoría no encontrada' });
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'deleted' });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;