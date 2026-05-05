import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { ecuadorToday } from '../utils/dateHelper.js';

const router = express.Router();

// GET /api/reports/sales-today?date=YYYY-MM-DD
router.get('/sales-today', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema)
      return res.status(400).json({ error: 'Business context required' });

    const date = req.query.date || ecuadorToday();

    const result = await query(
      `SELECT
         COUNT(DISTINCT o.id)::INT            AS tickets_count,
         COALESCE(SUM(p.amount),0)            AS total_cobrado
       FROM "${schema}".pos_orders o
       JOIN "${schema}".pos_payments p
         ON p.order_id = o.id
       WHERE DATE(o.created_at) = $1
         AND o.status = 'paid'
         AND p.status = 'completed'
      `,
      [date]
    );

    res.json(result.rows[0] || { tickets_count: 0, total_cobrado: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/reports/pending
 */
router.get('/pending', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const result = await query(
      `SELECT COUNT(*)::INT AS count
       FROM "${schema}".pos_orders
       WHERE status IN ('pending','sent')`
    );

    res.json({ count: result.rows[0]?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/inventory?type=summary|currentStock|lowStock|movements ────
router.get('/inventory', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { type = 'summary', from, to, productId } = req.query;

    if (type === 'summary') {
      const result = await query(`
        SELECT
          COUNT(*)::int                                             AS total_products,
          COALESCE(SUM(p.stock), 0)::numeric                       AS total_units,
          COALESCE(SUM(p.stock * p.selling_price), 0)::numeric     AS total_value,
          COUNT(CASE WHEN p.stock <= p.min_stock THEN 1 END)::int  AS low_stock_count,
          COUNT(CASE WHEN p.stock = 0 THEN 1 END)::int             AS out_of_stock_count
        FROM "${schema}".products p WHERE p.is_active = true
      `);
      return res.json(result.rows[0]);
    }

    if (type === 'currentStock') {
      const result = await query(`
        SELECT p.id, p.name, p.sku, p.stock, p.min_stock,
               p.selling_price AS price,
               COALESCE(c.name, 'Sin categoría') AS category,
               CASE WHEN p.stock <= p.min_stock THEN true ELSE false END AS is_low
        FROM "${schema}".products p
        LEFT JOIN "${schema}".categories c ON c.id = p.category_id
        WHERE p.is_active = true
        ORDER BY p.name ASC
      `);
      return res.json(result.rows);
    }

    if (type === 'lowStock') {
      const result = await query(`
        SELECT p.id, p.name, p.sku, p.stock, p.min_stock,
               COALESCE(c.name, 'Sin categoría') AS category
        FROM "${schema}".products p
        LEFT JOIN "${schema}".categories c ON c.id = p.category_id
        WHERE p.is_active = true AND p.stock <= p.min_stock
        ORDER BY p.stock ASC
      `);
      return res.json(result.rows);
    }

    if (type === 'movements') {
      const dateFrom = from || new Date(new Date().setDate(1)).toISOString().split('T')[0];
      const dateTo   = to   || new Date().toISOString().split('T')[0];
      let whereExtra = '';
      const params = [dateFrom, dateTo];
      if (productId) {
        whereExtra = ` AND oi.product_id = $3`;
        params.push(productId);
      }
      const result = await query(`
        SELECT oi.id, o.created_at AS date, p.name AS product_name, p.sku,
               oi.quantity, 'salida' AS movement_type,
               o.order_number
        FROM "${schema}".pos_order_items oi
        JOIN "${schema}".pos_orders o ON o.id = oi.order_id
        JOIN "${schema}".products p ON p.id = oi.product_id
        WHERE DATE(o.created_at) BETWEEN $1 AND $2 AND o.status = 'paid'
        ${whereExtra}
        ORDER BY o.created_at DESC
      `, params);
      return res.json(result.rows);
    }

    res.status(400).json({ error: 'Tipo de reporte inválido' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/products/categories ──────────────────────────────────────
router.get('/products/categories', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const result = await query(`
      SELECT id, name FROM "${schema}".categories
      WHERE is_active = true ORDER BY name ASC
    `);
    res.json({ data: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/products-sold ────────────────────────────────────────────
router.get('/products-sold', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { periodo = '30d', categoria, order_by = 'quantity', limit = 50 } = req.query;

    const days = periodo === '7d' ? 7 : periodo === '30d' ? 30 : periodo === '90d' ? 90 : periodo === '1y' ? 365 : 30;

    let catJoin = '';
    let catWhere = '';
    const params = [days, parseInt(limit)];
    if (categoria) {
      catWhere = ` AND p.category_id = $3`;
      params.push(categoria);
    }

    const orderMap = { total: 'total_sold DESC', name: 'product_name ASC', quantity: 'total_qty DESC' };
    const orderClause = orderMap[order_by] || 'total_qty DESC';

    const result = await query(`
      SELECT p.id, p.name AS nombre, p.sku AS codigo,
             COALESCE(c.name, 'Sin categoría') AS categoria,
             SUM(oi.quantity)::int                      AS cantidad_vendida,
             SUM(oi.quantity * p.selling_price)::numeric  AS total_vendido,
             SUM(oi.quantity)::int                      AS total_qty,
             SUM(oi.quantity * p.selling_price)::numeric  AS total_venta
      FROM "${schema}".pos_order_items oi
      JOIN "${schema}".pos_orders o    ON o.id = oi.order_id
      JOIN "${schema}".products p      ON p.id = oi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE o.status = 'paid'
        AND o.created_at >= NOW() - ($1 || ' days')::interval
        ${catWhere}
      GROUP BY p.id, p.name, p.sku, c.name
      ORDER BY ${orderClause}
      LIMIT $2
    `, params);

    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/products-sold/export ─────────────────────────────────────
router.get('/products-sold/export', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { periodo = '30d', categoria } = req.query;

    const days = periodo === '7d' ? 7 : periodo === '30d' ? 30 : periodo === '90d' ? 90 : periodo === '1y' ? 365 : 30;
    const params = [days];
    let catWhere = '';
    if (categoria) { catWhere = ` AND p.category_id = $2`; params.push(categoria); }

    const result = await query(`
      SELECT p.name AS Producto, p.sku AS SKU,
             COALESCE(c.name, 'Sin categoría') AS Categoría,
             SUM(oi.quantity)::int                      AS "Cantidad vendida",
             SUM(oi.quantity * p.selling_price)::numeric  AS "Total vendido"
      FROM "${schema}".pos_order_items oi
      JOIN "${schema}".pos_orders o    ON o.id = oi.order_id
      JOIN "${schema}".products p      ON p.id = oi.product_id
      LEFT JOIN "${schema}".categories c ON c.id = p.category_id
      WHERE o.status = 'paid' AND o.created_at >= NOW() - ($1 || ' days')::interval
      ${catWhere}
      GROUP BY p.id, p.name, p.sku, c.name
      ORDER BY "Cantidad vendida" DESC
    `, params);

    const headers = ['Producto', 'SKU', 'Categoría', 'Cantidad vendida', 'Total vendido'];
    const rows = result.rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','));
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="productos-vendidos.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/advanced ─────────────────────────────────────────────────
router.get('/advanced', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { from, to, groupBy = 'day' } = req.query;

    if (!from || !to) return res.status(400).json({ error: 'Parámetros from y to requeridos' });

    const truncFn = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : 'day';

    const [salesRes, expensesRes] = await Promise.all([
      query(`
        SELECT DATE_TRUNC('${truncFn}', o.created_at)::date AS date,
               COALESCE(SUM(p.amount), 0)::numeric           AS total_sales
        FROM "${schema}".pos_orders o
        JOIN "${schema}".pos_payments p ON p.order_id = o.id
        WHERE DATE(o.created_at) BETWEEN $1 AND $2
          AND o.status = 'paid' AND p.status = 'completed'
        GROUP BY 1 ORDER BY 1 ASC
      `, [from, to]),
      query(`
        SELECT DATE_TRUNC('${truncFn}', e.date)::date AS date,
               COALESCE(SUM(e.amount), 0)::numeric     AS total_expenses
        FROM "${schema}".expenses e
        WHERE DATE(e.date) BETWEEN $1 AND $2
        GROUP BY 1 ORDER BY 1 ASC
      `, [from, to]).catch(() => ({ rows: [] }))
    ]);

    const totalSales    = salesRes.rows.reduce((s, r) => s + parseFloat(r.total_sales), 0);
    const totalExpenses = expensesRes.rows.reduce((s, r) => s + parseFloat(r.total_expenses), 0);

    res.json({
      sales:          salesRes.rows,
      expenses:       expensesRes.rows,
      summary: {
        total_sales:    totalSales,
        total_expenses: totalExpenses,
        net_profit:     totalSales - totalExpenses,
        profit_margin:  totalSales > 0 ? ((totalSales - totalExpenses) / totalSales * 100).toFixed(2) : 0
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;