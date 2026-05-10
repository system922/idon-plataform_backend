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

async function getDataSource(schema) {
  try {
    const einvoicesCheck = await query(
      `SELECT COUNT(*) as count 
       FROM "${schema}".einvoices e
       WHERE e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`
    );
    
    if (parseInt(einvoicesCheck.rows[0]?.count) > 0) {
      return { source: 'einvoicing' };
    }
    
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

function buildDateFilter(periodo, startDate, endDate, tableAlias = 'e') {
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

/**
 * CONSULTA BASE UNIFICADA PARA TOTALES DE VENTAS
 * Esta es la ÚNICA fuente de verdad para totales
 */
async function getSalesTotals(schema, periodo, startDate, endDate) {
  const dataSource = await getDataSource(schema);
  const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'e');
  
  let params = queryParams.length > 0 ? [...queryParams] : [];
  
  if (dataSource.source === 'einvoicing') {
    // Total desde facturas electrónicas
    const sql = `
      SELECT 
        COUNT(DISTINCT e.id) as total_ordenes,
        COALESCE(SUM(e.total), 0) as total_ingresos,
        COALESCE(SUM(e.subtotal), 0) as total_subtotal,
        COALESCE(SUM(e.iva_amount), 0) as total_iva,
        COUNT(DISTINCT e.customer_ruc) as clientes_unicos,
        CASE 
          WHEN COUNT(DISTINCT e.id) > 0 
          THEN COALESCE(SUM(e.total), 0) / COUNT(DISTINCT e.id) 
          ELSE 0 
        END as ticket_promedio
      FROM "${schema}".einvoices e
      WHERE ${dateFilter}
        AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
    `;
    
    const result = await query(sql, params);
    return {
      source: 'einvoicing',
      totals: result.rows[0] || { total_ordenes: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0, ticket_promedio: 0 }
    };
  }
  
  if (dataSource.source === 'pos') {
    // Total desde órdenes POS pagadas
    const posDateFilter = dateFilter.replace(/e\./g, 'o.');
    const sql = `
      SELECT 
        COUNT(DISTINCT o.id) as total_ordenes,
        COALESCE(SUM(o.total), 0) as total_ingresos,
        COALESCE(SUM(o.subtotal), 0) as total_subtotal,
        COALESCE(SUM(o.tax_amount), 0) as total_iva,
        COUNT(DISTINCT o.customer_id) as clientes_unicos,
        CASE 
          WHEN COUNT(DISTINCT o.id) > 0 
          THEN COALESCE(SUM(o.total), 0) / COUNT(DISTINCT o.id) 
          ELSE 0 
        END as ticket_promedio
      FROM "${schema}".pos_orders o
      WHERE ${posDateFilter}
        AND o.status = 'paid'
    `;
    
    const result = await query(sql, params);
    return {
      source: 'pos',
      totals: result.rows[0] || { total_ordenes: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0, ticket_promedio: 0 }
    };
  }
  
  return {
    source: 'none',
    totals: { total_ordenes: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0, ticket_promedio: 0 }
  };
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
    
    const { queryParams } = buildDateFilter(periodo, startDate, endDate, 'e');
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let countQuery, selectQuery;
    
    if (dataSource.source === 'einvoicing') {
      const whereClause = params.length > 0
        ? `WHERE DATE(e.created_at) >= $1::DATE AND DATE(e.created_at) <= $2::DATE AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`
        : `WHERE e.created_at >= DATE_TRUNC('month', CURRENT_DATE) AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`;
      
      countQuery = `SELECT COUNT(*) as total FROM "${schema}".einvoices e ${whereClause}`;
      
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      
      selectQuery = `
        SELECT 
          e.id,
          e.invoice_number as numero_factura,
          e.customer_name as cliente_nombre,
          e.customer_ruc as cliente_cedula,
          e.created_at as fecha,
          e.subtotal,
          e.iva_amount as iva,
          e.total,
          e.status as estado
        FROM "${schema}".einvoices e
        ${whereClause}
        ORDER BY e.created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      
      params.push(parseInt(limit), offset);
    } else {
      const posDateFilter = periodo === 'month' 
        ? `o.created_at >= DATE_TRUNC('month', CURRENT_DATE)` 
        : `DATE(o.created_at) >= $1::DATE AND DATE(o.created_at) <= $2::DATE`;
      
      const whereClause = params.length > 0
        ? `WHERE ${posDateFilter} AND o.status = 'paid'`
        : `WHERE o.created_at >= DATE_TRUNC('month', CURRENT_DATE) AND o.status = 'paid'`;
      
      countQuery = `SELECT COUNT(*) as total FROM "${schema}".pos_orders o ${whereClause}`;
      
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      
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
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
      
      params.push(parseInt(limit), offset);
    }
    
    const countResult = await query(countQuery, queryParams.length > 0 ? queryParams : []);
    const total = parseInt(countResult.rows[0].total);
    const result = await query(selectQuery, params);
    
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
 * Resumen de ventas - USA LA CONSULTA UNIFICADA
 */
router.get('/sales/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { startDate = null, endDate = null, periodo = 'month' } = req.query;
    
    const result = await getSalesTotals(schema, periodo, startDate, endDate);
    
    res.json({
      success: true,
      data: {
        total_ventas: parseInt(result.totals.total_ordenes) || 0,
        total_ingresos: parseFloat(result.totals.total_ingresos) || 0,
        total_subtotal: parseFloat(result.totals.total_subtotal) || 0,
        total_iva: parseFloat(result.totals.total_iva) || 0,
        clientes_unicos: parseInt(result.totals.clientes_unicos) || 0,
        ticket_promedio: parseFloat(result.totals.ticket_promedio) || 0
      },
      metadata: { invoiceSource: result.source }
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
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    
    let orderByClause = 'cantidad_vendida DESC';
    if (order_by === 'total') orderByClause = 'total_vendido DESC';
    else if (order_by === 'name') orderByClause = 'nombre_producto ASC';
    
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter.replace(/e\./g, 'o.')];
    
    if (dataSource.source === 'einvoicing') {
      whereConditions.push(`EXISTS (
        SELECT 1 FROM "${schema}".einvoices e 
        WHERE e.order_id = o.id 
          AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
      )`);
    } else {
      whereConditions.push(`o.status = 'paid'`);
    }
    
    if (categoria) {
      const catIdx = params.length + 1;
      whereConditions.push(`cat.id = $${catIdx}`);
      params.push(categoria);
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    const limitIdx = params.length + 1;
    
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
      LIMIT $${limitIdx}
    `;
    
    params.push(parseInt(limit) || 50);
    
    const result = await query(queryText, params);
    
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
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    
    // Obtener totales de ventas (MISMA CONSULTA UNIFICADA)
    const salesTotals = await getSalesTotals(schema, periodo, startDate, endDate);
    
    // Obtener estadísticas de productos desde pos_order_items
    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter.replace(/e\./g, 'o.')];
    
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
    
    const productsQuery = `
      SELECT 
        COALESCE(SUM(oi.quantity), 0) as total_cantidad,
        COUNT(DISTINCT oi.product_id) as productos_distintos
      FROM "${schema}".pos_order_items oi
      INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
      ${whereClause}
    `;
    
    const productsResult = await query(productsQuery, params);
    
    const stats = {
      total_productos_vendidos: parseInt(productsResult.rows[0]?.total_cantidad) || 0,
      total_ventas: parseFloat(salesTotals.totals.total_ingresos) || 0,
      productos_distintos: parseInt(productsResult.rows[0]?.productos_distintos) || 0,
      ticket_promedio: parseFloat(salesTotals.totals.ticket_promedio) || 0
    };
    
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

    console.log('[Advanced] Params:', { from, to, groupBy });

    const dataSource = await getDataSource(schema);
    
    // Usar la consulta unificada para totales
    const totalsResult = await getSalesTotals(schema, 'custom', from, to);
    
    let dateFormatGroup, dateFormatLabel;
    switch(groupBy) {
      case 'week':
        dateFormatGroup = `DATE_TRUNC('week', created_at)::DATE`;
        dateFormatLabel = `DATE_TRUNC('week', created_at)::DATE`;
        break;
      case 'month':
        dateFormatGroup = `DATE_TRUNC('month', created_at)::DATE`;
        dateFormatLabel = `DATE_TRUNC('month', created_at)::DATE`;
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
           COUNT(DISTINCT e.id) as numero_transacciones,
           COUNT(DISTINCT e.customer_ruc) as clientes_unicos
         FROM "${schema}".einvoices e
         WHERE e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
           AND DATE(e.created_at) >= $1::DATE 
           AND DATE(e.created_at) <= $2::DATE
         GROUP BY ${dateFormatGroup}
         ORDER BY date ASC`,
        [from, to]
      );
    } else if (dataSource.source === 'pos') {
      salesResult = await query(
        `SELECT 
           ${dateFormatLabel} as date,
           COALESCE(SUM(o.total), 0) as total_sales,
           COUNT(DISTINCT o.id) as numero_transacciones,
           COUNT(DISTINCT o.customer_id) as clientes_unicos
         FROM "${schema}".pos_orders o
         WHERE o.status = 'paid'
           AND DATE(o.created_at) >= $1::DATE 
           AND DATE(o.created_at) <= $2::DATE
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

    // Crear array completo de fechas
    const allDates = [];
    const startDate = new Date(from + 'T12:00:00');
    const endDate = new Date(to + 'T12:00:00');
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    // Completar ventas
    const completeSales = allDates.map(dateStr => {
      const sale = salesResult.rows.find(s => {
        const saleDate = s.date instanceof Date ? s.date.toISOString().split('T')[0] : String(s.date).split('T')[0];
        return saleDate === dateStr;
      });
      return sale || { date: dateStr, total_sales: 0, numero_transacciones: 0, clientes_unicos: 0 };
    });

    // Completar gastos
    const completeExpenses = allDates.map(dateStr => {
      const expense = expensesResult.rows.find(e => {
        const expDate = e.date instanceof Date ? e.date.toISOString().split('T')[0] : String(e.date).split('T')[0];
        return expDate === dateStr;
      });
      return expense || { date: dateStr, total_expenses: 0 };
    });

    res.json({
      success: true,
      sales: completeSales,
      expenses: completeExpenses,
      totals: {
        total_ventas: parseFloat(totalsResult.totals.total_ingresos) || 0,
        total_gastos: completeExpenses.reduce((sum, e) => sum + (Number(e.total_expenses) || 0), 0),
        ganancia_neta: 0,
        margen: 0
      },
      metadata: {
        invoiceSource: dataSource.source,
        dateRange: { from, to },
        groupBy,
        totalDays: allDates.length
      }
    });
    
    // Calcular neto y margen después
    const totals = res.json.body?.totals || {};
    // Nota: Express no permite modificar después de res.json, así que calculamos antes
  } catch (err) {
    console.error('[Advanced] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Corregir el endpoint advanced para calcular neto y margen antes de enviar
router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { from = null, to = null, groupBy = 'day' } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to dates are required' });

    const dataSource = await getDataSource(schema);
    const totalsResult = await getSalesTotals(schema, 'custom', from, to);
    
    let dateFormatGroup, dateFormatLabel;
    switch(groupBy) {
      case 'week':
        dateFormatGroup = `DATE_TRUNC('week', created_at)::DATE`;
        dateFormatLabel = `DATE_TRUNC('week', created_at)::DATE`;
        break;
      case 'month':
        dateFormatGroup = `DATE_TRUNC('month', created_at)::DATE`;
        dateFormatLabel = `DATE_TRUNC('month', created_at)::DATE`;
        break;
      default:
        dateFormatGroup = `DATE(created_at)`;
        dateFormatLabel = `DATE(created_at)`;
    }

    let salesResult = { rows: [] };
    const tableName = dataSource.source === 'einvoicing' ? 'einvoices' : 'pos_orders';
    const statusCond = dataSource.source === 'einvoicing' 
      ? `status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')` 
      : `status = 'paid'`;
    
    salesResult = await query(
      `SELECT 
         ${dateFormatLabel} as date,
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(DISTINCT id) as numero_transacciones
       FROM "${schema}".${tableName}
       WHERE ${statusCond}
         AND DATE(created_at) >= $1::DATE 
         AND DATE(created_at) <= $2::DATE
       GROUP BY ${dateFormatGroup}
       ORDER BY date ASC`,
      [from, to]
    );

    let expensesResult = { rows: [] };
    try {
      expensesResult = await query(
        `SELECT DATE(date) as date, COALESCE(SUM(amount), 0) as total_expenses
         FROM "${schema}".expenses
         WHERE date >= $1::DATE AND date <= $2::DATE
         GROUP BY DATE(date) ORDER BY date ASC`,
        [from, to]
      );
    } catch (err) {
      console.warn('[Advanced] Expenses:', err.message);
    }

    const allDates = [];
    const start = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      allDates.push(d.toISOString().split('T')[0]);
    }

    const completeSales = allDates.map(dateStr => {
      const sale = salesResult.rows.find(s => {
        const sd = s.date instanceof Date ? s.date.toISOString().split('T')[0] : String(s.date).split('T')[0];
        return sd === dateStr;
      });
      return sale || { date: dateStr, total_sales: 0, numero_transacciones: 0 };
    });

    const completeExpenses = allDates.map(dateStr => {
      const exp = expensesResult.rows.find(e => {
        const ed = e.date instanceof Date ? e.date.toISOString().split('T')[0] : String(e.date).split('T')[0];
        return ed === dateStr;
      });
      return exp || { date: dateStr, total_expenses: 0 };
    });

    const totalVentas = parseFloat(totalsResult.totals.total_ingresos) || 0;
    const totalGastos = completeExpenses.reduce((sum, e) => sum + (Number(e.total_expenses) || 0), 0);
    const gananciaNeta = totalVentas - totalGastos;
    const margen = totalVentas > 0 ? (gananciaNeta / totalVentas) * 100 : 0;

    res.json({
      success: true,
      sales: completeSales,
      expenses: completeExpenses,
      totals: {
        total_ventas: totalVentas,
        total_gastos: totalGastos,
        ganancia_neta: gananciaNeta,
        margen: margen
      },
      metadata: {
        invoiceSource: dataSource.source,
        dateRange: { from, to },
        groupBy,
        totalDays: allDates.length
      }
    });
  } catch (err) {
    console.error('[Advanced] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;