import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// GET /api/accounting/balance?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=month|day
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { from, to, groupBy = 'month' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'Rango de fechas requerido' });
    }

    // 1. Ventas netas (órdenes pagadas)
    const salesQuery = `
      SELECT 
        ${groupBy === 'month' ? "DATE_TRUNC('month', created_at) as period" : "DATE(created_at) as period"},
        SUM(total) as amount
      FROM "${schema}".pos_orders
      WHERE status = 'paid' AND created_at::date BETWEEN $1 AND $2
      GROUP BY period
      ORDER BY period
    `;
    const sales = await query(salesQuery, [from, to]);

    // 2. Gastos operativos (expenses)
    const expensesQuery = `
      SELECT 
        ${groupBy === 'month' ? "DATE_TRUNC('month', date) as period" : "date as period"},
        SUM(amount) as amount
      FROM "${schema}".expenses
      WHERE date BETWEEN $1 AND $2
      GROUP BY period
      ORDER BY period
    `;
    const expenses = await query(expensesQuery, [from, to]);

    // 3. Totales del período
    const totalsQuery = `
      SELECT
        (SELECT COALESCE(SUM(total),0) FROM "${schema}".pos_orders WHERE status='paid' AND created_at::date BETWEEN $1 AND $2) as total_sales,
        (SELECT COALESCE(SUM(amount),0) FROM "${schema}".expenses WHERE date BETWEEN $1 AND $2) as total_expenses
    `;
    const totals = await query(totalsQuery, [from, to]);

    // 4. (Opcional) Ingresos no operativos si existe tabla incomes
    let totalIncomes = 0;
    try {
      const incomesQuery = `
        SELECT COALESCE(SUM(amount),0) FROM "${schema}".incomes WHERE date BETWEEN $1 AND $2
      `;
      const incomesRes = await query(incomesQuery, [from, to]);
      totalIncomes = parseFloat(incomesRes.rows[0].coalesce) || 0;
    } catch (err) {
      // tabla incomes no existe, ignorar
    }

    const totalSales = parseFloat(totals.rows[0].total_sales) || 0;
    const totalExpenses = parseFloat(totals.rows[0].total_expenses) || 0;
    const netIncome = totalSales + totalIncomes - totalExpenses;

    res.json({
      sales: sales.rows,
      expenses: expenses.rows,
      total_sales: totalSales,
      total_expenses: totalExpenses,
      total_incomes: totalIncomes,
      net_income: netIncome,
      filters: { from, to, groupBy }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;