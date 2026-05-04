import { query } from '../config/database.js';

const TABLE = 'pos_discounts';

export async function findAllDiscounts(schema) {
  const sql = `
    SELECT d.*,
           c.name AS category_name,
           p.name AS product_name
    FROM "${schema}".${TABLE} d
    LEFT JOIN "${schema}".categories c ON d.category_id = c.id
    LEFT JOIN "${schema}".products p ON d.product_id = p.id
    ORDER BY d.priority DESC, d.created_at DESC
  `;
  const { rows } = await query(sql);
  // days_of_week ya viene como array de enteros (postgres lo devuelve así)
  return rows;
}

export async function findDiscountById(schema, id) {
  const sql = `
    SELECT d.*,
           c.name AS category_name,
           p.name AS product_name
    FROM "${schema}".${TABLE} d
    LEFT JOIN "${schema}".categories c ON d.category_id = c.id
    LEFT JOIN "${schema}".products p ON d.product_id = p.id
    WHERE d.id = $1
  `;
  const { rows } = await query(sql, [id]);
  if (rows.length === 0) return null;
  return rows[0];
}

export async function createDiscount(schema, data) {
  const {
    name, description, type, value, applies_to,
    product_id, category_id, min_amount, max_discount,
    min_quantity, code, usage_limit, days_of_week,
    start_time, end_time, start_date, end_date,
    stackable, priority, customer_segment, is_active,
    created_by
  } = data;

  const sql = `
    INSERT INTO "${schema}".${TABLE} (
      name, description, type, value, applies_to,
      product_id, category_id, min_amount, max_discount,
      min_quantity, code, usage_limit, days_of_week,
      start_time, end_time, start_date, end_date,
      stackable, priority, customer_segment, is_active, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    RETURNING *
  `;
  const params = [
    name, description, type, value, applies_to,
    product_id || null, category_id || null, min_amount || 0, max_discount || null,
    min_quantity || 1, code || null, usage_limit || null, days_of_week || null,
    start_time || null, end_time || null, start_date || null, end_date || null,
    stackable || false, priority || 0, customer_segment || 'all', is_active !== false,
    created_by || null
  ];
  const { rows } = await query(sql, params);
  return rows[0];
}

export async function updateDiscount(schema, id, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  const allowed = [
    'name', 'description', 'type', 'value', 'applies_to',
    'product_id', 'category_id', 'min_amount', 'max_discount',
    'min_quantity', 'code', 'usage_limit', 'days_of_week',
    'start_time', 'end_time', 'start_date', 'end_date',
    'stackable', 'priority', 'customer_segment', 'is_active'
  ];

  for (const field of allowed) {
    if (updates[field] !== undefined) {
      fields.push(`${field} = $${idx++}`);
      values.push(updates[field]);
    }
  }

  if (fields.length === 0) return findDiscountById(schema, id);

  values.push(id);
  const sql = `
    UPDATE "${schema}".${TABLE}
    SET ${fields.join(', ')}, updated_at = NOW()
    WHERE id = $${idx}
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  if (rows.length === 0) return null;
  return rows[0];
}

export async function deleteDiscount(schema, id, hardDelete = false) {
  let sql;
  let params = [id];
  if (hardDelete) {
    sql = `DELETE FROM "${schema}".${TABLE} WHERE id = $1 RETURNING id`;
  } else {
    sql = `UPDATE "${schema}".${TABLE} SET is_active = false WHERE id = $1 RETURNING id`;
  }
  const { rows } = await query(sql, params);
  return rows[0] || null;
}