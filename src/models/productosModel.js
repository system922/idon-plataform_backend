// modelos/productosModel.js
import { query } from '../config/database.js';

const SELECT = `
  p.id, p.code, p.name, p.description,
  p.category_id, c.name AS category_name,
  p.selling_price, p.unit_cost,
  p.tax_rate, 
  CAST(p.is_taxable AS NUMERIC(5,2)) as is_taxable,
  p.product_type,
  p.is_active,
  p.sku, p.barcode, p.stock, p.min_stock,
  p.created_at, p.updated_at
`;

// Función para normalizar los datos del producto
const normalizeProduct = (row) => {
  if (!row) return null;

  let isTaxableValue = 0;
  if (typeof row.is_taxable === 'boolean') {
    isTaxableValue = row.is_taxable ? 15 : 0;
  } else if (row.is_taxable !== null && row.is_taxable !== undefined) {
    isTaxableValue = Number(Math.round(row.is_taxable));
  } else {
    isTaxableValue = 0;
  }

  const tasasPermitidas = [0, 5, 8, 12, 15];
  if (!tasasPermitidas.includes(isTaxableValue)) {
    isTaxableValue = 0;
  }

  const productType = row.product_type || 'COMMERCIAL';
  const tiposPermitidos = ['COMMERCIAL', 'MANUFACTURED'];
  const safeProductType = tiposPermitidos.includes(productType) ? productType : 'COMMERCIAL';

  return {
    ...row,
    is_taxable: isTaxableValue,
    product_type: safeProductType,
    tax_rate: row.tax_rate ? Number(row.tax_rate) : 0,
    selling_price: Number(row.selling_price) || 0,
    unit_cost: Number(row.unit_cost) || 0,
    stock: Number(row.stock) || 0,
    min_stock: Number(row.min_stock) || 0,
  };
};

function genEAN13() {
  const base = String(Math.floor(1e10 + Math.random() * 9e11)).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < base.length; i++) sum += (i % 2 ? 3 : 1) * Number(base[i]);
  return base + ((10 - (sum % 10)) % 10);
}

export const findAll = async (schema, includeInactive = false) => {
  const where = includeInactive ? '' : 'WHERE p.is_active = true';
  const { rows } = await query(
    `SELECT ${SELECT} FROM "${schema}".products p
     LEFT JOIN "${schema}".categories c ON p.category_id = c.id
     ${where} ORDER BY p.name ASC`
  );
  return rows.map(normalizeProduct);
};

export const findByCategory = async (schema, category_id, includeInactive = false) => {
  const where = includeInactive ? 'WHERE p.category_id = $1' : 'WHERE p.category_id = $1 AND p.is_active = true';
  const { rows } = await query(
    `SELECT ${SELECT} FROM "${schema}".products p
     LEFT JOIN "${schema}".categories c ON p.category_id = c.id
     ${where} ORDER BY p.name ASC`,
    [category_id]
  );
  return rows.map(normalizeProduct);
};

export const findById = async (schema, id) => {
  const { rows } = await query(
    `SELECT ${SELECT} FROM "${schema}".products p
     LEFT JOIN "${schema}".categories c ON p.category_id = c.id
     WHERE p.id = $1`,
    [id]
  );
  return normalizeProduct(rows[0] ?? null);
};

export const countByCategory = async (schema, cat) => {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM "${schema}".products WHERE code LIKE $1`,
    [`${cat}-%`]
  );
  return Number(rows[0]?.total || 0);
};

export const findCategoryId = async (schema, categoria) => {
  if (!categoria) return null;
  const { rows } = await query(
    `SELECT id FROM "${schema}".categories WHERE LOWER(name) = LOWER($1)`,
    [categoria]
  );
  return rows[0]?.id ?? null;
};

export const findOrCreateCategory = async (schema, categoryName) => {
  if (!categoryName) return null;
  
  const findResult = await query(
    `SELECT id FROM "${schema}".categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [categoryName]
  );
  
  if (findResult.rows.length > 0) {
    return findResult.rows[0].id;
  }
  
  const insertResult = await query(
    `INSERT INTO "${schema}".categories (name) VALUES ($1) RETURNING id`,
    [categoryName]
  );
  
  return insertResult.rows[0].id;
};

