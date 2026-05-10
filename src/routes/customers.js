import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para verificar si hay facturación electrónica COMPLETAMENTE configurada
async function hasEinvoicing(schema) {
  try {
    // Verificar si la tabla existe
    const tableCheck = await query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'einvoice_config'
      )`,
      [schema]
    );
    
    if (!tableCheck.rows[0].exists) {
      console.log(`[hasEinvoicing] Tabla einvoice_config no existe en schema ${schema}`);
      return false;
    }
    
    // Verificar configuración válida
    const result = await query(
      `SELECT EXISTS (
        SELECT 1 
        FROM "${schema}".einvoice_config 
        WHERE id = 1 
          AND ruc IS NOT NULL 
          AND ruc != ''
          AND razon_social IS NOT NULL 
          AND razon_social != ''
          AND p12_path IS NOT NULL 
          AND p12_path != ''
      ) as is_configured`,
      []
    );
    
    const isConfigured = result.rows[0]?.is_configured || false;
    console.log(`[hasEinvoicing] Schema ${schema} - Facturación Electrónica configurada: ${isConfigured}`);
    
    return isConfigured;
  } catch (error) {
    if (error.code === '42P01') {
      console.log(`[hasEinvoicing] Tabla einvoice_config no existe`);
      return false;
    }
    console.error('Error checking einvoicing config:', error);
    return false;
  }
}

/**
 * ========================================
 * REPORTE DE VENTAS - DEBEN IR ANTES DE /:id
 * ========================================
 */

/**
 * GET /api/customers/sales-report
 * Reporte de ventas con paginación
 */
router.get('/sales-report', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { 
      startDate, 
      endDate, 
      clientId,
      page = 1,
      limit = 20
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const useEinvoicing = await hasEinvoicing(schema);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    // Filtros de fecha
    if (startDate) {
      whereConditions.push(`DATE(t.created_at) >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`DATE(t.created_at) <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    }

    // Filtro por cliente
    if (clientId) {
      whereConditions.push(`t.customer_id = $${paramIndex}`);
      params.push(clientId);
      paramIndex++;
    }

    // Filtro de estado según el tipo de facturación
    if (useEinvoicing) {
      whereConditions.push(`t.status = 'autorizada'`);
    } else {
      whereConditions.push(`t.status = 'paid'`);
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    let tableName = '';
    let selectFields = '';
    
    if (useEinvoicing) {
      // Facturación Electrónica - Tabla: einvoices
      tableName = 'einvoices';
      selectFields = `
        t.id,
        t.invoice_number as numero_factura,
        t.customer_id,
        c.name as cliente_nombre,
        c.document_number as cliente_cedula,
        t.created_at as fecha,
        t.subtotal,
        t.iva_amount as iva,
        t.total,
        t.status as estado
      `;
    } else {
      // POS - Tabla: pos_orders
      tableName = 'pos_orders';
      selectFields = `
        t.id,
        t.order_number as numero_factura,
        t.customer_id,
        COALESCE(c.name, t.customer_name, 'CONSUMIDOR FINAL') as cliente_nombre,
        c.document_number as cliente_cedula,
        t.created_at as fecha,
        t.subtotal,
        t.tax_amount as iva,
        t.total,
        t.status as estado
      `;
    }

    // Contar total de registros
    const countQuery = `
      SELECT COUNT(*) as total 
      FROM "${schema}".${tableName} t
      ${whereClause}
    `;
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Obtener datos paginados
    const dataQuery = `
      SELECT 
        ${selectFields}
      FROM "${schema}".${tableName} t
      LEFT JOIN "${schema}".customers c ON t.customer_id = c.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const result = await query(dataQuery, [...params, parseInt(limit), offset]);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos',
        einvoicingConfigured: useEinvoicing
      }
    });
  } catch (err) {
    console.error('Error al generar reporte de ventas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/customers/sales-report/summary
 * Resumen de ventas por período
 */
router.get('/sales-report/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { startDate, endDate, clientId } = req.query;
    const useEinvoicing = await hasEinvoicing(schema);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereConditions.push(`DATE(t.created_at) >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereConditions.push(`DATE(t.created_at) <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    }

    if (clientId) {
      whereConditions.push(`t.customer_id = $${paramIndex}`);
      params.push(clientId);
      paramIndex++;
    }

    const tableName = useEinvoicing ? 'einvoices' : 'pos_orders';
    const statusFilter = useEinvoicing ? "t.status = 'autorizada'" : "t.status = 'paid'";

    whereConditions.push(statusFilter);
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    // Columna de impuesto según el tipo
    const taxColumn = useEinvoicing ? 't.iva_amount' : 'COALESCE(t.tax_amount, 0)';

    const queryText = `
      SELECT 
        COUNT(*) as total_ventas,
        COALESCE(SUM(t.total), 0) as total_ingresos,
        COALESCE(SUM(t.subtotal), 0) as total_subtotal,
        COALESCE(SUM(${taxColumn}), 0) as total_iva,
        COUNT(DISTINCT t.customer_id) as clientes_unicos
      FROM "${schema}".${tableName} t
      ${whereClause}
    `;

    const result = await query(queryText, params);

    res.json({
      success: true,
      data: result.rows[0],
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos'
      }
    });
  } catch (err) {
    console.error('Error al generar resumen de ventas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ========================================
 * RUTAS DE CLIENTES - ESPECÍFICAS
 * ========================================
 */

/**
 * GET /api/customers
 * Lista todos los clientes del tenant con paginación
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { page = 1, limit = 20, search = '', status = 'all' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const useEinvoicing = await hasEinvoicing(schema);

    let whereConditions = [];
    let params = [];
    let paramIndex = 1;

    if (search) {
      whereConditions.push(`(c.name ILIKE $${paramIndex} OR c.email ILIKE $${paramIndex} OR c.document_number ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (status === 'active') {
      whereConditions.push(`c.is_active = true`);
    } else if (status === 'inactive') {
      whereConditions.push(`c.is_active = false`);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Total de registros
    const countResult = await query(
      `SELECT COUNT(*) as total FROM "${schema}".customers c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Subconsultas según el tipo de facturación
    let ordersSubquery = '';
    let spentSubquery = '';
    
    if (useEinvoicing) {
      ordersSubquery = `COALESCE((SELECT COUNT(*) FROM "${schema}".einvoices e WHERE e.customer_id = c.id AND e.status = 'autorizada'), 0) as total_orders`;
      spentSubquery = `COALESCE((SELECT SUM(e.total) FROM "${schema}".einvoices e WHERE e.customer_id = c.id AND e.status = 'autorizada'), 0) as total_spent`;
    } else {
      ordersSubquery = `COALESCE((SELECT COUNT(*) FROM "${schema}".pos_orders o WHERE o.customer_id = c.id AND o.status = 'paid'), 0) as total_orders`;
      spentSubquery = `COALESCE((SELECT SUM(o.total) FROM "${schema}".pos_orders o WHERE o.customer_id = c.id AND o.status = 'paid'), 0) as total_spent`;
    }

    const result = await query(
      `SELECT 
         c.id, c.name, c.email, c.phone, c.document_type, c.document_number,
         c.address, c.notes, c.is_active, c.created_at, c.updated_at,
         ${ordersSubquery},
         ${spentSubquery}
       FROM "${schema}".customers c
       ${whereClause}
       ORDER BY c.name ASC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos',
        einvoicingConfigured: useEinvoicing
      }
    });
  } catch (err) {
    console.error('Error al listar clientes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/customers/stats
 * Estadísticas de clientes
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const useEinvoicing = await hasEinvoicing(schema);
    
    let customersWithOrdersSubquery = '';
    
    if (useEinvoicing) {
      customersWithOrdersSubquery = `(SELECT COUNT(DISTINCT customer_id) FROM "${schema}".einvoices WHERE customer_id IS NOT NULL AND status = 'autorizada')`;
    } else {
      customersWithOrdersSubquery = `(SELECT COUNT(DISTINCT customer_id) FROM "${schema}".pos_orders WHERE customer_id IS NOT NULL AND status = 'paid')`;
    }

    const result = await query(
      `SELECT
         COUNT(*) as total_customers,
         COUNT(CASE WHEN is_active = true THEN 1 END) as active_customers,
         COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_customers,
         COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as new_last_30_days,
         ${customersWithOrdersSubquery} as customers_with_orders
       FROM "${schema}".customers`
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al obtener estadísticas:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/by-document
 * Busca cliente por número de documento
 */
router.get('/by-document', authMiddleware, async (req, res) => {
  try {
    const { document_number } = req.query;
    if (!document_number) return res.status(400).json({ error: 'document_number requerido' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, email, phone, document_number, document_type, address, notes
       FROM "${schema}".customers
       WHERE document_number = $1
       LIMIT 1`,
      [document_number]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error al buscar por documento:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/cedula
 * Busca cliente por cédula (endpoint específico para facturación)
 */
router.get('/cedula', authMiddleware, async (req, res) => {
  try {
    const { cedula } = req.query;
    if (!cedula) return res.status(400).json({ error: 'cedula es requerida' });

    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const cleanCedula = cedula.trim();
    const result = await query(
      `SELECT id, name, email, phone, document_number
       FROM "${schema}".customers
       WHERE TRIM(document_number) = $1`,
      [cleanCedula]
    );

    if (result.rows.length === 0) return res.json([]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al buscar por cédula:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * ========================================
 * RUTA DINÁMICA - DEBE IR AL FINAL
 * ========================================
 */

/**
 * GET /api/customers/:id
 * Obtiene un cliente específico con su consumo
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const useEinvoicing = await hasEinvoicing(schema);
    
    let ordersSubquery = '';
    let spentSubquery = '';
    
    if (useEinvoicing) {
      ordersSubquery = `COALESCE((SELECT COUNT(*) FROM "${schema}".einvoices e WHERE e.customer_id = c.id AND e.status = 'autorizada'), 0) as total_orders`;
      spentSubquery = `COALESCE((SELECT SUM(e.total) FROM "${schema}".einvoices e WHERE e.customer_id = c.id AND e.status = 'autorizada'), 0) as total_spent`;
    } else {
      ordersSubquery = `COALESCE((SELECT COUNT(*) FROM "${schema}".pos_orders o WHERE o.customer_id = c.id AND o.status = 'paid'), 0) as total_orders`;
      spentSubquery = `COALESCE((SELECT SUM(o.total) FROM "${schema}".pos_orders o WHERE o.customer_id = c.id AND o.status = 'paid'), 0) as total_spent`;
    }

    const result = await query(
      `SELECT 
         c.id, c.name, c.email, c.phone, c.document_type, c.document_number,
         c.address, c.notes, c.is_active, c.created_at, c.updated_at,
         ${ordersSubquery},
         ${spentSubquery}
       FROM "${schema}".customers c
       WHERE c.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    res.json({ 
      success: true, 
      data: result.rows[0],
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos'
      }
    });
  } catch (err) {
    console.error('Error al obtener cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/customers
 * Crea un nuevo cliente
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { nombre, cedula, email, phone, tipo_documento, address, notes } = req.body;

    if (!nombre || !cedula) {
      return res.status(400).json({ success: false, error: 'Nombre y cédula son requeridos' });
    }

    // Verificar si ya existe
    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE document_number = $1`,
      [cedula]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Ya existe un cliente con este número de documento' });
    }

    const document_type = tipo_documento || (cedula.length === 13 ? 'ruc' : 'cedula');

    const result = await query(
      `INSERT INTO "${schema}".customers
         (name, email, phone, document_number, document_type, address, notes, is_active, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
       RETURNING id, name, email, phone, document_number, document_type, address, notes, is_active`,
      [nombre, email || null, phone || null, cedula, document_type, address || null, notes || null]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Cliente creado exitosamente'
    });
  } catch (err) {
    console.error('Error al crear cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PUT /api/customers/:id
 * Actualiza un cliente existente
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { nombre, cedula, email, phone, tipo_documento, address, notes, is_active } = req.body;

    // Verificar si el cliente existe
    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    // Si está cambiando el documento, verificar que no exista otro con el mismo
    if (cedula) {
      const duplicate = await query(
        `SELECT id FROM "${schema}".customers WHERE document_number = $1 AND id != $2`,
        [cedula, id]
      );
      if (duplicate.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Ya existe otro cliente con este número de documento' });
      }
    }

    const document_type = tipo_documento || (cedula?.length === 13 ? 'ruc' : 'cedula');

    const result = await query(
      `UPDATE "${schema}".customers
       SET name = COALESCE($1, name),
           email = $2,
           phone = $3,
           document_number = COALESCE($4, document_number),
           document_type = COALESCE($5, document_type),
           address = $6,
           notes = $7,
           is_active = COALESCE($8, is_active),
           updated_at = NOW()
       WHERE id = $9
       RETURNING id, name, email, phone, document_number, document_type, address, notes, is_active`,
      [nombre, email || null, phone || null, cedula, document_type, address || null, notes || null, is_active, id]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Cliente actualizado exitosamente'
    });
  } catch (err) {
    console.error('Error al actualizar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/customers/:id
 * Elimina o desactiva un cliente
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { permanent = false } = req.query;

    // Verificar si el cliente existe
    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    // Verificar si tiene transacciones
    const useEinvoicing = await hasEinvoicing(schema);
    let hasTransactions = false;
    
    if (useEinvoicing) {
      const invoicesCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoices WHERE customer_id = $1`,
        [id]
      );
      hasTransactions = parseInt(invoicesCheck.rows[0].count) > 0;
    } else {
      const ordersCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".pos_orders WHERE customer_id = $1`,
        [id]
      );
      hasTransactions = parseInt(ordersCheck.rows[0].count) > 0;
    }

    if (permanent === 'true' && !hasTransactions) {
      // Eliminación física (solo si no tiene transacciones)
      await query(`DELETE FROM "${schema}".customers WHERE id = $1`, [id]);
      res.json({ success: true, message: 'Cliente eliminado permanentemente' });
    } else {
      // Soft delete: solo desactivar
      await query(
        `UPDATE "${schema}".customers SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [id]
      );
      res.json({ success: true, message: 'Cliente desactivado exitosamente' });
    }
  } catch (err) {
    console.error('Error al eliminar cliente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;