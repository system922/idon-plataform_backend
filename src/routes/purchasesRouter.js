import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// EXPENSE CATEGORIES — /api/purchases/expense-categories
// (rutas específicas ANTES del wildcard /:id)
// ─────────────────────────────────────────────────────────────

router.get('/expense-categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`SELECT id, name, color, created_at FROM "${schema}".expense_categories ORDER BY name`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`SELECT id, name, color FROM "${schema}".expense_categories ORDER BY name`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/expense-categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await query(
      `INSERT INTO "${schema}".expense_categories (name, color) VALUES ($1, $2) RETURNING *`,
      [name, color || '#95a5a6']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/expense-categories/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { name, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Nombre requerido' });
    const result = await query(
      `UPDATE "${schema}".expense_categories SET name=$1, color=$2 WHERE id=$3 RETURNING *`,
      [name, color || '#95a5a6', id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/expense-categories/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const check = await query(`SELECT COUNT(*) FROM "${schema}".expenses WHERE category_id=$1`, [id]);
    if (parseInt(check.rows[0].count) > 0) {
      return res.status(400).json({ error: 'No se puede eliminar: hay gastos asociados' });
    }
    const result = await query(`DELETE FROM "${schema}".expense_categories WHERE id=$1 RETURNING id`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────
// EXPENSES — /api/purchases/expenses
// ─────────────────────────────────────────────────────────────

async function ensureExpensesTable(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".expenses (
      id SERIAL PRIMARY KEY,
      reference VARCHAR(100),
      description VARCHAR(500),
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      category_id INTEGER,
      supplier VARCHAR(255),
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

router.get('/expenses', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureExpensesTable(schema);
    const { date_from, date_to, category_id, reference } = req.query;

    let where = [];
    let params = [];
    let idx = 1;

    if (date_from)   { where.push(`e.date >= $${idx++}`); params.push(date_from); }
    if (date_to)     { where.push(`e.date <= $${idx++}`); params.push(date_to); }
    if (category_id) { where.push(`e.category_id = $${idx++}`); params.push(category_id); }
    if (reference)   { where.push(`e.reference ILIKE $${idx++}`); params.push(`%${reference}%`); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const result = await query(`
      SELECT e.*, ec.name AS category_name, ec.color AS category_color
      FROM "${schema}".expenses e
      LEFT JOIN "${schema}".expense_categories ec ON ec.id = e.category_id
      ${whereClause}
      ORDER BY e.date DESC, e.created_at DESC
    `, params);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/expenses', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureExpensesTable(schema);
    const { reference, description, amount, date, category_id, supplier, notes } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Monto requerido' });

    const result = await query(`
      INSERT INTO "${schema}".expenses (reference, description, amount, date, category_id, supplier, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [reference || null, description || null, amount, date || new Date(), category_id || null, supplier || null, notes || null]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureExpensesTable(schema);
    const { id } = req.params;
    const { reference, description, amount, date, category_id, supplier, notes } = req.body;

    const result = await query(`
      UPDATE "${schema}".expenses
      SET reference=$1, description=$2, amount=$3, date=$4, category_id=$5, supplier=$6, notes=$7, updated_at=NOW()
      WHERE id=$8 RETURNING *
    `, [reference || null, description || null, amount, date, category_id || null, supplier || null, notes || null, id]);

    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Gasto no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/expenses/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureExpensesTable(schema);
    const { id } = req.params;
    const result = await query(`DELETE FROM "${schema}".expenses WHERE id=$1 RETURNING id`, [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Gasto no encontrado' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/expenses/export', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureExpensesTable(schema);
    const { date_from, date_to, category_id } = req.query;

    let where = [];
    let params = [];
    let idx = 1;
    if (date_from)   { where.push(`e.date >= $${idx++}`); params.push(date_from); }
    if (date_to)     { where.push(`e.date <= $${idx++}`); params.push(date_to); }
    if (category_id) { where.push(`e.category_id = $${idx++}`); params.push(category_id); }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const result = await query(`
      SELECT e.date AS "Fecha", e.reference AS "Referencia", e.description AS "Descripción",
             ec.name AS "Categoría", e.supplier AS "Proveedor",
             e.amount AS "Monto", e.notes AS "Notas"
      FROM "${schema}".expenses e
      LEFT JOIN "${schema}".expense_categories ec ON ec.id = e.category_id
      ${whereClause}
      ORDER BY e.date DESC
    `, params);

    const headers = ['Fecha', 'Referencia', 'Descripción', 'Categoría', 'Proveedor', 'Monto', 'Notas'];
    const rows = result.rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="gastos.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PURCHASE ORDERS — (rutas genéricas al final)
// ─────────────────────────────────────────────────────────────

router.get('/by-day', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT to_char(created_at, 'Dy') as day, SUM(total)::float as total
     FROM "${schema}".purchase_orders
     GROUP BY day
     ORDER BY MIN(created_at)`
  );
  res.json(result.rows);
});

router.get('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(`SELECT * FROM "${schema}".purchase_orders ORDER BY created_at DESC`);
  res.json(result.rows);
});

router.post('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { order_number, supplier_id, status = 'draft', subtotal, tax_amount, total, expected_at, received_at, notes } = req.body;
  const result = await query(
    `INSERT INTO "${schema}".purchase_orders
     (order_number, supplier_id, status, subtotal, tax_amount, total, expected_at, received_at, notes, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *`,
    [order_number, supplier_id, status, subtotal, tax_amount, total, expected_at, received_at, notes]
  );
  res.json(result.rows[0]);
});

router.get('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const result = await query(`SELECT * FROM "${schema}".purchase_orders WHERE id=$1`, [id]);
  res.json(result.rows[0]);
});

router.put('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const { status, subtotal, tax_amount, total, expected_at, received_at, notes } = req.body;
  await query(
    `UPDATE "${schema}".purchase_orders
     SET status=$1, subtotal=$2, tax_amount=$3, total=$4, expected_at=$5, received_at=$6, notes=$7, updated_at=NOW()
     WHERE id=$8`,
    [status, subtotal, tax_amount, total, expected_at, received_at, notes, id]
  );
  res.json({ success: true });
});

router.delete('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  await query(`DELETE FROM "${schema}".purchase_orders WHERE id=$1`, [id]);
  res.json({ success: true });
});

export default router;
