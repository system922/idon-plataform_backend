// src/routes/inventory/categories.js
import express from 'express';
import { query } from '../../config/database.js';
import { getSchemaName } from '../../utils/tenantHelper.js';
import { authMiddleware } from '../../middleware/auth.js';
import { emitToBusiness } from '../../socket.js';

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

    // Obtener categorías con conteo de productos
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
 * GET /api/inventory/categories/:id
 * Obtiene una categoría específica con su conteo de productos
 */
router.get('/:id', authMiddleware, async (req, res) => {
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
       WHERE c.id = $1
       GROUP BY c.id, c.name, c.description, c.is_active, c.created_at, c.updated_at`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching category:', err);
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
    
    // Validaciones
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre no puede exceder los 100 caracteres' });
    }
    
    if (description && description.length > 250) {
      return res.status(400).json({ error: 'La descripción no puede exceder los 250 caracteres' });
    }

    const result = await query(
      `INSERT INTO "${schema}".categories (name, description, is_active)
       VALUES ($1, $2, $3) 
       RETURNING ${SELECT_COLS}`,
      [name.trim(), description || null, is_active === true || is_active === 'true']
    );
    
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'created' });
    
    // Obtener conteo de productos (0 para nueva categoría)
    const categoryWithCount = {
      ...result.rows[0],
      product_count: 0
    };
    
    res.status(201).json(categoryWithCount);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
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
    const categoryId = req.params.id;
    
    // Validaciones
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre no puede exceder los 100 caracteres' });
    }
    
    if (description && description.length > 250) {
      return res.status(400).json({ error: 'La descripción no puede exceder los 250 caracteres' });
    }

    // Verificar que la categoría existe
    const checkResult = await query(
      `SELECT id FROM "${schema}".categories WHERE id = $1`,
      [categoryId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }

    // Construir SET dinámico para actualizar solo los campos proporcionados
    const updates = [];
    const values = [];
    let paramCounter = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramCounter++}`);
      values.push(name.trim());
    }
    
    if (description !== undefined) {
      updates.push(`description = $${paramCounter++}`);
      values.push(description || null);
    }
    
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCounter++}`);
      values.push(is_active === true || is_active === 'true');
    }
    
    // Siempre actualizar updated_at
    updates.push(`updated_at = NOW()`);
    
    values.push(categoryId);
    
    const queryText = `
      UPDATE "${schema}".categories 
      SET ${updates.join(', ')}
      WHERE id = $${paramCounter}
      RETURNING ${SELECT_COLS}
    `;

    const result = await query(queryText, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'updated' });
    
    // Obtener conteo de productos actualizado
    const countResult = await query(
      `SELECT COUNT(*) as product_count 
       FROM "${schema}".products 
       WHERE category_id = $1`,
      [categoryId]
    );
    
    const categoryWithCount = {
      ...result.rows[0],
      product_count: parseInt(countResult.rows[0].product_count) || 0
    };
    
    res.json(categoryWithCount);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    }
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

    const categoryId = req.params.id;
    
    // Verificar que la categoría existe
    const checkResult = await query(
      `SELECT id, name FROM "${schema}".categories WHERE id = $1`,
      [categoryId]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    // Verificar si tiene productos asociados
    const productCheck = await query(
      `SELECT COUNT(*) as product_count 
       FROM "${schema}".products 
       WHERE category_id = $1`,
      [categoryId]
    );
    
    const productCount = parseInt(productCheck.rows[0].product_count) || 0;
    
    if (productCount > 0) {
      return res.status(409).json({ 
        error: `No se puede eliminar la categoría porque tiene ${productCount} ${productCount === 1 ? 'producto' : 'productos'} asociados`,
        product_count: productCount
      });
    }
    
    // Si no tiene productos, proceder con la eliminación
    const deleteResult = await query(
      `DELETE FROM "${schema}".categories WHERE id = $1 RETURNING id, name`,
      [categoryId]
    );
    
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'deleted' });
    
    res.json({ 
      success: true, 
      id: categoryId,
      name: deleteResult.rows[0].name,
      message: 'Categoría eliminada exitosamente'
    });
  } catch (err) {
    console.error('Error deleting category:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/inventory/categories/:id/status
 * Cambia el estado activo/inactivo de una categoría
 * { is_active: boolean }
 */
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { is_active } = req.body;
    const categoryId = req.params.id;
    
    if (is_active === undefined) {
      return res.status(400).json({ error: 'El campo is_active es obligatorio' });
    }
    
    const result = await query(
      `UPDATE "${schema}".categories 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING ${SELECT_COLS}`,
      [is_active === true || is_active === 'true', categoryId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Categoría no encontrada' });
    }
    
    const businessId = req.headers['x-business-id'] || req.user?.businessId;
    emitToBusiness(businessId, 'data_changed', { entity: 'categories', action: 'updated' });
    
    // Obtener conteo de productos
    const countResult = await query(
      `SELECT COUNT(*) as product_count 
       FROM "${schema}".products 
       WHERE category_id = $1`,
      [categoryId]
    );
    
    const categoryWithCount = {
      ...result.rows[0],
      product_count: parseInt(countResult.rows[0].product_count) || 0
    };
    
    res.json(categoryWithCount);
  } catch (err) {
    console.error('Error updating category status:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/inventory/categories/stats
 * Obtiene estadísticas de categorías
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT 
        COUNT(*) as total_categories,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_categories,
        COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_categories,
        COUNT(DISTINCT p.id) as total_products_with_categories,
        COUNT(p.id) as total_products
       FROM "${schema}".categories c
       LEFT JOIN "${schema}".products p ON p.category_id = c.id`
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching category stats:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;