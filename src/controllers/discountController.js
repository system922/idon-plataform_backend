import * as discountModel from '../models/Discount.js';
import { getSchemaName } from '../utils/tenantHelper.js';

// Obtener todos los descuentos (con info de categoría/producto)
export async function getDiscounts(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const discounts = await discountModel.findAllDiscounts(schema);
    res.json(discounts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Obtener un descuento por ID
export async function getDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { id } = req.params;
    const discount = await discountModel.findDiscountById(schema, id);
    if (!discount) return res.status(404).json({ error: 'Descuento no encontrado' });
    
    res.json(discount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Crear descuento
export async function createDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const {
      name, description, type, value, applies_to,
      product_id, category_id, min_amount, max_discount,
      min_quantity, code, usage_limit, days_of_week,
      start_time, end_time, start_date, end_date,
      stackable, priority, customer_segment, is_active
    } = req.body;
    
    if (!name || value === undefined || !type) {
      return res.status(400).json({ error: 'Nombre, tipo y valor son requeridos' });
    }
    
    const discount = await discountModel.createDiscount(schema, {
      name, description, type, value: parseFloat(value), applies_to,
      product_id: product_id || null,
      category_id: category_id || null,
      min_amount: parseFloat(min_amount) || 0,
      max_discount: max_discount ? parseFloat(max_discount) : null,
      min_quantity: parseInt(min_quantity) || 1,
      code: code || null,
      usage_limit: usage_limit ? parseInt(usage_limit) : null,
      days_of_week: days_of_week?.length ? days_of_week : null,
      start_time: start_time || null,
      end_time: end_time || null,
      start_date: start_date || null,
      end_date: end_date || null,
      stackable: stackable || false,
      priority: parseInt(priority) || 0,
      customer_segment: customer_segment || 'all',
      is_active: is_active !== false
    });
    
    res.status(201).json(discount);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Actualizar descuento
export async function updateDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { id } = req.params;
    const updates = req.body;
    
    const discount = await discountModel.updateDiscount(schema, id, updates);
    if (!discount) return res.status(404).json({ error: 'Descuento no encontrado' });
    
    res.json(discount);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Eliminar descuento (hard delete si query param hard_delete=true)
export async function deleteDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { id } = req.params;
    const hardDelete = req.query.hard_delete === 'true';
    
    const deleted = await discountModel.deleteDiscount(schema, id, hardDelete);
    if (!deleted) return res.status(404).json({ error: 'Descuento no encontrado' });
    
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

// Endpoints auxiliares para categorías y productos (si no los tienes)
export async function getCategories(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const { rows } = await query(`SELECT id, name FROM "${schema}".categories ORDER BY name`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getProducts(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    
    const limit = parseInt(req.query.limit) || 100;
    const { rows } = await query(`SELECT id, name, price FROM "${schema}".products LIMIT $1`, [limit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}