// routes/recipes.js
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
      SELECT r.*, c.name AS category_name, p.name AS product_name, p.product_type
      FROM "${schema}".recipes r
      LEFT JOIN "${schema}".categories c ON c.id = r.category_id
      LEFT JOIN "${schema}".products p ON p.id = r.product_id
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
    const { name, description, category_id, product_id, yield_qty, yield_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    
    // Verificar que el producto existe y es MANUFACTURED
    if (product_id) {
      const productCheck = await query(
        `SELECT product_type FROM "${schema}".products WHERE id = $1 AND is_active = true`,
        [product_id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(400).json({ error: 'El producto seleccionado no existe o está inactivo' });
      }
      if (productCheck.rows[0].product_type !== 'MANUFACTURED') {
        return res.status(400).json({ error: 'Solo se pueden crear recetas para productos de tipo MANUFACTURED' });
      }
    }
    
    const { rows } = await query(`
      INSERT INTO "${schema}".recipes (name, description, category_id, product_id, yield_qty, yield_unit)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, description || null, category_id || null, product_id || null, yield_qty || 1, yield_unit || 'unidad']);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, description, category_id, product_id, yield_qty, yield_unit } = req.body;
    if (!name) return res.status(400).json({ error: 'El nombre es requerido' });
    
    // Verificar que el producto existe y es MANUFACTURED
    if (product_id) {
      const productCheck = await query(
        `SELECT product_type FROM "${schema}".products WHERE id = $1 AND is_active = true`,
        [product_id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(400).json({ error: 'El producto seleccionado no existe o está inactivo' });
      }
      if (productCheck.rows[0].product_type !== 'MANUFACTURED') {
        return res.status(400).json({ error: 'Solo se pueden crear recetas para productos de tipo MANUFACTURED' });
      }
    }
    
    const { rows } = await query(`
      UPDATE "${schema}".recipes
      SET name=$1, description=$2, category_id=$3, product_id=$4, yield_qty=$5, yield_unit=$6, updated_at=NOW()
      WHERE id=$7
      RETURNING *
    `, [name, description || null, category_id || null, product_id || null, yield_qty || 1, yield_unit || 'unidad', req.params.id]);
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
      SELECT ri.*, rm.name AS raw_material_name
      FROM "${schema}".recipe_ingredients ri
      LEFT JOIN "${schema}".raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = $1
      ORDER BY ri.created_at
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost } = req.body;
    
    if (!raw_material_id) return res.status(400).json({ error: 'La materia prima es requerida' });
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    
    // Verificar que la materia prima existe
    const materialCheck = await query(
      `SELECT id, name, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
      [raw_material_id]
    );
    if (materialCheck.rows.length === 0) {
      return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
    }
    
    const material = materialCheck.rows[0];
    const finalUnitCost = unit_cost || material.unit_cost || 0;
    const totalCost = quantity * finalUnitCost;
    
    const { rows } = await query(`
      INSERT INTO "${schema}".recipe_ingredients
        (recipe_id, raw_material_id, quantity, unit, unit_cost, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.params.id, raw_material_id, quantity, unit || null, finalUnitCost, totalCost]);
    
    await recalcCost(schema, req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/ingredients/:iid', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost } = req.body;
    
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    
    // Verificar que la materia prima existe
    if (raw_material_id) {
      const materialCheck = await query(
        `SELECT id, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
        [raw_material_id]
      );
      if (materialCheck.rows.length === 0) {
        return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
      }
      const material = materialCheck.rows[0];
      const finalUnitCost = unit_cost || material.unit_cost || 0;
      const totalCost = quantity * finalUnitCost;
      
      const { rows } = await query(`
        UPDATE "${schema}".recipe_ingredients
        SET raw_material_id=$1, quantity=$2, unit=$3, unit_cost=$4, total_cost=$5
        WHERE id=$6
        RETURNING *
      `, [raw_material_id, quantity, unit || null, finalUnitCost, totalCost, req.params.iid]);
      
      await recalcCost(schema, req.params.id);
      res.json(rows[0]);
    } else {
      // Solo actualizar cantidad y unidad
      const { rows } = await query(`
        UPDATE "${schema}".recipe_ingredients
        SET quantity=$1, unit=$2, total_cost=quantity * unit_cost
        WHERE id=$3
        RETURNING *
      `, [quantity, unit || null, req.params.iid]);
      
      await recalcCost(schema, req.params.id);
      res.json(rows[0]);
    }
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