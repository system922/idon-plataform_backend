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
    
    // CORREGIDO: No usar r.name porque no existe en la tabla
    const result = await query(`
      SELECT 
        r.id, 
        r.product_id,
        r.description,
        r.yield_qty,
        r.yield_unit,
        r.total_cost,
        r.is_active,
        r.created_at,
        r.updated_at,
        p.name AS product_name,
        p.product_type,
        c.name AS category_name
      FROM "${schema}".recipes r
      LEFT JOIN "${schema}".products p ON p.id = r.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE r.is_active = true
      ORDER BY p.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error en GET /recipes:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost, conversion_factor, total_cost } = req.body;
    
    if (!raw_material_id) {
      return res.status(400).json({ error: 'La materia prima es requerida' });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    }
    
    // Verificar que la materia prima existe
    const materialCheck = await query(
      `SELECT id, name, unit, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
      [raw_material_id]
    );
    
    if (materialCheck.rows.length === 0) {
      return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
    }
    
    const material = materialCheck.rows[0];
    const finalUnitCost = unit_cost || material.unit_cost || 0;
    const finalConversion = conversion_factor || 1;
    const finalTotalCost = Number(quantity) * Number(finalConversion) * Number(finalUnitCost);
    const finalUnit = unit || material.unit || 'unidad';
    
    const { rows } = await query(`
      INSERT INTO "${schema}".recipe_ingredients
        (recipe_id, raw_material_id, quantity, unit, unit_cost, conversion_factor, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.params.id, raw_material_id, quantity, finalUnit, finalUnitCost, finalConversion, finalTotalCost]);
    
    await recalcCost(schema, req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Error en POST /ingredients:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/ingredients/:iid', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost, conversion_factor, total_cost } = req.body;
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    }
    
    // Si se cambia la materia prima, verificar que existe
    if (raw_material_id) {
      const materialCheck = await query(
        `SELECT id, name, unit, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
        [raw_material_id]
      );
      
      if (materialCheck.rows.length === 0) {
        return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
      }
      
      const material = materialCheck.rows[0];
      const finalUnitCost = unit_cost || material.unit_cost || 0;
      const finalConversion = conversion_factor || 1;
      const finalTotalCost = Number(quantity) * Number(finalConversion) * Number(finalUnitCost);
      const finalUnit = unit || material.unit || 'unidad';
      
      const { rows } = await query(`
        UPDATE "${schema}".recipe_ingredients
        SET raw_material_id=$1, quantity=$2, unit=$3, unit_cost=$4, conversion_factor=$5, total_cost=$6
        WHERE id=$7
        RETURNING *
      `, [raw_material_id, quantity, finalUnit, finalUnitCost, finalConversion, finalTotalCost, req.params.iid]);
      
      await recalcCost(schema, req.params.id);
      return res.json(rows[0]);
    }
    
    // Solo actualizar cantidad, unidad y factor de conversión
    const finalConversion = conversion_factor || 1;
    const finalTotalCost = Number(quantity) * Number(finalConversion) * Number(ingredientForm.unit_cost || 0);
    
    const { rows } = await query(`
      UPDATE "${schema}".recipe_ingredients
      SET quantity=$1, unit=$2, conversion_factor=$3, total_cost=quantity * conversion_factor * unit_cost
      WHERE id=$4
      RETURNING *
    `, [quantity, unit || 'unidad', finalConversion, req.params.iid]);
    
    await recalcCost(schema, req.params.id);
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error en PUT /ingredients:', err);
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
    console.error('❌ Error en DELETE /recipes:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ── Ingredients ──────────────────────────────────────────────────── */

router.get('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT 
        ri.id,
        ri.recipe_id,
        ri.raw_material_id,
        ri.quantity,
        ri.unit,
        ri.unit_cost,
        ri.total_cost,
        ri.created_at,
        rm.name AS raw_material_name,
        rm.code,
        rm.unit AS raw_material_unit
      FROM "${schema}".recipe_ingredients ri
      LEFT JOIN "${schema}".raw_materials rm ON rm.id = ri.raw_material_id
      WHERE ri.recipe_id = $1
      ORDER BY ri.created_at
    `, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error('❌ Error en GET /ingredients:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/ingredients', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost } = req.body;
    
    if (!raw_material_id) {
      return res.status(400).json({ error: 'La materia prima es requerida' });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    }
    
    // Verificar que la materia prima existe
    const materialCheck = await query(
      `SELECT id, name, unit, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
      [raw_material_id]
    );
    
    if (materialCheck.rows.length === 0) {
      return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
    }
    
    const material = materialCheck.rows[0];
    const finalUnitCost = unit_cost || material.unit_cost || 0;
    const totalCost = Number(quantity) * Number(finalUnitCost);
    const finalUnit = unit || material.unit || 'unidad';
    
    const { rows } = await query(`
      INSERT INTO "${schema}".recipe_ingredients
        (recipe_id, raw_material_id, quantity, unit, unit_cost, total_cost)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [req.params.id, raw_material_id, quantity, finalUnit, finalUnitCost, totalCost]);
    
    await recalcCost(schema, req.params.id);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('❌ Error en POST /ingredients:', err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id/ingredients/:iid', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { raw_material_id, quantity, unit, unit_cost } = req.body;
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    }
    
    // Si se cambia la materia prima, verificar que existe
    if (raw_material_id) {
      const materialCheck = await query(
        `SELECT id, name, unit, unit_cost FROM "${schema}".raw_materials WHERE id = $1 AND is_active = true`,
        [raw_material_id]
      );
      
      if (materialCheck.rows.length === 0) {
        return res.status(400).json({ error: 'La materia prima seleccionada no existe o está inactiva' });
      }
      
      const material = materialCheck.rows[0];
      const finalUnitCost = unit_cost || material.unit_cost || 0;
      const totalCost = Number(quantity) * Number(finalUnitCost);
      const finalUnit = unit || material.unit || 'unidad';
      
      const { rows } = await query(`
        UPDATE "${schema}".recipe_ingredients
        SET raw_material_id=$1, quantity=$2, unit=$3, unit_cost=$4, total_cost=$5
        WHERE id=$6
        RETURNING *
      `, [raw_material_id, quantity, finalUnit, finalUnitCost, totalCost, req.params.iid]);
      
      await recalcCost(schema, req.params.id);
      return res.json(rows[0]);
    }
    
    // Solo actualizar cantidad y unidad
    const { rows } = await query(`
      UPDATE "${schema}".recipe_ingredients
      SET quantity=$1, unit=$2, total_cost=quantity * unit_cost
      WHERE id=$3
      RETURNING *
    `, [quantity, unit || 'unidad', req.params.iid]);
    
    await recalcCost(schema, req.params.id);
    res.json(rows[0]);
  } catch (err) {
    console.error('❌ Error en PUT /ingredients:', err);
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
    console.error('❌ Error en DELETE /ingredients:', err);
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

// routes/recipes.js - Agregar endpoints para sub-recetas

import { getRecipeIngredientsFlat, calculateRecipeTotalCost, getRecipeTree } from '../services/recipeService.js';

// Obtener ingredientes planos de una receta (incluyendo sub-recetas)
router.get('/:id/ingredients-flat', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { multiplier = 1 } = req.query;
    
    const ingredients = await getRecipeIngredientsFlat(schema, req.params.id, Number(multiplier));
    const totalCost = ingredients.reduce((sum, ing) => sum + Number(ing.total_cost), 0);
    
    res.json({
      recipe_id: req.params.id,
      ingredients,
      total_cost: totalCost,
      ingredient_count: ingredients.length
    });
  } catch (err) {
    console.error('❌ Error en GET /recipes/:id/ingredients-flat:', err);
    res.status(500).json({ error: err.message });
  }
});

// Obtener árbol de receta (estructura anidada)
router.get('/:id/tree', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const tree = await getRecipeTree(schema, req.params.id);
    if (!tree) {
      return res.status(404).json({ error: 'Receta no encontrada' });
    }
    res.json(tree);
  } catch (err) {
    console.error('❌ Error en GET /recipes/:id/tree:', err);
    res.status(500).json({ error: err.message });
  }
});

// Recalcular costo de una receta (incluyendo sub-recetas)
router.post('/:id/recalculate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await calculateRecipeTotalCost(schema, req.params.id);
    res.json(result);
  } catch (err) {
    console.error('❌ Error en POST /recipes/:id/recalculate:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;