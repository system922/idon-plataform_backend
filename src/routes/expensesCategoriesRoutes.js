import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Obtener todas las categorías de gastos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT id, name, color, created_at
      FROM "${schema}".expense_categories
      ORDER BY name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear una nueva categoría de gasto
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const result = await query(`
      INSERT INTO "${schema}".expense_categories (name, color)
      VALUES ($1, $2)
      RETURNING *
    `, [name, color || '#95a5a6']);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

// Editar una categoría de gasto
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });

    const result = await query(`
      UPDATE "${schema}".expense_categories
      SET name = $1, color = $2
      WHERE id = $3
      RETURNING *
    `, [name, color || '#95a5a6', id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Nombre duplicado' });
    res.status(500).json({ error: err.message });
  }
});

// Eliminar una categoría de gasto (solo si no tiene gastos asociados)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    // Verificar si existen gastos usando esta categoría
    const check = await query(`
      SELECT COUNT(*) FROM "${schema}".expenses WHERE category_id = $1
    `, [id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: hay gastos asociados a esta categoría' });
    }

    const result = await query(`
      DELETE FROM "${schema}".expense_categories WHERE id = $1 RETURNING id
    `, [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;