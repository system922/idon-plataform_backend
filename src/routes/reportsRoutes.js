import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * ============================================
 * FUNCIONES AUXILIARES
 * ============================================
 */

// Detectar fuente de datos priorizando einvoices (facturas electrónicas)
async function getDataSource(schema) {
  try {
    // Verificar einvoices con orden relacionada
    const einvoicesCheck = await query(
      `SELECT COUNT(*) as count 
       FROM "${schema}".einvoices e
       INNER JOIN "${schema}".pos_orders o ON e.order_id = o.id
       WHERE e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`
    );
    
    if (parseInt(einvoicesCheck.rows[0]?.count) > 0) {
      return { source: 'einvoicing' };
    }
    
    // Verificar pos_orders pagadas
    const posCheck = await query(
      `SELECT COUNT(*) as count 
       FROM "${schema}".pos_orders 
       WHERE status = 'paid'`
    );
    
    if (parseInt(posCheck.rows[0]?.count) > 0) {
      return { source: 'pos' };
    }
    
    return { source: 'none' };
  } catch (err) {
    console.error('[DataSource] Error:', err.message);
    return { source: 'none' };
  }
}

// Construir filtro de fechas para consultas SQL
function buildDateFilter(periodo, startDate, endDate, tableAlias = 'o') {
  let dateFilter = '';
  let queryParams = [];
  
  if (startDate && endDate) {
    dateFilter = `DATE(${tableAlias}.created_at) >= $1::DATE AND DATE(${tableAlias}.created_at) <= $2::DATE`;
    queryParams = [startDate, endDate];
  } else {
    switch(periodo) {
      case 'day':
        dateFilter = `${tableAlias}.created_at >= CURRENT_DATE AND ${tableAlias}.created_at < CURRENT_DATE + INTERVAL '1 day'`;
        break;
      case 'week':
        dateFilter = `${tableAlias}.created_at >= CURRENT_DATE - INTERVAL '7 days'`;
        break;
      case 'month':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
        break;
      case 'quarter':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
        break;
      case 'year':
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
        break;
      default:
        dateFilter = `${tableAlias}.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
    }
  }
  
  return { dateFilter, queryParams };
}

// Obtener totales consistentes desde einvoices
async function getEinvoicesTotals(schema, dateFilter, queryParams) {
  let params = queryParams.length > 0 ? [...queryParams] : [];
  
  const sql = queryParams.length > 0
    ? `
      SELECT 
        COUNT(DISTINCT e.id) as total_facturas,
        COALESCE(SUM(e.total), 0) as total_ingresos,
        COALESCE(SUM(e.subtotal), 0) as total_subtotal,
        COALESCE(SUM(e.iva_amount), 0) as total_iva,
        COUNT(DISTINCT e.customer_ruc) as clientes_unicos
      FROM "${schema}".einvoices e
      INNER JOIN "${schema}".pos_orders o ON e.order_id = o.id
      WHERE ${dateFilter.replace(/o\./g, 'e.')}
        AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
    `
    : `
      SELECT 
        COUNT(DISTINCT e.id) as total_facturas,
        COALESCE(SUM(e.total), 0) as total_ingresos,
        COALESCE(SUM(e.subtotal), 0) as total_subtotal,
        COALESCE(SUM(e.iva_amount), 0) as total_iva,
        COUNT(DISTINCT e.customer_ruc) as clientes_unicos
      FROM "${schema}".einvoices e
      INNER JOIN "${schema}".pos_orders o ON e.order_id = o.id
      WHERE ${dateFilter.replace(/o\./g, 'e.')}
        AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
    `;
  
  return await query(sql, params);
}

/**
 * ============================================
 * 1. REPORTE DE VENTAS
 * ============================================
 */

/**
 * GET /api/reports/sales
 * Listado de facturas/ventas con paginación
 */
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, startDate = null, endDate = null, periodo = 'month' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const dataSource = await getDataSource(schema);
    
    if (dataSource.source === 'none') {
      return res.json({
        success: true,
        data: [],
        pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 },
        metadata: { invoiceSource: 'none' }
      });
    }
    
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereClause = '';
    let countQuery = '';
    let selectQuery = '';
    
    if (dataSource.source === 'einvoicing') {
      // Ventas desde facturas electrónicas con su orden relacionada
      const dateFilterEinvoice = dateFilter.replace(/o\./g, 'e.');
      
      whereClause = `WHERE ${dateFilterEinvoice} AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`;
      
      countQuery = `
        SELECT COUNT(*) as total 
        FROM "${schema}".einvoices e
        ${whereClause}
      `;
      
      selectQuery = `
        SELECT 
          e.id,
          e.invoice_number as numero_factura,
          e.order_id,
          o.order_number,
          e.customer_name as cliente_nombre,
          e.customer_ruc as cliente_cedula,
          e.created_at as fecha,
          e.subtotal,
          e.iva_amount as iva,
          e.total,
          e.status as estado
        FROM "${schema}".einvoices e
        INNER JOIN "${schema}".pos_orders o ON e.order_id = o.id
        ${whereClause}
        ORDER BY e.created_at DESC
      `;
    } else {
      // Ventas desde POS (órdenes pagadas sin factura electrónica)
      whereClause = `WHERE ${dateFilter} AND o.status = 'paid'`;
      
      countQuery = `
        SELECT COUNT(*) as total 
        FROM "${schema}".pos_orders o
        ${whereClause}
      `;
      
      selectQuery = `
        SELECT 
          o.id,
          o.order_number as numero_factura,
          COALESCE(c.name, o.customer_name, 'CONSUMIDOR FINAL') as cliente_nombre,
          c.document_number as cliente_cedula,
          o.created_at as fecha,
          o.subtotal,
          o.tax_amount as iva,
          o.total,
          o.status as estado
        FROM "${schema}".pos_orders o
        LEFT JOIN "${schema}".customers c ON o.customer_id = c.id
        ${whereClause}
        ORDER BY o.created_at DESC
      `;
    }
    
    // Contar total
    const countResult = await query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);
    
    // Paginar
    params.push(parseInt(limit), offset);
    const result = await query(selectQuery + ` LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    
    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      metadata: { invoiceSource: dataSource.source }
    });
  } catch (err) {
    console.error('[Sales] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/sales/summary
 * Resumen de ventas - CONSISTENTE con products-stats
 */
router.get('/sales/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { startDate = null, endDate = null, periodo = 'month' } = req.query;
    
    const dataSource = await getDataSource(schema);
    
    if (dataSource.source === 'none') {
      return res.json({
        success: true,
        data: { total_ventas: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0 },
        metadata: { invoiceSource: 'none' }
      });
    }
    
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    
    if (dataSource.source === 'einvoicing') {
      const result = await getEinvoicesTotals(schema, dateFilter, queryParams);
      
      return res.json({
        success: true,
        data: {
          total_ventas: parseInt(result.rows[0]?.total_facturas) || 0,
          total_ingresos: parseFloat(result.rows[0]?.total_ingresos) || 0,
          total_subtotal: parseFloat(result.rows[0]?.total_subtotal) || 0,
          total_iva: parseFloat(result.rows[0]?.total_iva) || 0,
          clientes_unicos: parseInt(result.rows[0]?.clientes_unicos) || 0
        },
        metadata: { invoiceSource: 'einvoicing' }
      });
    }
    
    // POS
    let params = queryParams.length > 0 ? [...queryParams] : [];
    const result = await query(
      `SELECT
         COUNT(*) as total_ventas,
         COALESCE(SUM(o.total), 0) as total_ingresos,
         COALESCE(SUM(o.subtotal), 0) as total_subtotal,
         COALESCE(SUM(o.tax_amount), 0) as total_iva,
         COUNT(DISTINCT o.customer_id) as clientes_unicos
       FROM "${schema}".pos_orders o
       WHERE ${dateFilter} AND o.status = 'paid'`,
      params
    );
    
    res.json({
      success: true,
      data: result.rows[0],
      metadata: { invoiceSource: 'pos' }
    });
  } catch (err) {
    console.error('[SalesSummary] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ============================================
 * 2. REPORTE DE PRODUCTOS
 * ============================================
 */

/**
 * GET /api/reports/products/categories
 */
router.get('/products/categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT id, name, description
       FROM "${schema}".categories
       WHERE is_active = true
       ORDER BY name ASC`
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Categories] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/products-sold
 * Productos vendidos - USA pos_order_items como fuente única de verdad
 */
router.get('/products-sold', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { 
      periodo = 'month', 
      categoria = null, 
      order_by = 'quantity', 
      limit = 50,
      startDate = null,
      endDate = null
    } = req.query;
    
    console.log('[ProductsSold] Params:', { periodo, categoria, order_by, limit });
    
    const dataSource = await getDataSource(schema);
    console.log('[ProductsSold] DataSource:', dataSource);
    
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    
    // Ordenamiento
    let orderByClause = 'cantidad_vendida DESC';
    if (order_by === 'total') orderByClause = 'total_vendido DESC';
    else if (order_by === 'name') orderByClause = 'nombre_producto ASC';
    
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter];
    
    // Solo órdenes pagadas (ya sea desde einvoices o directamente)
    if (dataSource.source === 'einvoicing') {
      // Unir con einvoices para filtrar por facturas autorizadas
      whereConditions.push(`EXISTS (
        SELECT 1 FROM "${schema}".einvoices e 
        WHERE e.order_id = o.id 
          AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
      )`);
    } else {
      whereConditions.push(`o.status = 'paid'`);
    }
    
    // Filtro por categoría
    if (categoria) {
      const catParamIndex = params.length + 1;
      whereConditions.push(`c.id = $${catParamIndex}`);
      params.push(categoria);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const limitParamIndex = params.length + 1;
    
    // CONSULTA PRINCIPAL: Desde pos_order_items (fuente única de verdad)
    const queryText = `
      SELECT 
        p.id::text as id,
        COALESCE(p.code, p.sku, '') as sku,
        COALESCE(p.name, 'Producto sin nombre') as nombre_producto,
        COALESCE(SUM(oi.quantity), 0) as cantidad_vendida,
        COALESCE(SUM(oi.quantity * p.selling_price), 0) as total_vendido,
        COALESCE(cat.name, 'Sin categoría') as categoria,
        COUNT(DISTINCT o.id) as numero_transacciones
      FROM "${schema}".pos_order_items oi
      INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
      INNER JOIN "${schema}".products p ON oi.product_id = p.id
      LEFT JOIN "${schema}".categories cat ON p.category_id = cat.id
      ${whereClause}
      GROUP BY p.id, p.code, p.sku, p.name, cat.name
      HAVING COALESCE(SUM(oi.quantity), 0) > 0
      ORDER BY ${orderByClause}
      LIMIT $${limitParamIndex}
    `;
    
    params.push(parseInt(limit) || 50);
    
    console.log('[ProductsSold] Query:', queryText.substring(0, 300));
    
    const result = await query(queryText, params);
    console.log('[ProductsSold] Row count:', result.rows.length);
    
    const formattedRows = result.rows.map(row => ({
      ...row,
      cantidad_vendida: parseInt(row.cantidad_vendida) || 0,
      total_vendido: parseFloat(row.total_vendido) || 0,
      numero_transacciones: parseInt(row.numero_transacciones) || 0
    }));

    res.json({
      success: true,
      data: formattedRows,
      metadata: {
        invoiceSource: dataSource.source,
        periodo,
        categoria: categoria || 'todas',
        order_by,
        limit: parseInt(limit),
        total_registros: formattedRows.length
      }
    });
  } catch (err) {
    console.error('[ProductsSold] Error:', err);
    res.status(500).json({ success: false, error: err.message, data: [] });
  }
});

/**
 * GET /api/reports/products-stats
 * Estadísticas de productos - CONSISTENTE con sales/summary
 */
router.get('/products-stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { periodo = 'month', startDate, endDate } = req.query;
    
    const dataSource = await getDataSource(schema);
    console.log('[ProductsStats] DataSource:', dataSource);
    
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    
    let stats = {
      total_productos_vendidos: 0,
      total_ventas: 0,
      productos_distintos: 0,
      ticket_promedio: 0
    };
    
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter];
    
    // Filtrar por facturas electrónicas o POS pagadas
    if (dataSource.source === 'einvoicing') {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM "${schema}".einvoices e 
        WHERE e.order_id = o.id 
          AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
      )`);
    } else {
      whereConditions.push(`o.status = 'paid'`);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    
    // Consulta de productos desde pos_order_items
    const productsQuery = `
      SELECT 
        COALESCE(SUM(oi.quantity), 0) as total_cantidad,
        COUNT(DISTINCT oi.product_id) as productos_distintos
      FROM "${schema}".pos_order_items oi
      INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
      ${whereClause}
    `;
    
    const productsResult = await query(productsQuery, params);
    
    if (productsResult.rows[0]) {
      stats.total_productos_vendidos = parseInt(productsResult.rows[0].total_cantidad) || 0;
      stats.productos_distintos = parseInt(productsResult.rows[0].productos_distintos) || 0;
    }
    
    // Consulta de totales desde einvoices o pos_orders (CONSISTENTE con sales/summary)
    if (dataSource.source === 'einvoicing') {
      const totalsResult = await getEinvoicesTotals(schema, dateFilter, queryParams);
      if (totalsResult.rows[0]) {
        stats.total_ventas = parseFloat(totalsResult.rows[0].total_ingresos) || 0;
      }
    } else if (dataSource.source === 'pos') {
      const totalsQuery = `
        SELECT COALESCE(SUM(o.total), 0) as total_ingresos
        FROM "${schema}".pos_orders o
        WHERE ${dateFilter} AND o.status = 'paid'
      `;
      const totalsResult = await query(totalsQuery, params);
      if (totalsResult.rows[0]) {
        stats.total_ventas = parseFloat(totalsResult.rows[0].total_ingresos) || 0;
      }
    }
    
    // Ticket promedio
    stats.ticket_promedio = stats.productos_distintos > 0 
      ? stats.total_ventas / stats.productos_distintos 
      : 0;
    
    // Redondear
    stats.total_ventas = Math.round(stats.total_ventas * 100) / 100;
    stats.ticket_promedio = Math.round(stats.ticket_promedio * 100) / 100;
    
    console.log('[ProductsStats] Final:', stats);
    
    res.json({
      success: true,
      data: stats,
      metadata: { invoiceSource: dataSource.source, periodo }
    });
  } catch (err) {
    console.error('[ProductsStats] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      data: { total_productos_vendidos: 0, total_ventas: 0, productos_distintos: 0, ticket_promedio: 0 }
    });
  }
});

