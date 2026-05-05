import express from 'express';
import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/accounting/payable
 * Lista todas las cuentas por pagar
 */
router.get('/payable', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, search = '', status = 'all', type = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(p.name ILIKE $${paramIndex} OR p.invoice_number ILIKE $${paramIndex} OR p.supplier_name ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status === 'pending') {
      whereConditions.push(`p.status = 'pending'`);
    } else if (status === 'paid') {
      whereConditions.push(`p.status = 'paid'`);
    } else if (status === 'overdue') {
      whereConditions.push(`p.status = 'pending' AND p.due_date < NOW()`);
    }

    if (type !== 'all') {
      whereConditions.push(`p.type = $${paramIndex}`);
      params.push(type);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total de registros
    const countResult = await query(`
      SELECT COUNT(*) as total 
      FROM "${schema}".accounts_payable p
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0].total);

    // Obtener cuentas por pagar
    const result = await query(`
      SELECT 
        p.id,
        p.invoice_number,
        p.supplier_name,
        p.supplier_id,
        p.amount,
        p.paid_amount,
        p.balance,
        p.issue_date,
        p.due_date,
        p.paid_date,
        p.status,
        p.type,
        p.description,
        p.category,
        p.notes,
        p.created_at,
        p.updated_at,
        CASE 
          WHEN p.status = 'pending' AND p.due_date < NOW() THEN 
            EXTRACT(DAY FROM (NOW() - p.due_date))::int
          ELSE 0
        END as days_overdue,
        CASE 
          WHEN p.status = 'pending' AND p.due_date < NOW() THEN 'overdue'
          WHEN p.status = 'pending' THEN 'pending'
          ELSE 'paid'
        END as payable_status
      FROM "${schema}".accounts_payable p
      ${whereClause}
      ORDER BY 
        CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
        p.due_date ASC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit), offset]);

    // Calcular resumen
    const summary = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN p.balance ELSE 0 END), 0) as total_pending,
        COALESCE(SUM(CASE WHEN p.status = 'pending' AND p.due_date < NOW() THEN p.balance ELSE 0 END), 0) as total_overdue,
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) as total_paid,
        COUNT(CASE WHEN p.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN p.status = 'paid' THEN 1 END) as paid_count,
        COUNT(CASE WHEN p.status = 'pending' AND p.due_date < NOW() THEN 1 END) as overdue_count
      FROM "${schema}".accounts_payable p
    `);

    res.json({
      success: true,
      data: result.rows,
      summary: summary.rows[0],
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (err) {
    console.error('Error al listar cuentas por pagar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/accounting/payable/:id
 * Obtiene detalle de una cuenta por pagar específica
 */
router.get('/payable/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    const result = await query(`
      SELECT 
        p.*,
        (
          SELECT json_agg(json_build_object(
            'id', pp.id,
            'payment_date', pp.payment_date,
            'amount', pp.amount,
            'payment_method', pp.payment_method,
            'reference_number', pp.reference_number
          ) ORDER BY pp.payment_date DESC
        ) as payments
      FROM "${schema}".accounts_payable p
      LEFT JOIN "${schema}".accounts_payable_payments pp ON pp.payable_id = p.id
      WHERE p.id = $1
      GROUP BY p.id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error al obtener detalle:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/accounting/payable
 * Crea una nueva cuenta por pagar
 */
router.post('/payable', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      invoice_number,
      supplier_name,
      supplier_id,
      amount,
      issue_date,
      due_date,
      type,
      description,
      category,
      notes
    } = req.body;

    if (!supplier_name || !amount || !due_date) {
      return res.status(400).json({ success: false, error: 'Proveedor, monto y fecha de vencimiento son requeridos' });
    }

    await client.query('BEGIN');

    const result = await client.query(`
      INSERT INTO "${schema}".accounts_payable
        (invoice_number, supplier_name, supplier_id, amount, paid_amount, balance,
         issue_date, due_date, status, type, description, category, notes, created_at)
      VALUES ($1, $2, $3, $4, 0, $4, $5, $6, 'pending', $7, $8, $9, $10, NOW())
      RETURNING *
    `, [invoice_number || null, supplier_name, supplier_id || null, amount, issue_date || new Date(), due_date, type || 'purchase', description || null, category || null, notes || null]);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Cuenta por pagar creada exitosamente'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear cuenta:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * POST /api/accounting/payable/:id/register-payment
 * Registra un pago para una cuenta por pagar
 */
router.post('/payable/:id/register-payment', authMiddleware, async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { payment_method, amount, reference_number, payment_date } = req.body;

    if (!payment_method || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Monto y método de pago requeridos' });
    }

    await client.query('BEGIN');

    // Verificar la cuenta
    const payableResult = await client.query(`
      SELECT id, balance, status FROM "${schema}".accounts_payable WHERE id = $1
    `, [id]);

    if (payableResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    const payable = payableResult.rows[0];

    if (payable.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Esta cuenta ya ha sido pagada' });
    }

    if (amount > payable.balance) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'El monto excede el saldo pendiente' });
    }

    // Registrar el pago
    await client.query(`
      INSERT INTO "${schema}".accounts_payable_payments
        (payable_id, payment_date, amount, payment_method, reference_number)
      VALUES ($1, $2, $3, $4, $5)
    `, [id, payment_date || new Date(), amount, payment_method, reference_number || null]);

    // Actualizar la cuenta
    const newPaidAmount = payable.balance - amount;
    const newStatus = newPaidAmount === 0 ? 'paid' : 'pending';
    const paidDate = newPaidAmount === 0 ? new Date() : null;

    await client.query(`
      UPDATE "${schema}".accounts_payable
      SET paid_amount = paid_amount + $1,
          balance = balance - $1,
          status = $2,
          paid_date = COALESCE($3, paid_date),
          updated_at = NOW()
      WHERE id = $4
    `, [amount, newStatus, paidDate, id]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Pago registrado exitosamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al registrar pago:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

/**
 * DELETE /api/accounting/payable/:id
 * Elimina una cuenta por pagar
 */
router.delete('/payable/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    const result = await query(`
      DELETE FROM "${schema}".accounts_payable WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    res.json({ success: true, message: 'Cuenta eliminada exitosamente' });
  } catch (err) {
    console.error('Error al eliminar cuenta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/accounting/payable/suppliers
 * Lista proveedores para autocompletar
 */
router.get('/payable/suppliers', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(`
      SELECT DISTINCT supplier_name, supplier_id
      FROM "${schema}".accounts_payable
      WHERE supplier_name IS NOT NULL
      ORDER BY supplier_name ASC
      LIMIT 50
    `);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error al listar proveedores:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;