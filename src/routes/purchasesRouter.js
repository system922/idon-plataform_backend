import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Listar todas las compras
router.get('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const result = await query(
    `SELECT * FROM "${schema}".purchase_orders ORDER BY created_at DESC`
  );
  res.json(result.rows);
});

// Crear compra
router.post('/', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const {
    order_number, supplier_id, status='draft', subtotal, tax_amount, total,
    expected_at, received_at, notes
  } = req.body;
  const result = await query(
    `INSERT INTO "${schema}".purchase_orders
     (order_number, supplier_id, status, subtotal, tax_amount, total, expected_at, received_at, notes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     RETURNING *`,
    [order_number, supplier_id, status, subtotal, tax_amount, total, expected_at, received_at, notes]
  );
  res.json(result.rows[0]);
});

// Detalle por ID
router.get('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const result = await query(
    `SELECT * FROM "${schema}".purchase_orders WHERE id=$1`,
    [id]
  );
  res.json(result.rows[0]);
});

// Editar compra
router.put('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  const {
    status, subtotal, tax_amount, total, expected_at, received_at, notes
  } = req.body;
  await query(
    `UPDATE "${schema}".purchase_orders
     SET status=$1, subtotal=$2, tax_amount=$3, total=$4, expected_at=$5, received_at=$6, notes=$7, updated_at=NOW()
     WHERE id=$8`,
    [status, subtotal, tax_amount, total, expected_at, received_at, notes, id]
  );
  res.json({ success: true });
});

// Eliminar compra (físico, cambia a borrado lógico si prefieres)
router.delete('/:id', authMiddleware, async (req, res) => {
  const schema = await getSchemaName(req);
  const { id } = req.params;
  await query(
    `DELETE FROM "${schema}".purchase_orders WHERE id=$1`,
    [id]
  );
  res.json({ success: true });
});

// Gráfico: compras por día
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

export default router;