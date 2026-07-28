// services/recipeService.js
import { query } from '../config/database.js';

/**
 * Obtiene todos los ingredientes de una receta, incluyendo sub-recetas
 * @param {string} schema - Esquema de la base de datos
 * @param {string} recipeId - ID de la receta
 * @param {number} multiplier - Multiplicador para escalar (ej: 2 para 2 porciones)
 * @param {Object} cache - Cache para evitar ciclos infinitos
 * @returns {Array} Lista plana de ingredientes
 */
export async function getRecipeIngredientsFlat(schema, recipeId, multiplier = 1, cache = new Set()) {
  // Evitar ciclos infinitos
  if (cache.has(recipeId)) {
    console.warn(`⚠️ Ciclo detectado en receta ${recipeId}`);
    return [];
  }
  cache.add(recipeId);

  const result = [];

  // Obtener ingredientes directos de la receta
  const { rows } = await query(`
    SELECT 
      ri.id,
      ri.recipe_id,
      ri.raw_material_id,
      ri.quantity,
      ri.unit,
      ri.unit_cost,
      ri.total_cost,
      rm.name AS raw_material_name,
      rm.code AS raw_material_code,
      rm.is_composite,
      rm.recipe_id AS sub_recipe_id,
      rm.unit AS raw_material_unit
    FROM "${schema}".recipe_ingredients ri
    LEFT JOIN "${schema}".raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = $1
  `, [recipeId]);

  for (const item of rows) {
    const quantity = Number(item.quantity) * multiplier;

    if (item.is_composite && item.sub_recipe_id) {
      // Es una sub-receta → obtener sus ingredientes recursivamente
      const subIngredients = await getRecipeIngredientsFlat(
        schema, 
        item.sub_recipe_id, 
        quantity, // Multiplicar por la cantidad de la sub-receta
        new Set(cache) // Pasar copia del cache
      );
      result.push(...subIngredients);
    } else {
      // Es un ingrediente directo (materia prima simple)
      result.push({
        ...item,
        quantity: quantity,
        total_cost: quantity * Number(item.unit_cost),
        // Indicar de dónde viene (para trazabilidad)
        source_recipe_id: item.recipe_id,
        source_recipe_name: null // Se puede obtener después
      });
    }
  }

  return result;
}

/**
 * Calcula el costo total de una receta incluyendo sub-recetas
 */
export async function calculateRecipeTotalCost(schema, recipeId) {
  const ingredients = await getRecipeIngredientsFlat(schema, recipeId);
  const totalCost = ingredients.reduce((sum, ing) => sum + Number(ing.total_cost), 0);
  
  // Actualizar el costo total en la receta
  await query(`
    UPDATE "${schema}".recipes
    SET total_cost = $1, updated_at = NOW()
    WHERE id = $2
  `, [totalCost, recipeId]);
  
  return {
    recipeId,
    totalCost,
    ingredients,
    ingredientCount: ingredients.length
  };
}

/**
 * Obtiene el árbol completo de una receta (para visualización)
 */
export async function getRecipeTree(schema, recipeId) {
  const { rows } = await query(`
    SELECT 
      r.id,
      r.product_id,
      r.description,
      r.yield_qty,
      r.yield_unit,
      r.total_cost,
      p.name AS product_name
    FROM "${schema}".recipes r
    LEFT JOIN "${schema}".products p ON p.id = r.product_id
    WHERE r.id = $1 AND r.is_active = true
  `, [recipeId]);

  if (!rows.length) return null;
  const recipe = rows[0];
  
  // Obtener ingredientes con sus sub-recetas
  const ingredients = await getRecipeTreeIngredients(schema, recipeId);
  recipe.ingredients = ingredients;
  
  return recipe;
}

async function getRecipeTreeIngredients(schema, recipeId) {
  const { rows } = await query(`
    SELECT 
      ri.id,
      ri.recipe_id,
      ri.raw_material_id,
      ri.quantity,
      ri.unit,
      ri.unit_cost,
      ri.total_cost,
      rm.name AS raw_material_name,
      rm.code AS raw_material_code,
      rm.is_composite,
      rm.recipe_id AS sub_recipe_id,
      rm.unit AS raw_material_unit
    FROM "${schema}".recipe_ingredients ri
    LEFT JOIN "${schema}".raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = $1
  `, [recipeId]);

  const result = [];
  for (const item of rows) {
    if (item.is_composite && item.sub_recipe_id) {
      // Obtener la sub-receta recursivamente
      const subRecipe = await getRecipeTree(schema, item.sub_recipe_id);
      result.push({
        ...item,
        is_sub_recipe: true,
        sub_recipe: subRecipe
      });
    } else {
      result.push({
        ...item,
        is_sub_recipe: false
      });
    }
  }
  return result;
}