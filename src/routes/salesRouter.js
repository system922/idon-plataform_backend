import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Lista todas las ventas pagadas
router.get('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT * FROM "${schema}".pos_orders WHERE status = 'paid' ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

// Crear nueva venta pagada
router.post('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const {
    order_number, order_type='dine_in', customer_id, customer_name,
    mesa_numero, subtotal, tax_rate, tax_amount, total, notes, created_by
  } = req.body;
  // order_number debería ser generado si no llega.
  const result = await query(
    `INSERT INTO "${schema}".pos_orders
     (order_number, order_type, status, customer_id, customer_name, mesa_numero, subtotal, tax_rate, tax_amount, total, notes, created_by, created_at)
     VALUES ($1, $2, 'paid', $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
     RETURNING *`,
    [order_number, order_type, customer_id, customer_name, mesa_numero, subtotal, tax_rate, tax_amount, total, notes, created_by]
  );
  res.json(result.rows[0]);
});

// Ventas de hoy para el dashboard
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await query(
      `SELECT
         COUNT(*)::INT                      AS tickets_count,
         COALESCE(SUM(total), 0)::NUMERIC   AS total_cobrado
       FROM "${schema}".pos_orders
       WHERE status = 'paid'
         AND DATE(created_at) = $1`,
      [targetDate]
    );

    res.json(result.rows[0] || { tickets_count: 0, total_cobrado: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalle por ID
router.get('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const result = await query(
    `SELECT * FROM "${schema}".pos_orders WHERE id = $1`,
    [id]
  );
  res.json(result.rows[0]);
});

// Actualizar venta
router.put('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const {
    subtotal, tax_rate, tax_amount, total, notes, mesa_numero
  } = req.body;
  await query(
    `UPDATE "${schema}".pos_orders
     SET subtotal=$1, tax_rate=$2, tax_amount=$3, total=$4, notes=$5, mesa_numero=$6, updated_at=NOW()
     WHERE id=$7`,
    [subtotal, tax_rate, tax_amount, total, notes, mesa_numero, id]
  );
  res.json({ success: true });
});

// Borrado lógico (cancelled)
router.delete('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  await query(
    `UPDATE "${schema}".pos_orders SET status='cancelled', updated_at=NOW() WHERE id=$1`,
    [id]
  );
  res.json({ success: true });
});

// Gráfico: ventas por día (solo pagadas)
router.get('/by-day', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT to_char(created_at, 'Dy') AS day, SUM(total)::float AS total
     FROM "${schema}".pos_orders
     WHERE status='paid'
     GROUP BY day
     ORDER BY MIN(created_at)`
  );
  res.json(result.rows);
});

export default router;