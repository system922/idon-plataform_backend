import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* ── Recipes CRUD ─────────────────────────────────────────────────── */

router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT r.*, c.name AS category_name
      FROM "${schema}".recipes r
      LEFT JOIN "${schema}".categories c ON c.id = r.category_id
      WHERE r.is_active = true
      ORDER BY r.name
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, description, category_id, yield_qty, yield_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { rows } = await query(`
      INSERT INTO "${schema}".recipes (name, description, category_id, yield_qty, yield_unit)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name, description || null, category_id || null, yield_qty || 1, yield_unit || 'unidad']);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, description, category_id, yield_qty, yield_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    const { rows } = await query(`
      UPDATE "${schema}".recipes
      SET name=$1, description=$2, category_id=$3, yield_qty=$4, yield_unit=$5, updated_at=NOW()
      WHERE id=$6
      RETURNING *
    `, [name, description || null, category_id || null, yield_qty || 1, yield_unit || 'unidad', req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Receta no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await query(`
      UPDATE "${schema}".recipes SET is_active=false, updated_at=NOW() WHERE id=$1
    `, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── Ingredients ──────────────────────────────────────────────────── */

router.get('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT ri.*, p.name AS product_name
      FROM "${schema}".recipe_ingredients ri
      LEFT JOIN "${schema}".products p ON p.id = ri.product_id
      WHERE ri.recipe_id = $1
      ORDER BY ri.ingredient_name
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { product_id, ingredient_name, quantity, unit, unit_cost } = req.body;
    if (!ingredient_name) return res.status(400).json({ error: 'El nombre del ingrediente es requerido' });
    const qty   = Number(quantity  || 1);
    const cost  = Number(unit_cost || 0);
    const { rows } = await query(`
      INSERT INTO "${schema}".recipe_ingredients
        (recipe_id, product_id, ingredient_name, quantity, unit, unit_cost, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.id, product_id || null, ingredient_name, qty, unit || null, cost, qty * cost]);
    await recalcCost(schema, req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/ingredients/:iid', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { ingredient_name, quantity, unit, unit_cost } = req.body;
    const qty  = Number(quantity  || 1);
    const cost = Number(unit_cost || 0);
    const { rows } = await query(`
      UPDATE "${schema}".recipe_ingredients
      SET ingredient_name=$1, quantity=$2, unit=$3, unit_cost=$4, total_cost=$5
      WHERE id=$6
      RETURNING *
    `, [ingredient_name, qty, unit || null, cost, qty * cost, req.params.iid]);
    await recalcCost(schema, req.params.id);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/ingredients/:iid', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await query(`DELETE FROM "${schema}".recipe_ingredients WHERE id=$1`, [req.params.iid]);
    await recalcCost(schema, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function recalcCost(schema, recipeId) {
  await query(`
    UPDATE "${schema}".recipes
    SET total_cost = (
      SELECT COALESCE(SUM(total_cost), 0)
      FROM "${schema}".recipe_ingredients
      WHERE recipe_id = $1
    ), updated_at = NOW()
    WHERE id = $1
  `, [recipeId]);
}

export default router;
