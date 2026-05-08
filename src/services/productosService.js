// servicios/productosService.js
import * as productModel from '../models/productosModel.js';

const toNum = (v, def = null) => (v === '' || v == null ? def : Number(v));
const toText = (v) => (v === '' || v == null ? null : String(v).trim());
const toBool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1 || v === '1');

/**
 * Calcula el IVA usando la tasa vigente de la base de datos
 * @param {number} precioConIva - PVP (precio con IVA)
 * @param {boolean} tieneIva - Si el producto tiene IVA
 * @returns {Object} { taxValue, priceWithoutTax }
 */
const calcIvaConTasaVigente = async (precioConIva, tieneIva) => {
  // Si no tiene IVA, todo es precio sin IVA
  if (!tieneIva || !precioConIva || precioConIva <= 0) {
    return { 
      taxValue: 0, 
      priceWithoutTax: precioConIva || 0 
    };
  }
  
  const rates = await productModel.getFiscalRates();
  let tasa = rates.iva_rate;
  
  // ✅ Si la tasa es > 1, es porcentaje (15 → 0.15)
  if (tasa > 1) {
    tasa = tasa / 100;
  }
  
  // ✅ Si por algún motivo sigue siendo 0, usar 0.15 por defecto
  if (tasa === 0) {
    tasa = 0.15;
  }
  
  console.log('💰 Calculando IVA:', { precioConIva, tasa });
  
  const priceWithoutTax = precioConIva / (1 + tasa);
  const taxValue = precioConIva - priceWithoutTax;
  
  console.log('✅ Resultado cálculo:', { 
    priceWithoutTax: priceWithoutTax.toFixed(2), 
    taxValue: taxValue.toFixed(2) 
  });
  
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
  // 1. Determinar si el producto tiene IVA
  const isTaxable = toBool(
    body.is_taxable !== undefined ? body.is_taxable :
    body.has_iva !== undefined ? body.has_iva :
    body.iva !== undefined ? body.iva : false,
    false
  );
  
  // 2. Obtener el PVP (precio con IVA) que envía el frontend
  const pvp = toNum(body.price !== undefined ? body.price : body.precioVenta);
  if (!pvp || pvp <= 0) {
    throw new Error('El precio de venta es requerido y debe ser mayor a 0');
  }
  
  console.log('📦 Creando producto:', { name: body.name, pvp, isTaxable });
  
  // 3. Calcular selling_price (precio sin IVA) y tax_rate (valor del IVA)
  const { taxValue, priceWithoutTax } = await calcIvaConTasaVigente(pvp, isTaxable);
  
  // 4. Obtener o crear categoría
  let category_id = null;
  if (body.category_name) {
    category_id = await productModel.findOrCreateCategory(schema, body.category_name);
  } else if (body.categoria) {
    category_id = await productModel.findOrCreateCategory(schema, body.categoria);
  } else if (body.category_id) {
    category_id = body.category_id;
  }
  
  // 5. Generar código interno si no viene
  const code = body.code || `PROD-${Date.now().toString(36).toUpperCase()}`;
  
  // 6. Insertar en la base de datos
  const result = await productModel.insert(schema, {
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
  
  console.log('💾 Producto guardado:', {
    selling_price: result.selling_price,
    tax_rate: result.tax_rate,
    unit_cost: result.unit_cost
  });
  
  return result;
};

export const update = async (schema, id, body) => {
  const currentProduct = await productModel.findById(schema, id);
  if (!currentProduct) throw new Error('Producto no encontrado');
  
  let isTaxable = currentProduct.is_taxable;
  if (body.is_taxable !== undefined) isTaxable = toBool(body.is_taxable);
  else if (body.has_iva !== undefined) isTaxable = toBool(body.has_iva);
  else if (body.iva !== undefined) isTaxable = toBool(body.iva);
  
  let pvp = currentProduct.selling_price + currentProduct.tax_rate;
  if (body.price !== undefined) pvp = toNum(body.price);
  else if (body.precioVenta !== undefined) pvp = toNum(body.precioVenta);
  
  let taxValue = currentProduct.tax_rate;
  let priceWithoutTax = currentProduct.selling_price;
  
  const precioCambio = (body.price !== undefined || body.precioVenta !== undefined);
  const ivaCambio = (body.is_taxable !== undefined || body.has_iva !== undefined || body.iva !== undefined);
  
  if (precioCambio || ivaCambio) {
    const calculo = await calcIvaConTasaVigente(pvp, isTaxable);
    taxValue = calculo.taxValue;
    priceWithoutTax = calculo.priceWithoutTax;
  }
  
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