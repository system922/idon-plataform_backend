// utils/queryHelpers.js
export function applyDateRange(sql, params, { from, to }, column = 'created_at') {
  if (from) { sql += ` AND ${column} >= $${params.length + 1}`;                               params.push(from); }
  if (to)   { sql += ` AND ${column} < ($${params.length + 1}::date + INTERVAL '1 day')`;     params.push(to);   }
  return sql;
}