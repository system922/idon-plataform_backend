import { query } from '../config/database.js';

const SELECT = `
  p.id, p.code, p.name, p.description,
  p.category_id, c.name AS category_name,
  p.selling_price AS price, p.unit_cost,
  p.tax_rate, p.is_taxable, p.is_active,
  p.sku, p.barcode, p.stock, p.min_stock,
  p.created_at, p.updated_at
`;

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
  return rows;
};

export const findById = async (schema, id) => {
  const { rows } = await query(
    `SELECT ${SELECT} FROM "${schema}".products p
     LEFT JOIN "${schema}".categories c ON p.category_id = c.id
     WHERE p.id = $1`,
    [id]
  );
  return rows[0] ?? null;
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

export const getFiscalRates = async () => {
  try {
    const { rows } = await query(
      `SELECT iva_rate, iva_rate_reduced FROM public.fiscal_config LIMIT 1`
    );
    const row = rows[0] ?? {};
    return {
      iva_rate:         Number(row.iva_rate         ?? 0.15),
      iva_rate_reduced: Number(row.iva_rate_reduced ?? 0.00),
    };
  } catch {
    return { iva_rate: 0.15, iva_rate_reduced: 0.0 };
  }
};

export const insert = async (schema, d) => {
  const { rows } = await query(
    `INSERT INTO "${schema}".products
     (code,name,description,category_id,selling_price,unit_cost,
      tax_rate,is_taxable,is_active,sku,barcode,stock,min_stock)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10,$11,$12)
     RETURNING *`,
    [
      `PROD-${Date.now().toString(36).toUpperCase()}`,
      d.name, d.description, d.category_id,
      d.sellingPrice, d.unitCost, d.taxRate, d.isTaxable,
      d.sku, genEAN13(), d.stock, d.minStock,
    ]
  );
  return rows[0];
};

export const updateById = async (schema, id, d) => {
  const { rows } = await query(
    `UPDATE "${schema}".products SET
       name          = COALESCE($1, name),
       selling_price = COALESCE($2, selling_price),
       tax_rate      = COALESCE($3, tax_rate),
       is_taxable    = COALESCE($4, is_taxable),
       stock         = COALESCE($5, stock),
       updated_at    = NOW()
     WHERE id = $6 RETURNING *`,
    [d.name, d.sellingPrice, d.taxRate, d.isTaxable, d.stock, id]
  );
  return rows[0];
};

export const softDelete = async (schema, id) => {
  const { rows } = await query(
    `UPDATE "${schema}".products SET is_active = false, updated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [id]
  );
  if (!rows.length) throw new Error('Producto no encontrado');
};
