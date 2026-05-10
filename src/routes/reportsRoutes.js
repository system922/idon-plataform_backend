import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para verificar si hay facturación electrónica COMPLETAMENTE configurada
async function hasEinvoicing(schema) {
  try {
    const result = await query(
      `SELECT EXISTS (
        SELECT 1 
        FROM "${schema}".einvoice_config 
        WHERE id = 1 
          AND ruc IS NOT NULL 
          AND ruc != ''
          AND razon_social IS NOT NULL 
          AND razon_social != ''
          AND has_signature = true
      ) as is_configured`,
      []
    );
    
    return result.rows[0]?.is_configured || false;
  } catch (error) {
    // Si la tabla no existe, capturamos el error y retornamos false
    if (error.code === '42P01') { // undefined_table
      return false;
    }
    console.error('Error checking einvoicing config:', error);
    return false;
  }
}

/**
 * GET /api/customers
 * Lista todos los clientes del tenant
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

    const countResult = await query(
      `SELECT COUNT(*) as total FROM "${schema}".customers c ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    let ordersSubquery = '';
    let spentSubquery = '';
    
    if (useEinvoicing) {
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".einvoicing_invoices e 
         WHERE e.customer_id = c.id AND e.status = 'autorizada'),
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(e.total) FROM "${schema}".einvoicing_invoices e 
         WHERE e.customer_id = c.id AND e.status = 'autorizada'),
        0
      ) as total_spent`;
    } else {
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'),
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(o.total) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'),
        0
      ) as total_spent`;
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
 * Obtiene estadísticas de clientes
 */
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const useEinvoicing = await hasEinvoicing(schema);
    
    let customersWithOrdersSubquery = '';
    
    if (useEinvoicing) {
      customersWithOrdersSubquery = `(SELECT COUNT(DISTINCT customer_id) FROM "${schema}".einvoicing_invoices WHERE customer_id IS NOT NULL AND status = 'autorizada')`;
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
    const { document_number, document_type } = req.query;
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
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".einvoicing_invoices e 
         WHERE e.customer_id = c.id AND e.status = 'autorizada'),
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(e.total) FROM "${schema}".einvoicing_invoices e 
         WHERE e.customer_id = c.id AND e.status = 'autorizada'),
        0
      ) as total_spent`;
    } else {
      ordersSubquery = `COALESCE(
        (SELECT COUNT(*) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'),
        0
      ) as total_orders`;
      
      spentSubquery = `COALESCE(
        (SELECT SUM(o.total) FROM "${schema}".pos_orders o 
         WHERE o.customer_id = c.id AND o.status = 'paid'),
        0
      ) as total_spent`;
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

    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

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

    const existing = await query(
      `SELECT id FROM "${schema}".customers WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Cliente no encontrado' });
    }

    const useEinvoicing = await hasEinvoicing(schema);
    let hasTransactions = false;
    
    if (useEinvoicing) {
      const invoicesCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoicing_invoices WHERE customer_id = $1`,
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
      await query(`DELETE FROM "${schema}".customers WHERE id = $1`, [id]);
      res.json({ success: true, message: 'Cliente eliminado permanentemente' });
    } else {
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

/**
 * ========================================
 * REPORTE DE VENTAS
 * ========================================
 */

/**
 * GET /api/customers/sales-report
 * Reporte de ventas (usa facturación electrónica o POS según configuración)
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

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}` 
      : '';

    let tableName = '';
    let selectFields = '';
    
    if (useEinvoicing) {
      tableName = 'einvoicing_invoices';
      selectFields = `
        t.id,
        t.invoice_number as numero_factura,
        t.customer_id,
        c.name as cliente_nombre,
        c.document_number as cliente_cedula,
        t.created_at as fecha,
        t.subtotal,
        t.iva,
        t.total,
        t.status as estado
      `;
    } else {
      tableName = 'pos_orders';
      selectFields = `
        t.id,
        t.order_number as numero_factura,
        t.customer_id,
        c.name as cliente_nombre,
        c.document_number as cliente_cedula,
        t.created_at as fecha,
        t.subtotal,
        t.tax as iva,
        t.total,
        t.status as estado
      `;
    }

    // Contar total de registros
    const countResult = await query(
      `SELECT COUNT(*) as total 
       FROM "${schema}".${tableName} t
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);

    // Obtener datos paginados
    const result = await query(
      `SELECT 
         ${selectFields}
       FROM "${schema}".${tableName} t
       LEFT JOIN "${schema}".customers c ON t.customer_id = c.id
       ${whereClause}
       ORDER BY t.created_at DESC
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

    const tableName = useEinvoicing ? 'einvoicing_invoices' : 'pos_orders';
    const statusFilter = useEinvoicing ? "t.status = 'autorizada'" : "t.status = 'paid'";

    // Build conditions array including status filter
    whereConditions.push(statusFilter);
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;

    const result = await query(
      `SELECT 
         COUNT(*) as total_ventas,
         COALESCE(SUM(t.total), 0) as total_ingresos,
         COALESCE(SUM(t.subtotal), 0) as total_subtotal,
         COALESCE(SUM(t.${useEinvoicing ? 'iva' : 'tax'}), 0) as total_iva,
         COUNT(DISTINCT t.customer_id) as clientes_unicos
       FROM "${schema}".${tableName} t
       ${whereClause}`,
      params
    );

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

// ─── REPORTES DE PRODUCTOS ───────────────────────────────────────────────────

/**
 * GET /api/reports/products/categories
 * Obtiene todas las categorías de productos
 */
router.get('/products/categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT 
         id, 
         nombre as name, 
         descripcion as description,
         (SELECT COUNT(*) FROM "${schema}".productos WHERE categoria_id = c.id) as product_count
       FROM "${schema}".categorias c
       WHERE activo = true
       ORDER BY nombre ASC`,
      []
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error al obtener categorías:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/products-sold
 * Obtiene el reporte de productos vendidos
 * Query params: periodo (day, week, month, quarter, year), categoria (opcional), order_by (quantity, total, name), limit
 */
router.get('/products-sold', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { periodo = 'month', categoria = null, order_by = 'quantity', limit = 50 } = req.query;
    
    // Calcular fecha de inicio según el período
    let dateFilter = '';
    switch(periodo) {
      case 'day':
        dateFilter = `t.created_at >= DATE(NOW()) AND t.created_at < DATE(NOW()) + INTERVAL '1 day'`;
        break;
      case 'week':
        dateFilter = `t.created_at >= DATE(NOW() - INTERVAL '7 days')`;
        break;
      case 'month':
        dateFilter = `t.created_at >= DATE_TRUNC('month', NOW())`;
        break;
      case 'quarter':
        dateFilter = `t.created_at >= DATE_TRUNC('quarter', NOW())`;
        break;
      case 'year':
        dateFilter = `t.created_at >= DATE_TRUNC('year', NOW())`;
        break;
      default:
        dateFilter = `t.created_at >= DATE_TRUNC('month', NOW())`;
    }

    const useEinvoicing = await hasEinvoicing(schema);

    let tableName = useEinvoicing ? 'einvoicing_invoices' : 'pos_orders';
    let itemsTable = useEinvoicing ? 'einvoicing_items' : 'pos_order_items';
    let statusFilter = useEinvoicing ? `t.status = 'autorizada'` : `t.status = 'paid'`;
    
    let categoryFilter = '';
    let params = [];
    if (categoria) {
      categoryFilter = ` AND p.categoria_id = $1`;
      params.push(categoria);
    }

    let orderByClause = 'cantidad_vendida DESC';
    switch(order_by) {
      case 'total':
        orderByClause = 'total_vendido DESC';
        break;
      case 'name':
        orderByClause = 'nombre_producto ASC';
        break;
      case 'quantity':
      default:
        orderByClause = 'cantidad_vendida DESC';
    }

    const result = await query(
      `SELECT 
         p.id,
         p.codigo as sku,
         p.nombre as nombre_producto,
         COALESCE(SUM(oi.cantidad), 0) as cantidad_vendida,
         COALESCE(SUM(oi.cantidad * oi.precio_unitario), 0) as total_vendido,
         c.nombre as categoria,
         COUNT(DISTINCT t.id) as numero_transacciones
       FROM "${schema}".${itemsTable} oi
       JOIN "${schema}".${tableName} t ON oi.${useEinvoicing ? 'invoice_id' : 'order_id'} = t.id
       JOIN "${schema}".productos p ON oi.producto_id = p.id
       LEFT JOIN "${schema}".categorias c ON p.categoria_id = c.id
       WHERE ${dateFilter} 
         AND ${statusFilter}
         ${categoryFilter}
       GROUP BY p.id, p.codigo, p.nombre, c.nombre
       ORDER BY ${orderByClause}
       LIMIT $${params.length + 1}`,
      [...params, parseInt(limit) || 50]
    );

    res.json({
      success: true,
      data: result.rows,
      metadata: {
        invoiceSource: useEinvoicing ? 'einvoicing' : 'pos'
      }
    });
  } catch (err) {
    console.error('Error al generar reporte de productos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── REPORTE AVANZADO ────────────────────────────────────────────────────────

/**
 * GET /api/reports/advanced
 * Obtiene reporte avanzado con ventas y gastos por período
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), groupBy (day, month, week)
 */
router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { from = null, to = null, groupBy = 'day' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    let dateFormatGroup = '';
    let dateFormatLabel = '';
    
    switch(groupBy) {
      case 'week':
        dateFormatGroup = `DATE_TRUNC('week', t.created_at)`;
        dateFormatLabel = `DATE_TRUNC('week', t.created_at)`;
        break;
      case 'month':
        dateFormatGroup = `DATE_TRUNC('month', t.created_at)`;
        dateFormatLabel = `DATE_TRUNC('month', t.created_at)`;
        break;
      case 'day':
      default:
        dateFormatGroup = `DATE(t.created_at)`;
        dateFormatLabel = `DATE(t.created_at)`;
    }

    // Detectar qué tabla de órdenes/facturas tiene datos
    let salesResult = { rows: [] };
    let dataSource = 'unknown';
    
    try {
      // Intentar obtener datos de einvoicing primero (facturación electrónica)
      const einvoicingCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoicing_invoices 
         WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2 AND status = 'autorizada'`,
        [from, to]
      );
      
      if (einvoicingCheck.rows[0]?.count > 0) {
        dataSource = 'einvoicing';
        salesResult = await query(
          `SELECT 
             ${dateFormatLabel} as date,
             COALESCE(SUM(t.total), 0) as total_sales,
             COUNT(*) as numero_transacciones,
             COUNT(DISTINCT t.customer_id) as clientes_unicos
           FROM "${schema}".einvoicing_invoices t
           WHERE DATE(t.created_at) >= $1 
             AND DATE(t.created_at) <= $2
             AND t.status = 'autorizada'
           GROUP BY ${dateFormatGroup}
           ORDER BY date ASC`,
          [from, to]
        );
      } else {
        // Si no hay einvoicing, intentar con pos_orders
        const posCheck = await query(
          `SELECT COUNT(*) as count FROM "${schema}".pos_orders 
           WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2 AND status = 'paid'`,
          [from, to]
        );
        
        if (posCheck.rows[0]?.count > 0) {
          dataSource = 'pos';
          salesResult = await query(
            `SELECT 
               ${dateFormatLabel} as date,
               COALESCE(SUM(t.total), 0) as total_sales,
               COUNT(*) as numero_transacciones,
               COUNT(DISTINCT t.customer_id) as clientes_unicos
             FROM "${schema}".pos_orders t
             WHERE DATE(t.created_at) >= $1 
               AND DATE(t.created_at) <= $2
               AND t.status = 'paid'
             GROUP BY ${dateFormatGroup}
             ORDER BY date ASC`,
            [from, to]
          );
        }
      }
    } catch (err) {
      console.warn('Warning - Sales query failed:', err.message);
    }

    // Obtener gastos por período (con validación de tabla)
    let expensesResult = { rows: [] };
    try {
      const tableExists = await query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name IN ('gastos', 'expenses', 'expense_records')
         ) as exists`,
        [schema]
      );
      
      if (tableExists.rows[0]?.exists) {
        const expenseTable = await query(
          `SELECT table_name FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name IN ('gastos', 'expenses', 'expense_records')
           LIMIT 1`,
          [schema]
        );
        
        if (expenseTable.rows.length > 0) {
          const tableName = expenseTable.rows[0].table_name;
          const dateColumn = ['gastos'].includes(tableName) ? 'fecha' : 'created_at';
          const amountColumn = ['gastos'].includes(tableName) ? 'monto' : 'amount';
          
          expensesResult = await query(
            `SELECT 
               ${dateFormatLabel} as date,
               COALESCE(SUM(e.${amountColumn}), 0) as total_expenses
             FROM "${schema}".${tableName} e
             WHERE DATE(e.${dateColumn}) >= $1 
               AND DATE(e.${dateColumn}) <= $2
             GROUP BY ${dateFormatGroup}
             ORDER BY date ASC`,
            [from, to]
          );
        }
      }
    } catch (err) {
      console.warn('Warning - Expenses query failed:', err.message);
    }

    // Obtener cuentas por cobrar (deudas de clientes)
    let receivablesResult = { rows: [] };
    try {
      const tableExists = await query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name IN ('cuentas_por_cobrar', 'accounts_receivable', 'receivables')
         ) as exists`,
        [schema]
      );
      
      if (tableExists.rows[0]?.exists) {
        const receivableTable = await query(
          `SELECT table_name FROM information_schema.tables 
           WHERE table_schema = $1 AND table_name IN ('cuentas_por_cobrar', 'accounts_receivable', 'receivables')
           LIMIT 1`,
          [schema]
        );
        
        if (receivableTable.rows.length > 0) {
          const tableName = receivableTable.rows[0].table_name;
          const dateColumn = ['cuentas_por_cobrar'].includes(tableName) ? 'fecha_creacion' : 'created_at';
          const amountColumn = ['cuentas_por_cobrar'].includes(tableName) ? 'monto' : 'amount';
          const statusColumn = ['cuentas_por_cobrar'].includes(tableName) ? 'estado' : 'status';
          
          receivablesResult = await query(
            `SELECT 
               ${dateFormatLabel} as date,
               COALESCE(SUM(ar.${amountColumn}), 0) as total_receivable
             FROM "${schema}".${tableName} ar
             WHERE DATE(ar.${dateColumn}) >= $1 
               AND DATE(ar.${dateColumn}) <= $2
               AND ar.${statusColumn} = 'pendiente'
             GROUP BY ${dateFormatGroup}
             ORDER BY date ASC`,
            [from, to]
          );
        }
      }
    } catch (err) {
      console.warn('Warning - Receivables query failed:', err.message);
    }

    res.json({
      success: true,
      sales: salesResult.rows,
      expenses: expensesResult.rows,
      receivables: receivablesResult.rows,
      metadata: {
        invoiceSource: dataSource,
        dateRange: { from, to },
        groupBy
      }
    });
  } catch (err) {
    console.error('Error al generar reporte avanzado:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;