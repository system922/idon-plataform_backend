// servicios/productosService.js
import * as productModel from '../models/productosModel.js';

const toNum = (v, def = null) => (v === '' || v == null ? def : Number(v));
const toText = (v) => (v === '' || v == null ? null : String(v).trim());
const toBool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1 || v === '1');

/**
 * Calcula el IVA usando la tasa seleccionada (0, 5, 8, 12, 15)
 * @param {number} precioConIva - PVP (precio con IVA que ingresa el usuario)
 * @param {number} taxRate - Tasa IVA seleccionada (0, 5, 8, 12, 15)
 * @returns {Object} { taxValue, priceWithoutTax }
 */
const calcIvaConTasaSeleccionada = (precioConIva, taxRate) => {
  // Si no hay tasa IVA (0%), el precio es el mismo que ingresó
  if (!taxRate || taxRate <= 0 || !precioConIva || precioConIva <= 0) {
    return { 
      taxValue: 0, 
      priceWithoutTax: precioConIva || 0 
    };
  }
  
  // Convertir tasa porcentual a decimal (15 → 0.15)
  const tasaDecimal = taxRate / 100;
  
  console.log('💰 Calculando IVA con tasa:', { precioConIva, taxRate, tasaDecimal });
  
  // Calcular precio sin IVA: pvp / (1 + tasa)
  const priceWithoutTax = precioConIva / (1 + tasaDecimal);
  // Calcular monto IVA: pvp - precio_sin_iva
  const taxValue = precioConIva - priceWithoutTax;
  
  console.log('✅ Resultado cálculo IVA:', { 
    priceWithoutTax: priceWithoutTax.toFixed(2), 
    taxValue: taxValue.toFixed(2),
    taxRate
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
  // 1. Obtener la tasa IVA seleccionada (0, 5, 8, 12, 15)
  // is_taxable ahora contiene la tasa IVA, no un booleano
  const taxRateSelected = toNum(
    body.is_taxable !== undefined ? body.is_taxable :
    body.tax_rate !== undefined ? body.tax_rate :
    body.taxRate !== undefined ? body.taxRate : 0,
    0
  );
  
  // 2. Obtener el PVP (precio con IVA) que envía el frontend
  const pvp = toNum(body.price !== undefined ? body.price : body.precioVenta);
  if (!pvp || pvp <= 0) {
    throw new Error('El precio de venta es requerido y debe ser mayor a 0');
  }
  
  console.log('📦 CREAR PRODUCTO - DEBUG:', { 
    name: body.name, 
    pvp_recibido: pvp, 
    tasa_iva_recibida: taxRateSelected,
    campos_del_body: Object.keys(body)
  });
  
  // 3. Calcular selling_price (precio sin IVA) y tax_rate (monto del IVA)
  const { taxValue, priceWithoutTax } = calcIvaConTasaSeleccionada(pvp, taxRateSelected);
  
  console.log('✅ CREAR PRODUCTO - CALCULADO:', { 
    priceWithoutTax,
    taxValue,
    taxRateSelected
  });
  const { taxValue, priceWithoutTax } = calcIvaConTasaSeleccionada(pvp, taxRateSelected);
  
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
    isTaxable: taxRateSelected,  // Guardar la tasa IVA (0, 5, 8, 12, 15) en is_taxable
    isActive: toBool(body.active !== undefined ? body.active : body.estado, true),
    sku: toText(body.sku),
    barcode: toText(body.barcode || body.codigoBarras),
    stock: toNum(body.stock, 0),
    minStock: toNum(body.min_stock !== undefined ? body.min_stock : body.minStock, 0),
  });
  
  console.log('💾 Producto guardado:', {
    selling_price: result.selling_price,
    tax_rate: result.tax_rate,
    is_taxable: result.is_taxable,
    unit_cost: result.unit_cost
  });
  
  return result;
};

export const update = async (schema, id, body) => {
  const currentProduct = await productModel.findById(schema, id);
  if (!currentProduct) throw new Error('Producto no encontrado');
  
  // 1. Obtener la tasa IVA seleccionada (del body o mantener la actual)
  let taxRateSelected = currentProduct.is_taxable; // Esto ya es la tasa (15)
  
  // Buscar en el body la nueva tasa
  if (body.is_taxable !== undefined) taxRateSelected = toNum(body.is_taxable, taxRateSelected);
  else if (body.tax_rate !== undefined) taxRateSelected = toNum(body.tax_rate, taxRateSelected);
  else if (body.taxRate !== undefined) taxRateSelected = toNum(body.taxRate, taxRateSelected);
  
  // 2. Obtener el PRECIO CON IVA que viene del frontend
  let pvp = null; // Precio con IVA
  if (body.price !== undefined) pvp = toNum(body.price);
  else if (body.precioVenta !== undefined) pvp = toNum(body.precioVenta);
  
  // 3. Si no viene precio en el body, calcularlo desde los datos actuales
  if (pvp === null || pvp === undefined) {
    // Reconstruir precio con IVA desde selling_price y la tasa actual
    const tasaActual = taxRateSelected / 100;
    pvp = currentProduct.selling_price * (1 + tasaActual);
  }
  
  console.log('🔄 Actualizando producto:', {
    id,
    pvp_enviado: pvp,
    taxRateSelected,
    current_selling_price: currentProduct.selling_price,
    current_tax_rate: currentProduct.tax_rate,
    current_is_taxable: currentProduct.is_taxable
  });
  
  // 4. Recalcular selling_price (sin IVA) y tax_rate (monto IVA)
  const { taxValue, priceWithoutTax } = calcIvaConTasaSeleccionada(pvp, taxRateSelected);
  
  // 5. Actualizar categoría si es necesario
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
  
  // 6. Actualizar en BD
  const result = await productModel.updateById(schema, id, {
    name: toText(body.name || body.nombre) || currentProduct.name,
    description: toText(body.description || body.descripcion) || currentProduct.description,
    sellingPrice: priceWithoutTax,
    unit_cost: toNum(body.unit_cost !== undefined ? body.unit_cost : body.costo, currentProduct.unit_cost),
    taxRate: taxValue,
    isTaxable: taxRateSelected,  // Guardar la tasa IVA (15, no el monto)
    isActive: toBool(body.active !== undefined ? body.active : body.estado, currentProduct.is_active),
    stock: toNum(body.stock, currentProduct.stock),
    category_id,
    sku: toText(body.sku) || currentProduct.sku,
    barcode: toText(body.barcode || body.codigoBarras) || currentProduct.barcode,
    min_stock: toNum(body.min_stock !== undefined ? body.min_stock : body.minStock, currentProduct.min_stock),
  });
  
  console.log('✅ Producto actualizado:', {
    selling_price: result.selling_price,
    tax_rate: result.tax_rate,
    is_taxable: result.is_taxable
  });
  
  return result;
};

export const remove = (schema, id) => productModel.softDelete(schema, id);