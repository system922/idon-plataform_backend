import * as productService from '../services/productosService.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { emitToBusiness } from '../socket.js';

const getSchema = (req, res) => {
  if (!req.schema && !req.user?.businessId) {
    res.status(400).json({ error: 'Business context required' });
    return null;
  }
  return req.schema;
};

export const getAll = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { all, category_id } = req.query;
    const includeInactive = all === '1';
    const products = await productService.getAll(schema, includeInactive, category_id);

    console.log('📦 getAll - LISTA COMPLETA devuelta al frontend:', 
      products.slice(0, 3).map(p => ({
        id: p.id,
        name: p.name,
        is_taxable: p.is_taxable,
        tax_rate: p.tax_rate,
        selling_price: p.selling_price,
        todos_campos: Object.keys(p).sort()
      }))
    );

    console.log('📤 RESPUESTA JSON que se envia al frontend:', {
      cantidad: products.length,
      primer_producto_completo: products[0] ? JSON.stringify(products[0], null, 2) : null
    });

    res.json(products);
  } catch (err) {
    console.error('Error en getAll:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getById = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const product = await productService.getById(schema, req.params.id);
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    console.log('✅ getById - PRODUCTO COMPLETO devuelto:', {
      id: product.id,
      name: product.name,
      is_taxable: product.is_taxable,
      tipo_is_taxable: typeof product.is_taxable,
      tax_rate: product.tax_rate,
      selling_price: product.selling_price,
      todos_campos: Object.keys(product).sort()
    });

    console.log('📤 JSON que se envia al frontend:', JSON.stringify(product, null, 2));

    res.json(product);
  } catch (err) {
    console.error('Error en getById:', err);
    res.status(500).json({ error: err.message });
  }
};

export const create = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { name, nombre, price, precioVenta } = req.body;
    const productName = name || nombre;
    const productPrice = price || precioVenta;

    if (!productName) return res.status(400).json({ error: 'Nombre requerido' });
    if (!productPrice) return res.status(400).json({ error: 'Precio requerido' });

    const product = await productService.create(schema, req.body);
    emitToBusiness(req.user.businessId, 'data_changed', { entity: 'products', action: 'created' });
    res.status(201).json(product);
  } catch (err) {
    console.error('Error en create:', err);
    res.status(500).json({ error: err.message });
  }
};

export const update = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { id } = req.params;
    
    const existingProduct = await productService.getById(schema, id);
    if (!existingProduct) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const product = await productService.update(schema, id, req.body);
    emitToBusiness(req.user.businessId, 'data_changed', { entity: 'products', action: 'updated' });
    res.json(product);
  } catch (err) {
    console.error('Error en update:', err);
    res.status(500).json({ error: err.message });
  }
};

export const remove = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    await productService.remove(schema, req.params.id);
    emitToBusiness(req.user.businessId, 'data_changed', { entity: 'products', action: 'deleted' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error en remove:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getNextCode = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const result = await productService.getNextCode(schema, req.query.categoria);
    res.json(result);
  } catch (err) {
    console.error('Error en getNextCode:', err);
    res.status(500).json({ error: err.message });
  }
};

export const getFiscalRates = async (req, res) => {
  try {
    const rates = await productService.getFiscalRates();
    res.json(rates);
  } catch (err) {
    console.error('Error en getFiscalRates:', err);
    res.status(500).json({ error: err.message });
  }
};