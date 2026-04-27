import * as productService from '../services/productosService.js';
import { getSchemaName }   from '../utils/tenantHelper.js';

const getSchema = (req, res) => {
  if (!req.schema) { res.status(400).json({ error: 'Business context required' }); return null; }
  return req.schema;
};

export const getAll = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const products = await productService.getAll(schema, req.query.all === '1');
    res.json(products);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getById = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const product = await productService.getById(schema, req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const create = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const { nombre, precioVenta } = req.body;
    if (!nombre)      return res.status(400).json({ error: 'Nombre requerido' });
    if (!precioVenta) return res.status(400).json({ error: 'Precio requerido' });
    const product = await productService.create(schema, req.body);
    res.status(201).json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const update = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const product = await productService.update(schema, req.params.id, req.body);
    res.json(product);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const remove = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    await productService.remove(schema, req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getFiscalRates = async (req, res) => {
  try {
    const rates = await productService.getFiscalRates();
    res.json(rates);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getNextCode = async (req, res) => {
  try {
    const schema = getSchema(req, res); if (!schema) return;
    const result = await productService.getNextCode(schema, req.query.categoria);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
};