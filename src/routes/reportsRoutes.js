import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

function buildDateFilter(periodo, startDate, endDate, tableAlias = 'o') {
  let dateFilter = '';
  let queryParams = [];

  if (startDate && endDate) {
    dateFilter = `DATE(${tableAlias}.created_at) >= $1::DATE AND DATE(${tableAlias}.created_at) <= $2::DATE`;
    queryParams = [startDate, endDate];
  } else {
    switch (periodo) {
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

async function getSalesTotals(schema, periodo, startDate, endDate) {
  const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
  const params = queryParams.length > 0 ? [...queryParams] : [];

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
    WHERE ${dateFilter}
      AND o.status = 'paid'
  `;

  const result = await query(sql, params);
  return result.rows[0] || { total_ordenes: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0, ticket_promedio: 0 };
}

/**
 * GET /api/reports/sales/summary
 */
router.get('/sales/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { startDate = null, endDate = null, periodo = 'month' } = req.query;

    const totals = await getSalesTotals(schema, periodo, startDate, endDate);

    res.json({
      success: true,
      data: {
        total_ventas: parseInt(totals.total_ordenes) || 0,
        total_ingresos: parseFloat(totals.total_ingresos) || 0,
        total_subtotal: parseFloat(totals.total_subtotal) || 0,
        total_iva: parseFloat(totals.total_iva) || 0,
        clientes_unicos: parseInt(totals.clientes_unicos) || 0,
        ticket_promedio: parseFloat(totals.ticket_promedio) || 0
      },
      metadata: { invoiceSource: 'pos' }
    });
  } catch (err) {
    console.error('[SalesSummary] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/sales
 */
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, startDate = null, endDate = null, periodo = 'month' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    let params = queryParams.length > 0 ? [...queryParams] : [];

    const posDateFilter = params.length > 0
      ? `DATE(o.created_at) >= $1::DATE AND DATE(o.created_at) <= $2::DATE`
      : `o.created_at >= DATE_TRUNC('month', CURRENT_DATE)`;

    const whereClause = `WHERE ${posDateFilter} AND o.status = 'paid'`;

    const countQuery = `SELECT COUNT(*) as total FROM "${schema}".pos_orders o ${whereClause}`;

    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;

    const selectQuery = `
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
      metadata: { invoiceSource: 'pos' }
    });
  } catch (err) {
    console.error('[Sales] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
 * GET /api/reports/products-stats
 */
router.get('/products-stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { periodo = 'month', startDate, endDate } = req.query;

    const salesTotals = await getSalesTotals(schema, periodo, startDate, endDate);
    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');
    const params = queryParams.length > 0 ? [...queryParams] : [];

    const productsResult = await query(
      `SELECT
        COALESCE(SUM(oi.quantity), 0) as total_cantidad,
        COUNT(DISTINCT oi.product_id) as productos_distintos
       FROM "${schema}".pos_order_items oi
       INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
       WHERE ${dateFilter} AND o.status = 'paid'`,
      params
    );

    const stats = {
      total_productos_vendidos: parseInt(productsResult.rows[0]?.total_cantidad) || 0,
      total_ventas: Math.round((parseFloat(salesTotals.total_ingresos) || 0) * 100) / 100,
      productos_distintos: parseInt(productsResult.rows[0]?.productos_distintos) || 0,
      ticket_promedio: Math.round((parseFloat(salesTotals.ticket_promedio) || 0) * 100) / 100
    };

    res.json({
      success: true,
      data: stats,
      metadata: { invoiceSource: 'pos', periodo }
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

    const { dateFilter, queryParams } = buildDateFilter(periodo, startDate, endDate, 'o');

    let orderByClause = 'cantidad_vendida DESC';
    if (order_by === 'total') orderByClause = 'total_vendido DESC';
    else if (order_by === 'name') orderByClause = 'nombre_producto ASC';

    let params = queryParams.length > 0 ? [...queryParams] : [];
    let whereConditions = [dateFilter, `o.status = 'paid'`];

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
        COALESCE(cat.name, 'Sin categoria') as categoria,
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
        invoiceSource: 'pos',
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
 * GET /api/reports/advanced
 */
router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { from = null, to = null, groupBy = 'day' } = req.query;

    if (!from || !to) {
      return res.status(400).json({ error: 'from and to dates are required' });
    }

    const totals = await getSalesTotals(schema, 'custom', from, to);

    let dateFormatGroup, dateFormatLabel;
    switch (groupBy) {
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

    const salesResult = await query(
      `SELECT
         ${dateFormatLabel} as date,
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(DISTINCT id) as numero_transacciones
       FROM "${schema}".pos_orders
       WHERE status = 'paid'
         AND DATE(created_at) >= $1::DATE
         AND DATE(created_at) <= $2::DATE
       GROUP BY ${dateFormatGroup}
       ORDER BY date ASC`,
      [from, to]
    );

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

    const totalVentas = parseFloat(totals.total_ingresos) || 0;
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
        margen
      },
      metadata: {
        invoiceSource: 'pos',
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
