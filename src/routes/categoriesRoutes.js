import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

const SELECT_COLS = `
  id, name, description
`;

/**
 * GET /api/inventory/categories
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const rows = await query(
      `SELECT ${SELECT_COLS}
       FROM "${schema}".categories
       ORDER BY name`
    );
    res.json(rows.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/inventory/categories
 * { name, description }
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await query(
      `INSERT INTO "${schema}".categories (name, description)
       VALUES ($1, $2) RETURNING ${SELECT_COLS}`,
      [name.trim(), description || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/inventory/categories/:id
 * { name, description }
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const result = await query(
      `UPDATE "${schema}".categories
       SET name = $1, description = $2, updated_at = NOW()
       WHERE id = $3 RETURNING ${SELECT_COLS}`,
      [name.trim(), description || null, req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/inventory/categories/:id
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // Borrado físico. Si prefieres soft-delete, cambia el query aquí.
    const result = await query(
      `DELETE FROM "${schema}".categories WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;