/**
 * ============================================
 * 3. REPORTE AVANZADO
 * ============================================
 */

router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { from = null, to = null, groupBy = 'day' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const dataSource = await getDataSource(schema);
    
    let dateFormatGroup, dateFormatLabel;
    switch(groupBy) {
      case 'week':
        dateFormatGroup = `DATE_TRUNC('week', created_at)`;
        dateFormatLabel = `DATE_TRUNC('week', created_at)`;
        break;
      case 'month':
        dateFormatGroup = `DATE_TRUNC('month', created_at)`;
        dateFormatLabel = `DATE_TRUNC('month', created_at)`;
        break;
      default:
        dateFormatGroup = `DATE(created_at)`;
        dateFormatLabel = `DATE(created_at)`;
    }

    let salesResult = { rows: [] };
    
    if (dataSource.source === 'einvoicing') {
      salesResult = await query(
        `SELECT 
           ${dateFormatLabel} as date,
           COALESCE(SUM(e.total), 0) as total_sales,
           COUNT(*) as numero_transacciones,
           COUNT(DISTINCT e.customer_ruc) as clientes_unicos
         FROM "${schema}".einvoices e
         WHERE e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
           AND DATE(e.created_at) >= $1 
           AND DATE(e.created_at) <= $2
         GROUP BY ${dateFormatGroup}
         ORDER BY date ASC`,
        [from, to]
      );
    } else if (dataSource.source === 'pos') {
      salesResult = await query(
        `SELECT 
           ${dateFormatLabel} as date,
           COALESCE(SUM(o.total), 0) as total_sales,
           COUNT(*) as numero_transacciones,
           COUNT(DISTINCT o.customer_id) as clientes_unicos
         FROM "${schema}".pos_orders o
         WHERE o.status = 'paid'
           AND DATE(o.created_at) >= $1 
           AND DATE(o.created_at) <= $2
         GROUP BY ${dateFormatGroup}
         ORDER BY date ASC`,
        [from, to]
      );
    }

    // Gastos
    let expensesResult = { rows: [] };
    try {
      expensesResult = await query(
        `SELECT 
           DATE(date) as date,
           COALESCE(SUM(amount), 0) as total_expenses
         FROM "${schema}".expenses
         WHERE date >= $1::DATE AND date <= $2::DATE
         GROUP BY DATE(date)
         ORDER BY date ASC`,
        [from, to]
      );
    } catch (err) {
      console.warn('[Advanced] Expenses query failed:', err.message);
    }

    const totalVentas = salesResult.rows.reduce((sum, s) => sum + (Number(s.total_sales) || 0), 0);
    const totalGastos = expensesResult.rows.reduce((sum, e) => sum + (Number(e.total_expenses) || 0), 0);

    res.json({
      success: true,
      sales: salesResult.rows,
      expenses: expensesResult.rows,
      totals: {
        total_ventas: totalVentas,
        total_gastos: totalGastos,
        ganancia_neta: totalVentas - totalGastos,
        margen: totalVentas > 0 ? ((totalVentas - totalGastos) / totalVentas) * 100 : 0
      },
      metadata: {
        invoiceSource: dataSource.source,
        dateRange: { from, to },
        groupBy
      }
    });
  } catch (err) {
    console.error('[Advanced] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;