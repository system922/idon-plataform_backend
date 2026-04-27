import db from '../config/database.js';

// Listar todos los gastos/compras
export async function getAllExpenses(schema, { limit = 100 } = {}) {
  const q = `
    SELECT *
    FROM "${schema}".expenses
    WHERE category = 'Egreso de Caja'
    ORDER BY date DESC, created_at DESC
    LIMIT $1
  `;
  const result = await db.query(q, [limit]);
  return result.rows;
}

// Buscar gastos/compras por fecha exacta
export async function getExpensesByDate(schema, date) {
  const q = `
    SELECT *
    FROM "${schema}".expenses
    WHERE category = 'Egreso de Caja'
      AND date = $1
    ORDER BY created_at DESC
  `;
  const result = await db.query(q, [date]);
  return result.rows;
}

// Total y conteo de compras por día
export async function getPurchasesTotalByDay(schema, date) {
  const q = `
    SELECT
      COALESCE(SUM(amount),0) AS total,
      COUNT(*) AS count
    FROM "${schema}".expenses
    WHERE category = 'Egreso de Caja' AND date = $1
  `;
  const result = await db.query(q, [date]);
  return result.rows[0];
}