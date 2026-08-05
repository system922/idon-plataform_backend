// routes/employeesRoutes.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';

const router = express.Router();

// ── Validar cédula ecuatoriana ──────────────────────────────────────────
const validarCedula = (cedula) => {
  if (!cedula || cedula.length !== 10) return false;
  if (!/^\d{10}$/.test(cedula)) return false;
  
  const provincia = parseInt(cedula.substring(0, 2));
  if (provincia < 1 || provincia > 24) return false;
  
  const digitos = cedula.split('').map(Number);
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  
  for (let i = 0; i < 9; i++) {
    let valor = digitos[i] * coeficientes[i];
    if (valor > 9) valor -= 9;
    suma += valor;
  }
  
  const digitoVerificador = (10 - (suma % 10)) % 10;
  return digitoVerificador === digitos[9];
};

// ── Validar email ─────────────────────────────────────────────────────────
const validarEmail = (email) => {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/* ─── GET /api/employees ─────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { status } = req.query;
    let whereClause = '';
    let params = [];

    if (status) {
      whereClause = 'WHERE status = $1';
      params.push(status);
    }

    const q = `
      SELECT 
        id, user_id, full_name, email, phone, position, department, 
        document_number, salary, hired_at, status, created_at, updated_at,
        COALESCE(payment_type, 'hourly') as payment_type  -- ← NUEVO CAMPO
      FROM "${schema}".employees
      ${whereClause}
      ORDER BY created_at DESC
    `;
    const result = await query(q, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error in GET /:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/employees/check-exists ───────────────────────────────────── */
/* ⚠️  DEBE ir antes de /:id para que no sea interceptada como parámetro    */
router.get('/check-exists', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { document_number, email, exclude_id } = req.query;
    
    if (!document_number && !email) {
      return res.status(400).json({ error: 'document_number or email is required' });
    }

    let conditions = [];
    let params = [];
    let paramIndex = 1;

    if (document_number) {
      conditions.push(`document_number = $${paramIndex}`);
      params.push(document_number);
      paramIndex++;
    }

    if (email) {
      conditions.push(`email = $${paramIndex}`);
      params.push(email);
      paramIndex++;
    }

    if (exclude_id) {
      conditions.push(`id != $${paramIndex}`);
      params.push(exclude_id);
      paramIndex++;
    }

    const q = `
      SELECT id, full_name, document_number, email 
      FROM "${schema}".employees 
      WHERE ${conditions.join(' AND ')}
      LIMIT 1
    `;
    
    const result = await query(q, params);
    
    if (result.rows.length > 0) {
      res.json({ 
        exists: true, 
        id: result.rows[0].id,
        full_name: result.rows[0].full_name,
        document_number: result.rows[0].document_number,
        email: result.rows[0].email
      });
    } else {
      res.json({ exists: false });
    }
  } catch (err) {
    console.error('Error in check-exists:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/employees/by-document ────────────────────────────────────── */
/* ⚠️  DEBE ir antes de /:id para que no sea interceptada como parámetro    */
router.get('/by-document', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { document_number } = req.query;
    if (!document_number) {
      return res.status(400).json({ error: 'document_number is required' });
    }

    const q = `
      SELECT id, full_name, email, phone, position, department, document_number, salary, hired_at, status
      FROM "${schema}".employees 
      WHERE document_number = $1
      LIMIT 1
    `;
    
    const result = await query(q, [document_number]);
    
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(404).json({ error: 'Employee not found' });
    }
  } catch (err) {
    console.error('Error in by-document:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── GET /api/employees/:id ────────────────────────────────────────────── */
/* ⚠️  DEBE ir DESPUÉS de las rutas específicas                             */
router.get('/:id', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { id } = req.params;
    const q = `SELECT * FROM "${schema}".employees WHERE id = $1 LIMIT 1`;
    const result = await query(q, [id]);
    
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in GET /:id:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ─── POST /api/employees ────────────────────────────────────────────────── */
router.post('/', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const {
      user_id,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary,
      hired_at,
      status,
      payment_type  // ← NUEVO CAMPO
    } = req.body;

    // ── Validar campos obligatorios ──────────────────────────────────────
    if (!full_name || !full_name.trim()) {
      return res.status(400).json({ 
        error: 'El nombre completo es requerido',
        field: 'full_name'
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({ 
        error: 'El correo electrónico es requerido',
        field: 'email'
      });
    }

    if (!validarEmail(email)) {
      return res.status(400).json({ 
        error: 'Correo electrónico inválido',
        field: 'email'
      });
    }

    if (!position || !position.trim()) {
      return res.status(400).json({ 
        error: 'El cargo es requerido',
        field: 'position'
      });
    }

    // ── Validar cédula si se proporciona ──────────────────────────────────
    if (document_number) {
      if (document_number.length !== 10) {
        return res.status(400).json({ 
          error: 'La cédula debe tener 10 dígitos',
          field: 'document_number'
        });
      }
      if (!validarCedula(document_number)) {
        return res.status(400).json({ 
          error: 'Cédula inválida',
          field: 'document_number'
        });
      }
    }

    // ── Validar payment_type ──────────────────────────────────────────────
    const validPaymentTypes = ['hourly', 'daily'];
    const finalPaymentType = payment_type && validPaymentTypes.includes(payment_type) 
      ? payment_type 
      : 'hourly';

    // ── Verificar duplicados ──────────────────────────────────────────────
    if (document_number) {
      const checkDoc = await query(
        `SELECT id, full_name FROM "${schema}".employees WHERE document_number = $1`,
        [document_number]
      );
      if (checkDoc.rows.length > 0) {
        return res.status(400).json({ 
          error: `Ya existe un colaborador con la cédula ${document_number}`,
          field: 'document_number',
          code: 'DUPLICATE_DOCUMENT'
        });
      }
    }

    if (email) {
      const checkEmail = await query(
        `SELECT id, full_name FROM "${schema}".employees WHERE email = $1`,
        [email]
      );
      if (checkEmail.rows.length > 0) {
        return res.status(400).json({ 
          error: `Ya existe un colaborador con el correo ${email}`,
          field: 'email',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }

    // ── Insertar con el nuevo campo ──────────────────────────────────────
    const q = `
      INSERT INTO "${schema}".employees
        (user_id, full_name, email, phone, position, department, 
         document_number, salary, hired_at, status, payment_type)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'active'), $11)
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name.trim(),
      email.trim().toLowerCase(),
      phone || null,
      position.trim(),
      department || null,
      document_number || null,
      salary || 0,
      hired_at || null,
      status || 'active',
      finalPaymentType  // ← NUEVO PARÁMETRO
    ];
    
    const result = await query(q, params);
    res.status(201).json(result.rows[0]);
    
  } catch (err) {
    console.error('Error in POST /:', err);
    
    if (err.message && err.message.includes('duplicate key')) {
      if (err.message.includes('document_number')) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con esta cédula',
          field: 'document_number',
          code: 'DUPLICATE_DOCUMENT'
        });
      }
      if (err.message.includes('email')) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con este correo',
          field: 'email',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }
    
    res.status(500).json({ error: err.message });
  }
});

/* ─── PUT /api/employees/:id ────────────────────────────────────────────── */
router.put('/:id', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { id } = req.params;
    const {
      user_id,
      full_name,
      email,
      phone,
      position,
      department,
      document_number,
      salary,
      hired_at,
      status,
      payment_type  // ← NUEVO CAMPO
    } = req.body;

    // ── Validar email si se proporciona ──────────────────────────────────
    if (email && !validarEmail(email)) {
      return res.status(400).json({ 
        error: 'Correo electrónico inválido',
        field: 'email'
      });
    }

    // ── Validar cédula si se proporciona ──────────────────────────────────
    if (document_number) {
      if (document_number.length !== 10) {
        return res.status(400).json({ 
          error: 'La cédula debe tener 10 dígitos',
          field: 'document_number'
        });
      }
      if (!validarCedula(document_number)) {
        return res.status(400).json({ 
          error: 'Cédula inválida',
          field: 'document_number'
        });
      }
    }

    // ── Validar payment_type ──────────────────────────────────────────────
    const validPaymentTypes = ['hourly', 'daily'];
    let finalPaymentType = null;
    if (payment_type && validPaymentTypes.includes(payment_type)) {
      finalPaymentType = payment_type;
    }

    // ── Verificar duplicados excluyendo el registro actual ────────────────
    if (document_number) {
      const checkDoc = await query(
        `SELECT id, full_name FROM "${schema}".employees WHERE document_number = $1 AND id != $2`,
        [document_number, id]
      );
      if (checkDoc.rows.length > 0) {
        return res.status(400).json({ 
          error: `Ya existe otro colaborador con la cédula ${document_number}`,
          field: 'document_number',
          code: 'DUPLICATE_DOCUMENT'
        });
      }
    }

    if (email) {
      const checkEmail = await query(
        `SELECT id, full_name FROM "${schema}".employees WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (checkEmail.rows.length > 0) {
        return res.status(400).json({ 
          error: `Ya existe otro colaborador con el correo ${email}`,
          field: 'email',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }

    // ── Verificar que el empleado existe ──────────────────────────────────
    const checkExists = await query(
      `SELECT id FROM "${schema}".employees WHERE id = $1`,
      [id]
    );
    if (checkExists.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // ── Actualizar con el nuevo campo ─────────────────────────────────────
    const q = `
      UPDATE "${schema}".employees SET
        user_id = COALESCE($1, user_id),
        full_name = COALESCE($2, full_name),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        position = COALESCE($5, position),
        department = COALESCE($6, department),
        document_number = COALESCE($7, document_number),
        salary = COALESCE($8, salary),
        hired_at = COALESCE($9, hired_at),
        status = COALESCE($10, status),
        payment_type = COALESCE($11, payment_type, 'hourly'),  -- ← NUEVO CAMPO
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $12
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name?.trim() || null,
      email?.trim().toLowerCase() || null,
      phone || null,
      position?.trim() || null,
      department || null,
      document_number || null,
      salary || 0,
      hired_at || null,
      status || 'active',
      finalPaymentType || 'hourly',  // ← NUEVO PARÁMETRO
      id
    ];
    
    const result = await query(q, params);
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error in PUT /:id:', err);
    
    if (err.message && err.message.includes('duplicate key')) {
      if (err.message.includes('document_number')) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con esta cédula',
          field: 'document_number',
          code: 'DUPLICATE_DOCUMENT'
        });
      }
      if (err.message.includes('email')) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con este correo',
          field: 'email',
          code: 'DUPLICATE_EMAIL'
        });
      }
    }
    
    res.status(500).json({ error: err.message });
  }
});

/* ─── DELETE /api/employees/:id ─────────────────────────────────────────── */
router.delete('/:id', async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }
    
    const { id } = req.params;

    // ── Verificar que el empleado existe ──────────────────────────────────
    const checkQ = `SELECT id, full_name FROM "${schema}".employees WHERE id = $1`;
    const checkResult = await query(checkQ, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Colaborador no encontrado',
        code: 'NOT_FOUND'
      });
    }

    // ── Verificar si tiene relaciones ──────────────────────────────────────
    try {
      const tablesCheck = await query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'orders'
        ) as has_orders,
        EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_schema = $1 AND table_name = 'sales'
        ) as has_sales
      `, [schema]);
      
      const hasOrders = tablesCheck.rows[0]?.has_orders || false;
      const hasSales = tablesCheck.rows[0]?.has_sales || false;
      
      if (hasOrders) {
        const ordersQ = `SELECT id FROM "${schema}".orders WHERE employee_id = $1 LIMIT 1`;
        const ordersResult = await query(ordersQ, [id]);
        if (ordersResult.rows.length > 0) {
          return res.status(400).json({ 
            error: 'No se puede eliminar el colaborador porque tiene órdenes asociadas',
            code: 'HAS_RELATIONS'
          });
        }
      }
      
      if (hasSales) {
        const salesQ = `SELECT id FROM "${schema}".sales WHERE employee_id = $1 LIMIT 1`;
        const salesResult = await query(salesQ, [id]);
        if (salesResult.rows.length > 0) {
          return res.status(400).json({ 
            error: 'No se puede eliminar el colaborador porque tiene ventas asociadas',
            code: 'HAS_RELATIONS'
          });
        }
      }
    } catch (e) {
      console.log('Tablas relacionadas no encontradas, continuando con eliminación');
    }

    // ── Eliminar el empleado ──────────────────────────────────────────────
    const deleteQ = `DELETE FROM "${schema}".employees WHERE id = $1 RETURNING id, full_name`;
    const deleteResult = await query(deleteQ, [id]);
    
    res.status(200).json({ 
      message: 'Colaborador eliminado correctamente',
      deleted: deleteResult.rows[0]
    });
    
  } catch (err) {
    console.error('Error in DELETE /:id:', err);
    
    if (err.message && err.message.includes('foreign key')) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el colaborador porque tiene registros asociados',
        code: 'FOREIGN_KEY'
      });
    }
    
    res.status(500).json({ 
      error: 'Error al eliminar el colaborador',
      details: err.message,
      code: 'SERVER_ERROR'
    });
  }
});

export default router;