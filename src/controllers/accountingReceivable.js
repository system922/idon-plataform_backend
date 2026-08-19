import { query, getClient } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

// ─── Helper para asegurar la tabla ──────────────────────────────────────────
async function ensureReceivablesTable(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".accounts_receivable (
      id SERIAL PRIMARY KEY,
      order_number VARCHAR(50),
      customer_id UUID,
      customer_name VARCHAR(255),
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      paid_amount NUMERIC(10,2) DEFAULT 0,
      balance NUMERIC(10,2),
      issue_date DATE DEFAULT CURRENT_DATE,
      due_date DATE,
      status VARCHAR(20) DEFAULT 'pending',
      description TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Función auxiliar para registrar auditoría
async function logAudit(schema, userId, tableName, action, recordId, oldValues, description = null) {
  try {
    await query(`
      INSERT INTO "${schema}".audit_logs 
      (user_id, table_name, action, record_id, old_values, description, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [userId, tableName, action, recordId, oldValues, description || null]);
  } catch (err) {
    console.error('Error al registrar auditoría:', err);
    // No lanzamos error para no interrumpir la operación principal
  }
}

// Función para obtener el usuario actual
function getCurrentUserId(req) {
  // Primero intentar obtener desde el token/sesión
  const userId = req.user?.id || req.user?.userId || req.session?.userId;
  
  // Si no hay usuario en el request, intentar obtener de la tabla users pública
  // Esto es para el dueño del negocio (usuario público)
  if (!userId && req.user?.email) {
    // Buscar en la tabla users pública por email
    // Nota: Esto debería ejecutarse en una consulta separada
    return null; // Se resolverá en la función que llama
  }
  
  return userId;
}

export const createReceivableFromOrder = async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    await ensureReceivablesTable(schema);

    const {
      order_id,
      order_number,
      customer_id,
      customer_name,
      customer_document,
      customer_email,
      total_amount,      // Total de la orden
      paid_amount,       // Monto pagado (si es abono)
      payment_method,    // Método de pago del abono
      reference_number,  // Referencia del abono
      notes
    } = req.body;

    if (!order_id || !order_number || !total_amount || total_amount <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Datos incompletos: order_id, order_number y total_amount son requeridos' 
      });
    }

    // Validar que el cliente no sea CONSUMIDOR FINAL
    if (!customer_id && (!customer_name || customer_name.trim().toUpperCase() === 'CONSUMIDOR FINAL')) {
      return res.status(400).json({
        success: false,
        error: 'No se puede crear cuenta por cobrar para CONSUMIDOR FINAL. Ingrese datos reales del cliente.'
      });
    }

    await client.query('BEGIN');

    // Calcular el saldo restante
    const abono = parseFloat(paid_amount) || 0;
    const total = parseFloat(total_amount);
    const saldo = Math.max(0, total - abono);

    // Si el monto pagado es 0 o no existe → es crédito total
    // Si el monto pagado es mayor a 0 → es abono parcial

    // Crear la cuenta por cobrar
    const result = await client.query(`
      INSERT INTO "${schema}".accounts_receivable
      (order_number, order_id, customer_id, customer_name, customer_document, customer_email,
       amount, paid_amount, balance, issue_date, due_date, status, description, notes, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days', 
              $10, $11, $12, NOW(), NOW())
      RETURNING *
    `, [
      order_number,
      order_id,
      customer_id || null,
      customer_name || 'CLIENTE SIN NOMBRE',
      customer_document || null,
      customer_email || null,
      total,              // Monto TOTAL de la orden
      abono,              // Monto PAGADO (0 si es crédito total)
      saldo,              // Saldo restante
      saldo > 0 ? 'pending' : 'paid',  // Si saldo = 0, ya está pagado
      `Cuenta por cobrar - Orden #${order_number}`,
      notes || null
    ]);

    const receivable = result.rows[0];

    // Si hay un abono (paid_amount > 0), registrar el pago
    if (abono > 0 && payment_method) {
      await client.query(`
        INSERT INTO "${schema}".accounts_receivable_payments
        (receivable_id, payment_method, amount, reference_number, paid_at, notes)
        VALUES ($1, $2, $3, $4, NOW(), $5)
      `, [
        receivable.id,
        payment_method,
        abono,
        reference_number || null,
        `Abono inicial - Orden #${order_number}`
      ]);

      // También registrar el pago en pos_payments
      await client.query(`
        INSERT INTO "${schema}".pos_payments
        (order_id, payment_method, amount, reference_number, status, paid_at, notes)
        VALUES ($1, $2, $3, $4, 'completed', NOW(), $5)
      `, [
        order_id,
        payment_method,
        abono,
        reference_number || null,
        `Abono parcial - Cuenta por cobrar ID: ${receivable.id}`
      ]);
    }

    await client.query('COMMIT');

    // Respuesta con detalles
    const response = {
      success: true,
      data: {
        ...receivable,
        abono: abono,
        saldo: saldo,
        tipo: abono > 0 ? 'abono_parcial' : 'credito_total',
        mensaje: abono > 0 
          ? `Abono de $${abono.toFixed(2)} registrado. Saldo pendiente: $${saldo.toFixed(2)}`
          : `Cuenta por cobrar registrada por $${total.toFixed(2)}`
      }
    };

    res.status(201).json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al crear cuenta por cobrar desde orden:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};


// ─────────────────────────────────────────────────────────────
// RECEIVABLES (cuentas por cobrar) desde órdenes (legacy)
// ─────────────────────────────────────────────────────────────
export const getReceivableListLegacy = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(c.name ILIKE $${paramIndex} OR o.order_number ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status === 'pending') {
      whereConditions.push(`o.status = 'pending'`);
    } else if (status === 'paid') {
      whereConditions.push(`o.status = 'paid'`);
    } else if (status === 'overdue') {
      whereConditions.push(`o.status = 'pending' AND o.created_at < NOW() - INTERVAL '30 days'`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    const countResult = await query(`
      SELECT COUNT(*) as total 
      FROM "${schema}".pos_orders o
      LEFT JOIN "${schema}".customers c ON o.customer_id = c.id
      ${whereClause}
    `, params);
    const total = parseInt(countResult.rows[0].total);

    const result = await query(`
      SELECT 
        o.id,
        o.order_number,
        o.created_at as order_date,
        o.total as amount,
        o.status,
        o.notes,
        c.id as customer_id,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.document_number as customer_document,
        CASE 
          WHEN o.status = 'paid' THEN o.updated_at
          ELSE NULL
        END as paid_date,
        EXTRACT(DAY FROM (NOW() - o.created_at)) as days_overdue,
        CASE 
          WHEN o.status = 'pending' AND o.created_at < NOW() - INTERVAL '30 days' THEN 'overdue'
          WHEN o.status = 'pending' THEN 'pending'
          ELSE 'paid'
        END as receivable_status
      FROM "${schema}".pos_orders o
      LEFT JOIN "${schema}".customers c ON o.customer_id = c.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, [...params, parseInt(limit), offset]);

    const summary = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN o.status = 'pending' THEN o.total ELSE 0 END), 0) as total_pending,
        COALESCE(SUM(CASE WHEN o.status = 'pending' AND o.created_at < NOW() - INTERVAL '30 days' THEN o.total ELSE 0 END), 0) as total_overdue,
        COALESCE(SUM(CASE WHEN o.status = 'paid' THEN o.total ELSE 0 END), 0) as total_paid,
        COUNT(CASE WHEN o.status = 'pending' THEN 1 END) as pending_count,
        COUNT(CASE WHEN o.status = 'paid' THEN 1 END) as paid_count
      FROM "${schema}".pos_orders o
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
    console.error('Error al listar cuentas por cobrar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getReceivableDetailLegacy = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;

    const result = await query(`
      SELECT 
        o.id,
        o.order_number,
        o.created_at as order_date,
        o.subtotal,
        o.tax_amount,
        o.total as amount,
        o.status,
        o.notes,
        c.id as customer_id,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.document_number as customer_document,
        c.address as customer_address,
        (
          SELECT json_agg(json_build_object(
            'id', i.id,
            'product_name', p.name,
            'quantity', i.quantity,
            'unit_price', p.selling_price,
            'subtotal', p.selling_price * i.quantity
          ))
          FROM "${schema}".pos_order_items i
          LEFT JOIN "${schema}".products p ON i.product_id = p.id
          WHERE i.order_id = o.id
        ) as items,
        (
          SELECT json_agg(json_build_object(
            'id', p.id,
            'payment_method', p.payment_method,
            'amount', p.amount,
            'reference_number', p.reference_number,
            'paid_at', p.paid_at
          ))
          FROM "${schema}".pos_payments p
          WHERE p.order_id = o.id
        ) as payments
      FROM "${schema}".pos_orders o
      LEFT JOIN "${schema}".customers c ON o.customer_id = c.id
      WHERE o.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error al obtener detalle:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const registerPaymentLegacy = async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { payment_method, amount, reference_number } = req.body;

    if (!payment_method || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Monto y método de pago requeridos' });
    }

    await client.query('BEGIN');

    const orderResult = await client.query(`
      SELECT id, total, status FROM "${schema}".pos_orders WHERE id = $1
    `, [id]);

    if (orderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Orden no encontrada' });
    }

    const order = orderResult.rows[0];
    if (order.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Esta cuenta ya ha sido pagada' });
    }

    await client.query(`
      INSERT INTO "${schema}".pos_payments
        (order_id, payment_method, amount, reference_number, status, paid_at)
      VALUES ($1, $2, $3, $4, 'completed', NOW())
    `, [id, payment_method, amount, reference_number || null]);

    await client.query(`
      UPDATE "${schema}".pos_orders
      SET status = 'paid', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await client.query('COMMIT');

    res.json({ success: true, message: 'Pago registrado exitosamente' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al registrar pago:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// NUEVAS TABLAS (accounts_receivable) – usadas por el frontend
// ─────────────────────────────────────────────────────────────

export const listReceivables = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let where = [];
    let params = [];
    let idx = 1;

    if (search) {
      where.push(`(r.customer_name ILIKE $${idx} OR r.order_number ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    if (status === 'pending') where.push(`r.status = 'pending'`);
    else if (status === 'paid') where.push(`r.status = 'paid'`);
    else if (status === 'overdue') where.push(`r.status = 'pending' AND r.due_date < CURRENT_DATE`);

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(*) AS total FROM "${schema}".accounts_receivable r ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].total);

    const result = await query(`
      SELECT r.*, r.order_number AS invoice_number,
             c.email AS customer_email, c.phone AS customer_phone, c.document_number AS customer_document,
        CASE
          WHEN r.status = 'pending' AND r.due_date < CURRENT_DATE THEN 'overdue'
          WHEN r.status = 'pending' THEN 'pending'
          ELSE 'paid'
        END AS receivable_status,
        CASE WHEN r.due_date < CURRENT_DATE AND r.status = 'pending'
          THEN EXTRACT(DAY FROM NOW() - r.due_date)::int ELSE 0 END AS days_overdue
      FROM "${schema}".accounts_receivable r
      LEFT JOIN "${schema}".customers c ON c.id = r.customer_id
      ${whereClause}
      ORDER BY r.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `, [...params, parseInt(limit), offset]);

    const summary = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN status='pending' THEN balance ELSE 0 END),0) AS total_pending,
        COALESCE(SUM(CASE WHEN status='pending' AND due_date < CURRENT_DATE THEN balance ELSE 0 END),0) AS total_overdue,
        COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) AS total_paid,
        COUNT(CASE WHEN status='pending' THEN 1 END) AS pending_count,
        COUNT(CASE WHEN status='paid' THEN 1 END) AS paid_count
      FROM "${schema}".accounts_receivable
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
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const exportReceivablesCSV = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const result = await query(`
      SELECT r.order_number, r.customer_name, r.amount, r.paid_amount, r.balance,
             r.issue_date, r.due_date, r.status, r.description, r.notes, r.created_at,
             c.email AS customer_email, c.phone AS customer_phone
      FROM "${schema}".accounts_receivable r
      LEFT JOIN "${schema}".customers c ON c.id = r.customer_id
      ORDER BY r.created_at DESC
    `);

    const headers = ['N° Orden', 'Cliente', 'Email', 'Teléfono', 'Monto', 'Pagado', 'Saldo', 'Emisión', 'Vencimiento', 'Estado', 'Descripción', 'Notas'];
    const rows = result.rows.map(r => [
      r.order_number || '', r.customer_name || '', r.customer_email || '', r.customer_phone || '',
      r.amount, r.paid_amount, r.balance, r.issue_date, r.due_date, r.status, r.description || '', r.notes || ''
    ]);

    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cuentas-por-cobrar.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createReceivable = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const { customer_id, customer_name, amount, issue_date, due_date, description, notes, order_number, invoice_number } = req.body;
    const orderNum = order_number || invoice_number || null;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, error: 'Monto requerido' });

    let cName = customer_name;
    if (customer_id && !cName) {
      const cRes = await query(`SELECT name FROM "${schema}".customers WHERE id=$1`, [customer_id]);
      if (cRes.rows.length) cName = cRes.rows[0].name;
    }

    const result = await query(`
      INSERT INTO "${schema}".accounts_receivable
        (order_number, customer_id, customer_name, amount, paid_amount, balance, issue_date, due_date, status, description, notes)
      VALUES ($1,$2,$3,$4,0,$4,$5,$6,'pending',$7,$8)
      RETURNING *
    `, [orderNum, customer_id || null, cName || 'Sin cliente', amount, issue_date || new Date(), due_date || null, description || null, notes || null]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateReceivable = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const { id } = req.params;
    const { customer_id, customer_name, amount, issue_date, due_date, status, description, notes, order_number, invoice_number } = req.body;
    const orderNum = order_number || invoice_number || null;

    const result = await query(`
      UPDATE "${schema}".accounts_receivable
      SET customer_id=$1, customer_name=$2, amount=$3, issue_date=$4, due_date=$5, status=$6,
          description=$7, notes=$8, order_number=$9, updated_at=NOW()
      WHERE id=$10 RETURNING *
    `, [customer_id || null, customer_name || null, amount, issue_date, due_date, status || 'pending', description || null, notes || null, orderNum, id]);

    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteReceivable = async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const { id } = req.params;

    // Obtener el ID del usuario
    let userId = req.user?.id || req.user?.userId || req.session?.userId;
    
    // Si no hay userId en el request, buscar por email en la tabla pública
    if (!userId && req.user?.email) {
      const userRes = await query(
        `SELECT id FROM public.users WHERE email = $1 AND is_active = true`,
        [req.user.email]
      );
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      }
    }

    // Si aún no hay userId, intentar con el email del usuario autenticado
    if (!userId && req.user?.email) {
      // Buscar en el esquema del tenant
      const userRes = await query(
        `SELECT id FROM "${schema}".users WHERE email = $1 AND is_active = true`,
        [req.user.email]
      );
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      }
    }

    await client.query('BEGIN');

    // Obtener los valores antiguos antes de eliminar
    const oldRecord = await client.query(
      `SELECT * FROM "${schema}".accounts_receivable WHERE id = $1`,
      [id]
    );

    if (oldRecord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    // Eliminar la cuenta (incluye pagos por CASCADE)
    const result = await client.query(
      `DELETE FROM "${schema}".accounts_receivable WHERE id = $1 RETURNING id`,
      [id]
    );

    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    // Registrar auditoría
    const oldValues = oldRecord.rows[0];
    const auditDescription = `Cuenta por cobrar eliminada - Orden #${oldValues.order_number || 'N/A'} - Cliente: ${oldValues.customer_name || 'N/A'}`;
    
    await logAudit(
      schema,
      userId || null,
      'accounts_receivable',
      'DELETE',
      id.toString(),
      oldValues,
      auditDescription
    );

    await client.query('COMMIT');

    res.json({ 
      success: true, 
      message: 'Cuenta por cobrar eliminada',
      audit: {
        user_id: userId,
        description: auditDescription
      }
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error al eliminar cuenta por cobrar:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

export const addPaymentToReceivable = async (req, res) => {
  const client = await getClient();
  try {
    const schema = await getSchemaName(req);
    await ensureReceivablesTable(schema);
    const { id } = req.params;
    const { payment_method, amount, reference_number } = req.body;

    // Obtener userId (mismo método que en deleteReceivable)
    let userId = req.user?.id || req.user?.userId || req.session?.userId;
    if (!userId && req.user?.email) {
      const userRes = await query(
        `SELECT id FROM public.users WHERE email = $1 AND is_active = true`,
        [req.user.email]
      );
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      }
    }
    if (!userId && req.user?.email) {
      const userRes = await query(
        `SELECT id FROM "${schema}".users WHERE email = $1 AND is_active = true`,
        [req.user.email]
      );
      if (userRes.rows.length > 0) {
        userId = userRes.rows[0].id;
      }
    }

    if (!payment_method || !amount || amount <= 0) {
      return res.status(400).json({ success: false, error: 'Monto y método de pago requeridos' });
    }

    await client.query('BEGIN');
    const recRes = await client.query(`SELECT * FROM "${schema}".accounts_receivable WHERE id=$1`, [id]);
    if (!recRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada' });
    }

    const rec = recRes.rows[0];
    if (rec.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Esta cuenta ya está pagada' });
    }

    const oldPaidAmount = parseFloat(rec.paid_amount);
    const oldStatus = rec.status;
    const newPaid = oldPaidAmount + parseFloat(amount);
    const newBalance = parseFloat(rec.amount) - newPaid;
    const newStatus = newBalance <= 0 ? 'paid' : 'pending';

    await client.query(`
      UPDATE "${schema}".accounts_receivable
      SET paid_amount=$1, balance=$2, status=$3, updated_at=NOW()
      WHERE id=$4
    `, [newPaid, Math.max(0, newBalance), newStatus, id]);

    // Registrar auditoría del pago
    const auditDescription = `Pago registrado - Cuenta #${rec.order_number || id} - Monto: $${amount.toFixed(2)} - Método: ${payment_method}`;
    await logAudit(
      schema,
      userId || null,
      'accounts_receivable_payments',
      'INSERT',
      id.toString(),
      null,
      auditDescription
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Pago registrado exitosamente' });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// CUSTOMERS (para AccountingReceivablePage)
// ─────────────────────────────────────────────────────────────

export const listAccountingCustomers = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { limit = 200 } = req.query;
    const result = await query(`
      SELECT id, name, email, phone, document_type, document_number, address, is_active
      FROM "${schema}".customers
      WHERE is_active = true
      ORDER BY name
      LIMIT $1
    `, [parseInt(limit)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const createAccountingCustomer = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { name, email, phone, document_type, document_number, address } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'Nombre requerido' });

    const result = await query(`
      INSERT INTO "${schema}".customers (name, email, phone, document_type, document_number, address, is_active)
      VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING *
    `, [name, email || null, phone || null, document_type || null, document_number || null, address || null]);

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const updateAccountingCustomer = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { name, email, phone, document_type, document_number, address } = req.body;

    const result = await query(`
      UPDATE "${schema}".customers
      SET name=$1, email=$2, phone=$3, document_type=$4, document_number=$5, address=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [name, email || null, phone || null, document_type || null, document_number || null, address || null, id]);

    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const deleteAccountingCustomer = async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    await query(`UPDATE "${schema}".customers SET is_active=false WHERE id=$1`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
};