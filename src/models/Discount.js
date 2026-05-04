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
  return rows.map(d => ({
    ...d,
    days_of_week: d.days_of_week ? d.days_of_week.split(',').map(Number) : []
  }));
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
  const d = rows[0];
  return {
    ...d,
    days_of_week: d.days_of_week ? d.days_of_week.split(',').map(Number) : []
  };
}

export async function createDiscount(schema, data) {
  const {
    name, description, type, value, applies_to,
    product_id, category_id, min_amount, max_discount,
    min_quantity, code, usage_limit, days_of_week,
    start_time, end_time, start_date, end_date,
    stackable, priority, customer_segment, is_active
  } = data;

  const daysStr = days_of_week?.length ? days_of_week.join(',') : null;

  const sql = `
    INSERT INTO "${schema}".${TABLE} (
      name, description, type, value, applies_to,
      product_id, category_id, min_amount, max_discount,
      min_quantity, code, usage_limit, days_of_week,
      start_time, end_time, start_date, end_date,
      stackable, priority, customer_segment, is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING *
  `;
  const params = [
    name, description, type, value, applies_to,
    product_id, category_id, min_amount, max_discount,
    min_quantity, code, usage_limit, daysStr,
    start_time, end_time, start_date, end_date,
    stackable, priority, customer_segment, is_active
  ];
  const { rows } = await query(sql, params);
  const newDiscount = rows[0];
  return {
    ...newDiscount,
    days_of_week: newDiscount.days_of_week ? newDiscount.days_of_week.split(',').map(Number) : []
  };
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
      let val = updates[field];
      if (field === 'days_of_week' && Array.isArray(val)) {
        val = val.join(',');
      }
      fields.push(`${field} = $${idx++}`);
      values.push(val);
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
  const updated = rows[0];
  return {
    ...updated,
    days_of_week: updated.days_of_week ? updated.days_of_week.split(',').map(Number) : []
  };
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