export const getFiscalRates = async () => {
  try {
    const { rows } = await query(
      `SELECT iva_rate, iva_rate_reduced FROM public.fiscal_config WHERE is_active = TRUE LIMIT 1`
    );
    const row = rows[0] ?? {};
    
    let ivaRate = Number(row.iva_rate ?? 0.15);
    let ivaRateReduced = Number(row.iva_rate_reduced ?? 0.05);
    
    if (ivaRate > 1) {
      ivaRate = ivaRate / 100;
    }
    if (ivaRateReduced > 1) {
      ivaRateReduced = ivaRateReduced / 100;
    }
    
    return {
      iva_rate: ivaRate,
      iva_rate_reduced: ivaRateReduced,
    };
  } catch (error) {
    console.error('Error getFiscalRates:', error);
    return { iva_rate: 0.15, iva_rate_reduced: 0.05 };
  }
};

export const insert = async (schema, d) => {
  const { rows } = await query(
    `INSERT INTO "${schema}".products
     (code, name, description, category_id, selling_price, unit_cost,
      tax_rate, is_taxable, product_type, is_active, sku, barcode, stock, min_stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      d.code || `PROD-${Date.now().toString(36).toUpperCase()}`,
      d.name, d.description, d.category_id,
      d.sellingPrice, d.unitCost, d.taxRate, d.isTaxable,
      d.productType || 'COMMERCIAL',
      d.isActive !== false, d.sku, d.barcode || genEAN13(), d.stock || 0, d.minStock || 0,
    ]
  );
  return normalizeProduct(rows[0]);
};

export const updateById = async (schema, id, d) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (d.name !== undefined && d.name !== null) {
    updates.push(`name = $${idx++}`);
    values.push(d.name);
  }
  if (d.sellingPrice !== undefined && d.sellingPrice !== null) {
    updates.push(`selling_price = $${idx++}`);
    values.push(d.sellingPrice);
  }
  if (d.taxRate !== undefined && d.taxRate !== null) {
    updates.push(`tax_rate = $${idx++}`);
    values.push(d.taxRate);
  }
  if (d.isTaxable !== undefined && d.isTaxable !== null) {
    updates.push(`is_taxable = $${idx++}`);
    values.push(d.isTaxable);
  }
  if (d.productType !== undefined && d.productType !== null) {
    updates.push(`product_type = $${idx++}`);
    values.push(d.productType);
  }
  if (d.isActive !== undefined && d.isActive !== null) {
    updates.push(`is_active = $${idx++}`);
    values.push(d.isActive);
  }
  if (d.stock !== undefined && d.stock !== null) {
    updates.push(`stock = $${idx++}`);
    values.push(d.stock);
  }
  if (d.category_id !== undefined) {
    updates.push(`category_id = $${idx++}`);
    values.push(d.category_id === '' ? null : d.category_id);
  }
  if (d.description !== undefined && d.description !== null) {
    updates.push(`description = $${idx++}`);
    values.push(d.description);
  }
  if (d.unit_cost !== undefined && d.unit_cost !== null) {
    updates.push(`unit_cost = $${idx++}`);
    values.push(d.unit_cost);
  }
  if (d.sku !== undefined && d.sku !== null) {
    updates.push(`sku = $${idx++}`);
    values.push(d.sku);
  }
  if (d.barcode !== undefined && d.barcode !== null) {
    updates.push(`barcode = $${idx++}`);
    values.push(d.barcode);
  }
  if (d.min_stock !== undefined && d.min_stock !== null) {
    updates.push(`min_stock = $${idx++}`);
    values.push(d.min_stock);
  }

  if (updates.length === 0) {
    const { rows } = await query(
      `SELECT * FROM "${schema}".products WHERE id = $1`,
      [id]
    );
    return normalizeProduct(rows[0]);
  }

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const { rows } = await query(
    `UPDATE "${schema}".products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  return normalizeProduct(rows[0]);
};

// Agregar esta función para eliminar físicamente
export const deleteProduct = async (schema, id) => {
  // Verificar si el producto existe
  const checkResult = await query(
    `SELECT id FROM "${schema}".products WHERE id = $1`,
    [id]
  );
  
  if (checkResult.rows.length === 0) {
    throw new Error('Producto no encontrado');
  }
  
  // Eliminar físicamente
  const { rows } = await query(
    `DELETE FROM "${schema}".products WHERE id = $1 RETURNING id`,
    [id]
  );
  
  if (!rows.length) throw new Error('Producto no encontrado');
  return rows[0];
};

// Soft delete (lo mantienes por si lo necesitas)
export const softDelete = async (schema, id) => {
  const { rows } = await query(
    `UPDATE "${schema}".products SET is_active = false, updated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!rows.length) throw new Error('Producto no encontrado');
  return rows[0];
};