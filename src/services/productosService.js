import * as productModel from '../models/productosModel.js';

const toNum  = (v, def = null) => (v === '' || v == null ? def : Number(v));
const toText = (v)             => (v === '' || v == null ? null : String(v).trim());
const toBool = (v, def = true) => (v == null ? def : v === true || v === 'true' || v === 1);

function calcIva(price, isTaxable, rates) {
  const percent = isTaxable ? rates.iva_rate : rates.iva_rate_reduced;
  const tax     = isTaxable ? price - (price / (1 + percent / 100)) : 0;
  return { taxValue: tax, priceWithoutTax: price - tax };
}

export const getAll     = (schema, includeInactive) => productModel.findAll(schema, includeInactive);
export const getById    = (schema, id)               => productModel.findById(schema, id);
export const getFiscalRates = ()                     => productModel.getFiscalRates();

export const getNextCode = async (schema, categoria) => {
  const cat  = (categoria || 'PROD').slice(0, 4).toUpperCase();
  const total = await productModel.countByCategory(schema, cat);
  const next  = total + 1;
  return { code: `${cat}-${String(next).padStart(3, '0')}`, next };
};

export const create = async (schema, body) => {
  const rates         = await productModel.getFiscalRates();
  const isTaxable     = toBool(body.iva, true);
  const price         = toNum(body.precioVenta);
  const { taxValue, priceWithoutTax } = calcIva(price, isTaxable, rates);
  const category_id   = await productModel.findCategoryId(schema, body.categoria);

  return productModel.insert(schema, {
    name:           toText(body.nombre),
    description:    toText(body.descripcion),
    category_id,
    sellingPrice:   priceWithoutTax,
    unitCost:       toNum(body.costo, 0),
    taxRate:        taxValue,
    isTaxable,
    sku:            toText(body.sku),
    stock:          toNum(body.stock, 0),
    minStock:       toNum(body.minStock, 0),
  });
};

export const update = async (schema, id, body) => {
  const rates     = await productModel.getFiscalRates();
  const isTaxable = body.iva != null ? toBool(body.iva) : null;
  let priceWithoutTax = null, taxValue = null;

  if (body.precioVenta != null) {
    const r = calcIva(toNum(body.precioVenta, 0), isTaxable, rates);
    priceWithoutTax = r.priceWithoutTax;
    taxValue        = r.taxValue;
  }

  return productModel.updateById(schema, id, {
    name:         toText(body.nombre),
    sellingPrice: priceWithoutTax,
    taxRate:      taxValue,
    isTaxable,
    stock:        toNum(body.stock),
  });
};

export const remove = (schema, id) => productModel.softDelete(schema, id);