import * as expenseService from '../services/expenseService.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { ecuadorToday } from '../utils/dateHelper.js';
import { query } from '../config/database.js';

// Listar gastos con filtros avanzados (date_from, date_to, category_id)
export const getAllExpenses = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { date_from, date_to, category_id } = req.query;
    
    let sql = `
      SELECT e.id, e.date, e.description, e.amount, e.reference, e.created_by, e.created_at,
             e.category_id, c.name as category_name
      FROM "${schema}".expenses e
      LEFT JOIN "${schema}".expense_categories c ON e.category_id = c.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (date_from) {
      sql += ` AND e.date >= $${paramIndex++}`;
      params.push(date_from);
    }
    if (date_to) {
      sql += ` AND e.date <= $${paramIndex++}`;
      params.push(date_to);
    }
    if (category_id) {
      sql += ` AND e.category_id = $${paramIndex++}`;
      params.push(category_id);
    }

    sql += ` ORDER BY e.date DESC, e.created_at DESC`;
    
    const result = await query(sql, params);
    
    // Devolver directamente el array de gastos (como espera el frontend)
    res.json(result.rows);
  } catch (e) {
    console.error('Error en getAllExpenses:', e);
    res.status(500).json({ error: 'Error obteniendo gastos', detail: e.message });
  }
};

// Obtener gastos por fecha específica (mantenido por compatibilidad)
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

// Crear gasto/egreso
export const createExpense = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { amount, description, reference, category_id, created_by, date } = req.body;

    if (!amount || isNaN(Number(amount))) {
      return res.status(400).json({ error: 'El campo amount es requerido y debe ser numérico' });
    }

    const targetDate = date || ecuadorToday();

    const result = await query(
      `INSERT INTO "${schema}".expenses (amount, description, reference, category_id, created_by, date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [Number(amount), description || null, reference || null, category_id || null, created_by || null, targetDate]
    );

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('Error creando gasto:', e);
    res.status(500).json({ error: 'Error creando gasto', detail: e.message });
  }
};

// Actualizar gasto
export const updateExpense = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const { amount, description, reference, category_id, date } = req.body;

    const result = await query(
      `UPDATE "${schema}".expenses
       SET amount = $1, description = $2, reference = $3, category_id = $4, date = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [Number(amount), description || null, reference || null, category_id || null, date, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error actualizando gasto', detail: e.message });
  }
};

// Eliminar gasto
export const deleteExpense = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { id } = req.params;
    const result = await query(
      `DELETE FROM "${schema}".expenses WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Gasto no encontrado' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error eliminando gasto', detail: e.message });
  }
};

// Total de compras por día (mantenido)
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