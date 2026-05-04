import * as discountModel from '../models/Discount.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { query } from '../config/database.js';

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

export async function createDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id: userId } = req.user; // asumiendo que el token tiene user.id
    const discount = await discountModel.createDiscount(schema, { ...req.body, created_by: userId });
    res.status(201).json(discount);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export async function updateDiscount(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const discount = await discountModel.updateDiscount(schema, id, req.body);
    if (!discount) return res.status(404).json({ error: 'Descuento no encontrado' });
    res.json(discount);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

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

// Endpoints auxiliares
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