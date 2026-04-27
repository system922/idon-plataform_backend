import * as expenseService from '../services/expenseService.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { ecuadorToday } from '../utils/dateHelper.js';

// Listar todas las compras (gastos tipo egreso de caja)
export const getAllExpenses = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    // Si se pasa ?date=YYYY-MM-DD, filtra por fecha:
    const { date } = req.query;
    let expenses;
    if (date) {
      expenses = await expenseService.getExpensesByDate(schema, date);
    } else {
      expenses = await expenseService.getAllExpenses(schema, { limit: req.query.limit || 100 });
    }

    // Suma y cuenta:
    const total = expenses.reduce((acc, x) => acc + Number(x.amount || 0), 0);
    const count = expenses.length;

    res.json({ total, count, expenses });
  } catch (e) {
    res.status(500).json({ error: 'Error obteniendo gastos', detail: e.message });
  }
};

// Gastos/compras de una fecha
export const getExpensesByDate = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { date } = req.params;
    const expenses = await expenseService.getExpensesByDate(schema, date);
    res.json({ expenses });
  } catch (e) {
    res.status(500).json({ error: 'Error obteniendo gastos por fecha', detail: e.message });
  }
};

// Total de compras por día
export const getPurchasesTotalByDay = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const date = req.query.date || ecuadorToday();
    const totalInfo = await expenseService.getPurchasesTotalByDay(schema, date);
    res.json({
      date,
      total: parseFloat(totalInfo.total),
      count: parseInt(totalInfo.count, 10)
    });
  } catch (e) {
    res.status(500).json({ error: 'Error obteniendo total de compras', detail: e.message });
  }
};