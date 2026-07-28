// servicios/productosService.js
import * as productModel from '../models/productosModel.js';

const toNum = (v, def = null) => (v === '' || v == null ? def : Number(v));
const toText = (v) => (v === '' || v == null ? null : String(v).trim());
const toBool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1 || v === '1');

const calcIvaConTasaSeleccionada = (precioConIva, taxRate) => {
  if (!taxRate || taxRate <= 0 || !precioConIva || precioConIva <= 0) {
    return { taxValue: 0, priceWithoutTax: precioConIva || 0 };
  }
  const tasaDecimal = taxRate / 100;
  const priceWithoutTax = precioConIva / (1 + tasaDecimal);
  const taxValue = precioConIva - priceWithoutTax;
  return {
    taxValue: Number(taxValue.toFixed(2)),
    priceWithoutTax: Number(priceWithoutTax.toFixed(2))
  };
};

export const getAll = async (schema, includeInactive, category_id) => {
  if (category_id) return productModel.findByCategory(schema, category_id, includeInactive);
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
  const taxRateSelected = toNum(
    body.is_taxable ?? body.tax_rate ?? body.taxRate ?? 0,
    0
  );
  const pvp = toNum(body.price ?? body.precioVenta);
  if (!pvp || pvp <= 0) throw new Error('El precio de venta es requerido y debe ser mayor a 0');

  const { taxValue, priceWithoutTax } = calcIvaConTasaSeleccionada(pvp, taxRateSelected);

  let category_id = null;
  if (body.category_name) category_id = await productModel.findOrCreateCategory(schema, body.category_name);
  else if (body.categoria) category_id = await productModel.findOrCreateCategory(schema, body.categoria);
  else if (body.category_id) category_id = body.category_id;

  const code = body.code || `PROD-${Date.now().toString(36).toUpperCase()}`;

  const result = await productModel.insert(schema, {
    code,
    name: toText(body.name || body.nombre),
    description: toText(body.description || body.descripcion),
    category_id,
    sellingPrice: priceWithoutTax,
    unitCost: toNum(body.unit_cost ?? body.costo, 0),
    taxRate: taxValue,
    isTaxable: taxRateSelected,
    productType: body.product_type || 'COMMERCIAL',
    isActive: toBool(body.active ?? body.estado ?? body.is_active ?? true, true),
    sku: toText(body.sku),
    barcode: toText(body.barcode || body.codigoBarras),
    stock: toNum(body.stock, 0),
    minStock: toNum(body.min_stock ?? body.minStock, 0),
  });

  console.log('💾 Producto creado:', { ...result, is_active: result.is_active });
  return result;
};

export const update = async (schema, id, body) => {
  const currentProduct = await productModel.findById(schema, id);
  if (!currentProduct) throw new Error('Producto no encontrado');

  let taxRateSelected = currentProduct.is_taxable;
  if (body.is_taxable !== undefined) taxRateSelected = toNum(body.is_taxable, taxRateSelected);
  else if (body.tax_rate !== undefined) taxRateSelected = toNum(body.tax_rate, taxRateSelected);
  else if (body.taxRate !== undefined) taxRateSelected = toNum(body.taxRate, taxRateSelected);

  let pvp = null;
  if (body.price !== undefined) pvp = toNum(body.price);
  else if (body.precioVenta !== undefined) pvp = toNum(body.precioVenta);
  if (pvp === null || pvp === undefined) {
    const tasaActual = taxRateSelected / 100;
    pvp = currentProduct.selling_price * (1 + tasaActual);
  }

  const calculoIva = calcIvaConTasaSeleccionada(pvp, taxRateSelected);
  const taxValue = calculoIva.taxValue;
  const priceWithoutTax = calculoIva.priceWithoutTax;

  let category_id = currentProduct.category_id;
  if (body.category_name !== undefined) {
    if (body.category_name === '' || body.category_name === null) category_id = null;
    else if (body.category_name !== currentProduct.category_name) {
      category_id = await productModel.findOrCreateCategory(schema, body.category_name);
    }
  } else if (body.categoria !== undefined) {
    if (body.categoria === '' || body.categoria === null) category_id = null;
    else if (body.categoria !== currentProduct.category_name) {
      category_id = await productModel.findOrCreateCategory(schema, body.categoria);
    }
  } else if (body.category_id !== undefined) {
    category_id = body.category_id === '' ? null : body.category_id;
  }

  const isActive = toBool(
    body.active ?? body.estado ?? body.is_active ?? currentProduct.is_active,
    currentProduct.is_active
  );

  // Determinar product_type
  let productType = currentProduct.product_type || 'COMMERCIAL';
  if (body.product_type !== undefined) {
    const tiposPermitidos = ['COMMERCIAL', 'MANUFACTURED'];
    productType = tiposPermitidos.includes(body.product_type) ? body.product_type : 'COMMERCIAL';
  }

  console.log('🔍 VALOR DE isActive A ACTUALIZAR:', isActive);
  console.log('🔍 VALOR DE productType A ACTUALIZAR:', productType);

  const result = await productModel.updateById(schema, id, {
    name: toText(body.name || body.nombre) || currentProduct.name,
    description: toText(body.description || body.descripcion) || currentProduct.description,
    sellingPrice: priceWithoutTax,
    unit_cost: toNum(body.unit_cost ?? body.costo, currentProduct.unit_cost),
    taxRate: taxValue,
    isTaxable: taxRateSelected,
    productType: productType,
    isActive: isActive,
    stock: toNum(body.stock, currentProduct.stock),
    category_id,
    sku: toText(body.sku) || currentProduct.sku,
    barcode: toText(body.barcode || body.codigoBarras) || currentProduct.barcode,
    min_stock: toNum(body.min_stock ?? body.minStock, currentProduct.min_stock),
  });

  console.log('✅ Producto actualizado (servicio):', { ...result, is_active: result.is_active });
  return result;
};

export const remove = (schema, id) => productModel.softDelete(schema, id);