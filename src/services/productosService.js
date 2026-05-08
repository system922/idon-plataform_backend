// servicios/productosService.js
import * as productModel from '../models/productosModel.js';

const toNum = (v, def = null) => (v === '' || v == null ? def : Number(v));
const toText = (v) => (v === '' || v == null ? null : String(v).trim());
const toBool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1 || v === '1');

/**
 * Calcula el IVA usando la tasa vigente de la base de datos
 */
const calcIvaConTasaVigente = async (precioConIva, tieneIva) => {
  if (!tieneIva || !precioConIva || precioConIva <= 0) {
    return { taxValue: 0, priceWithoutTax: precioConIva || 0 };
  }
  
  const rates = await productModel.getFiscalRates();
  const tasa = rates.iva_rate; // Tasa vigente de la BD (ej: 0.15 para 15%)
  
  const priceWithoutTax = precioConIva / (1 + tasa);
  const taxValue = precioConIva - priceWithoutTax;
  
  return {
    taxValue: Number(taxValue.toFixed(2)),
    priceWithoutTax: Number(priceWithoutTax.toFixed(2))
  };
};

export const getAll = async (schema, includeInactive, category_id) => {
  if (category_id) {
    return productModel.findByCategory(schema, category_id, includeInactive);
  }
  return productModel.findAll(schema, includeInactive);
};

export const getById = (schema, id) => productModel.findById(schema, id);
export const getFiscalRates = () => productModel.getFiscalRates();

export const getNextCode = async (schema, categoria) => {
  const cat = (categoria || 'PROD').slice(0, 4).toUpperCase();
  const total = await productModel.countByCategory(schema, cat);
  const next = total + 1;
  return { code: `${cat}-${String(next).padStart(3, '0')}`, next };
};

export const create = async (schema, body) => {
  // Determinar si tiene IVA
  const isTaxable = toBool(
    body.is_taxable !== undefined ? body.is_taxable :
    body.has_iva !== undefined ? body.has_iva :
    body.iva !== undefined ? body.iva : false,
    false
  );
  
  // Obtener precio (con IVA incluido del frontend)
  const price = toNum(body.price !== undefined ? body.price : body.precioVenta);
  if (!price || price <= 0) {
    throw new Error('El precio es requerido y debe ser mayor a 0');
  }
  
  // Calcular IVA con la tasa vigente de la BD
  const { taxValue, priceWithoutTax } = await calcIvaConTasaVigente(price, isTaxable);
  
  // Obtener o crear categoría
  let category_id = null;
  if (body.category_name) {
    category_id = await productModel.findOrCreateCategory(schema, body.category_name);
  } else if (body.categoria) {
    category_id = await productModel.findOrCreateCategory(schema, body.categoria);
  } else if (body.category_id) {
    category_id = body.category_id;
  }
  
  // Generar código si no viene
  const code = body.code || `PROD-${Date.now().toString(36).toUpperCase()}`;
  
  return productModel.insert(schema, {
    code,
    name: toText(body.name || body.nombre),
    description: toText(body.description || body.descripcion),
    category_id,
    sellingPrice: priceWithoutTax,
    unitCost: toNum(body.unit_cost !== undefined ? body.unit_cost : body.costo, 0),
    taxRate: taxValue,
    isTaxable,
    isActive: toBool(body.active !== undefined ? body.active : body.estado, true),
    sku: toText(body.sku),
    barcode: toText(body.barcode || body.codigoBarras),
    stock: toNum(body.stock, 0),
    minStock: toNum(body.min_stock !== undefined ? body.min_stock : body.minStock, 0),
  });
};

export const update = async (schema, id, body) => {
  // Obtener producto actual
  const currentProduct = await productModel.findById(schema, id);
  if (!currentProduct) throw new Error('Producto no encontrado');
  
  // Determinar si tiene IVA (usar el nuevo valor o mantener el actual)
  let isTaxable = currentProduct.is_taxable;
  if (body.is_taxable !== undefined) isTaxable = toBool(body.is_taxable);
  else if (body.has_iva !== undefined) isTaxable = toBool(body.has_iva);
  else if (body.iva !== undefined) isTaxable = toBool(body.iva);
  
  // Determinar precio (con IVA incluido del frontend)
  let price = currentProduct.selling_price;
  if (body.price !== undefined) price = toNum(body.price);
  else if (body.precioVenta !== undefined) price = toNum(body.precioVenta);
  
  // Calcular IVA con la tasa vigente de la BD si cambió precio o estado de IVA
  let taxValue = currentProduct.tax_rate;
  let priceWithoutTax = currentProduct.selling_price;
  
  const precioCambio = (body.price !== undefined || body.precioVenta !== undefined);
  const ivaCambio = (body.is_taxable !== undefined || body.has_iva !== undefined || body.iva !== undefined);
  
  if (precioCambio || ivaCambio) {
    const calculo = await calcIvaConTasaVigente(price, isTaxable);
    taxValue = calculo.taxValue;
    priceWithoutTax = calculo.priceWithoutTax;
  }
  
  // Obtener o crear categoría
  let category_id = currentProduct.category_id;
  if (body.category_name !== undefined) {
    if (body.category_name === '' || body.category_name === null) {
      category_id = null;
    } else if (body.category_name !== currentProduct.category_name) {
      category_id = await productModel.findOrCreateCategory(schema, body.category_name);
    }
  } else if (body.categoria !== undefined) {
    if (body.categoria === '' || body.categoria === null) {
      category_id = null;
    } else if (body.categoria !== currentProduct.category_name) {
      category_id = await productModel.findOrCreateCategory(schema, body.categoria);
    }
  } else if (body.category_id !== undefined) {
    category_id = body.category_id === '' ? null : body.category_id;
  }
  
  // Actualizar producto
  return productModel.updateById(schema, id, {
    name: toText(body.name || body.nombre) || currentProduct.name,
    description: toText(body.description || body.descripcion) || currentProduct.description,
    sellingPrice: priceWithoutTax,
    unit_cost: toNum(body.unit_cost !== undefined ? body.unit_cost : body.costo, currentProduct.unit_cost),
    taxRate: taxValue,
    isTaxable,
    isActive: toBool(body.active !== undefined ? body.active : body.estado, currentProduct.is_active),
    stock: toNum(body.stock, currentProduct.stock),
    category_id,
    sku: toText(body.sku) || currentProduct.sku,
    barcode: toText(body.barcode || body.codigoBarras) || currentProduct.barcode,
    min_stock: toNum(body.min_stock !== undefined ? body.min_stock : body.minStock, currentProduct.min_stock),
  });
};

export const remove = (schema, id) => productModel.softDelete(schema, id);