// routes/employees.js
import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

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

// ── Validar datos del empleado ──────────────────────────────────────────
const validateEmployeeData = (data, isUpdate = false) => {
  const errors = [];
  
  if (!isUpdate) {
    if (!data.full_name || !data.full_name.trim()) {
      errors.push({ field: 'full_name', message: 'full_name is required' });
    }
    if (!data.email || !data.email.trim()) {
      errors.push({ field: 'email', message: 'email is required' });
    } else if (!validarEmail(data.email)) {
      errors.push({ field: 'email', message: 'email is invalid' });
    }
    if (!data.position || !data.position.trim()) {
      errors.push({ field: 'position', message: 'position is required' });
    }
  } else {
    if (data.email !== undefined && !validarEmail(data.email)) {
      errors.push({ field: 'email', message: 'email is invalid' });
    }
  }
  
  return errors;
};

/**
 * GET /api/employees/check-exists
 * Check if employee exists by document_number or email
 */
router.get('/check-exists', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { document_number, email } = req.query;
    
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

    const q = `
      SELECT id, full_name, document_number, email 
      FROM "${schema}".employees 
      WHERE ${conditions.join(' OR ')}
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

/**
 * GET /api/employees/by-document
 * Get employee by document_number
 */
router.get('/by-document', authMiddleware, async (req, res) => {
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

/**
 * GET /api/employees
 * List all employees
 */
router.get('/', authMiddleware, async (req, res) => {
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
        document_number, salary, hired_at, status, created_at, updated_at
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

/**
 * GET /api/employees/:id
 * Get one employee by id
 */
router.get('/:id', authMiddleware, async (req, res) => {
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

/**
 * POST /api/employees
 * Create new employee
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    // ── Validar datos básicos ─────────────────────────────────────────────
    const validationErrors = validateEmployeeData(req.body);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
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
      status
    } = req.body;

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

    // ── Verificar duplicados ──────────────────────────────────────────────
    if (document_number) {
      const checkDoc = await query(
        `SELECT id FROM "${schema}".employees WHERE document_number = $1`,
        [document_number]
      );
      if (checkDoc.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con esta cédula',
          field: 'document_number'
        });
      }
    }

    if (email) {
      const checkEmail = await query(
        `SELECT id FROM "${schema}".employees WHERE email = $1`,
        [email]
      );
      if (checkEmail.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con este correo',
          field: 'email'
        });
      }
    }

    // ── Insertar ───────────────────────────────────────────────────────────
    const q = `
      INSERT INTO "${schema}".employees
        (user_id, full_name, email, phone, position, department, document_number, salary, hired_at, status)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, 'active'))
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name.trim(),
      email.trim(),
      phone || null,
      position.trim(),
      department || null,
      document_number || null,
      salary || 0,
      hired_at || null,
      status || 'active'
    ];
    
    const result = await query(q, params);
    res.status(201).json(result.rows[0]);
    
  } catch (err) {
    console.error('Error in POST /:', err);
    
    // ── Capturar errores de unique constraint ─────────────────────────────
    if (err.message && err.message.includes('duplicate key')) {
      if (err.message.includes('document_number')) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con esta cédula',
          field: 'document_number'
        });
      }
      if (err.message.includes('email')) {
        return res.status(400).json({ 
          error: 'Ya existe un colaborador con este correo',
          field: 'email'
        });
      }
    }
    
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/employees/:id
 * Update employee
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }
    
    // ── Validar datos ──────────────────────────────────────────────────────
    const validationErrors = validateEmployeeData(req.body, true);
    if (validationErrors.length > 0) {
      return res.status(400).json({ errors: validationErrors });
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
      status
    } = req.body;

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

    // ── Verificar duplicados excluyendo el registro actual ────────────────
    if (document_number) {
      const checkDoc = await query(
        `SELECT id FROM "${schema}".employees WHERE document_number = $1 AND id != $2`,
        [document_number, id]
      );
      if (checkDoc.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con esta cédula',
          field: 'document_number'
        });
      }
    }

    if (email) {
      const checkEmail = await query(
        `SELECT id FROM "${schema}".employees WHERE email = $1 AND id != $2`,
        [email, id]
      );
      if (checkEmail.rows.length > 0) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con este correo',
          field: 'email'
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

    // ── Actualizar ─────────────────────────────────────────────────────────
    const q = `
      UPDATE "${schema}".employees SET
        user_id = $1,
        full_name = $2,
        email = $3,
        phone = $4,
        position = $5,
        department = $6,
        document_number = $7,
        salary = $8,
        hired_at = $9,
        status = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `;
    const params = [
      user_id || null,
      full_name?.trim() || null,
      email?.trim() || null,
      phone || null,
      position?.trim() || null,
      department || null,
      document_number || null,
      salary || 0,
      hired_at || null,
      status || 'active',
      id
    ];
    
    const result = await query(q, params);
    res.json(result.rows[0]);
    
  } catch (err) {
    console.error('Error in PUT /:id:', err);
    
    // ── Capturar errores de unique constraint ─────────────────────────────
    if (err.message && err.message.includes('duplicate key')) {
      if (err.message.includes('document_number')) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con esta cédula',
          field: 'document_number'
        });
      }
      if (err.message.includes('email')) {
        return res.status(400).json({ 
          error: 'Ya existe otro colaborador con este correo',
          field: 'email'
        });
      }
    }
    
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/employees/:id
 * Delete an employee
 */
router.delete('/:id', authMiddleware, async (req, res) => {
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

    // ── Verificar si tiene relaciones (ej: ventas, pedidos, etc) ──────────
    // Si tienes una tabla de ventas que referencia a employees
    try {
      // Verificar si existe tabla de órdenes o ventas
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
      
      // Verificar órdenes si existe la tabla
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
      
      // Verificar ventas si existe la tabla
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
      // Si la tabla no existe, continuar con la eliminación
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
    
    // ── Manejar errores de foreign key ────────────────────────────────────
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