import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

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
         name, 
         description,
         (SELECT COUNT(*) FROM "${schema}".products WHERE category_id = c.id) as product_count
       FROM "${schema}".categories c
       WHERE is_active = true
       ORDER BY name ASC`,
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
        dateFilter = `o.created_at >= DATE(NOW()) AND o.created_at < DATE(NOW()) + INTERVAL '1 day'`;
        break;
      case 'week':
        dateFilter = `o.created_at >= DATE(NOW() - INTERVAL '7 days')`;
        break;
      case 'month':
        dateFilter = `o.created_at >= DATE_TRUNC('month', NOW())`;
        break;
      case 'quarter':
        dateFilter = `o.created_at >= DATE_TRUNC('quarter', NOW())`;
        break;
      case 'year':
        dateFilter = `o.created_at >= DATE_TRUNC('year', NOW())`;
        break;
      default:
        dateFilter = `o.created_at >= DATE_TRUNC('month', NOW())`;
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

    // Detectar si hay más einvoices o pos_orders
    let hasEinvoices = false;
    let hasPos = false;
    
    try {
      const einvoicesCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoices 
         WHERE ${dateFilter} AND status = 'autorizada'`,
        []
      );
      hasEinvoices = (einvoicesCheck.rows[0]?.count || 0) > 0;
    } catch (err) {
      console.warn('Einvoices table check failed:', err.message);
    }

    try {
      const posCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".pos_orders 
         WHERE ${dateFilter} AND status = 'paid'`,
        []
      );
      hasPos = (posCheck.rows[0]?.count || 0) > 0;
    } catch (err) {
      console.warn('POS table check failed:', err.message);
    }

    let result = { rows: [] };

    // Consultar productos desde einvoices (si existen datos)
    if (hasEinvoices) {
      try {
        result = await query(
          `SELECT 
             item->>'id' as id,
             item->>'sku' as sku,
             item->>'name' as nombre_producto,
             COALESCE(SUM(CAST(item->>'quantity' AS INT)), 0) as cantidad_vendida,
             COALESCE(SUM(CAST(item->>'quantity' AS INT) * CAST(item->>'price' AS NUMERIC)), 0) as total_vendido,
             item->>'category' as categoria,
             COUNT(DISTINCT e.id) as numero_transacciones
           FROM "${schema}".einvoices e,
                jsonb_array_elements(e.items) as item
           WHERE ${dateFilter}
             AND e.status = 'autorizada'
           GROUP BY item->>'id', item->>'sku', item->>'name', item->>'category'
           ORDER BY ${orderByClause}
           LIMIT $1`,
          [parseInt(limit) || 50]
        );
      } catch (err) {
        console.warn('Einvoices products query failed:', err.message);
      }
    }

    // Si no hay einvoices o está vacío, intentar con pos_orders + pos_order_items
    if (!hasEinvoices || result.rows.length === 0) {
      try {
        result = await query(
          `SELECT 
             p.id::text,
             p.code as sku,
             p.name as nombre_producto,
             COALESCE(SUM(oi.quantity), 0) as cantidad_vendida,
             COALESCE(SUM(oi.quantity * p.selling_price), 0) as total_vendido,
             c.name as categoria,
             COUNT(DISTINCT o.id) as numero_transacciones
           FROM "${schema}".pos_order_items oi
           JOIN "${schema}".pos_orders o ON oi.order_id = o.id
           JOIN "${schema}".products p ON oi.product_id = p.id
           LEFT JOIN "${schema}".categories c ON p.category_id = c.id
           WHERE ${dateFilter}
             AND o.status = 'paid'
           GROUP BY p.id, p.code, p.name, c.name
           ORDER BY ${orderByClause}
           LIMIT $1`,
          [parseInt(limit) || 50]
        );
      } catch (err) {
        console.warn('POS products query failed:', err.message);
      }
    }

    res.json({
      success: true,
      data: result.rows,
      metadata: {
        invoiceSource: hasEinvoices ? 'einvoices' : 'pos'
      }
    });
  } catch (err) {
    console.error('Error al generar reporte de productos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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
        dateFormatGroup = `DATE_TRUNC('week', created_at)`;
        dateFormatLabel = `DATE_TRUNC('week', created_at)`;
        break;
      case 'month':
        dateFormatGroup = `DATE_TRUNC('month', created_at)`;
        dateFormatLabel = `DATE_TRUNC('month', created_at)`;
        break;
      case 'day':
      default:
        dateFormatGroup = `DATE(created_at)`;
        dateFormatLabel = `DATE(created_at)`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. VENTAS: Obtener de einvoices o pos_orders
    // ─────────────────────────────────────────────────────────────────────────
    let salesResult = { rows: [] };
    let dataSource = 'unknown';
    
    try {
      // Intentar obtener datos de einvoices primero
      const einvoicesCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".einvoices 
         WHERE DATE(created_at) >= $1 AND DATE(created_at) <= $2 AND status = 'autorizada'`,
        [from, to]
      );
      
      if (einvoicesCheck.rows[0]?.count > 0) {
        dataSource = 'einvoices';
        salesResult = await query(
          `SELECT 
             ${dateFormatLabel} as date,
             COALESCE(SUM(total), 0) as total_sales,
             COUNT(*) as numero_transacciones,
             COUNT(DISTINCT customer_id) as clientes_unicos
           FROM "${schema}".einvoices
           WHERE DATE(created_at) >= $1 
             AND DATE(created_at) <= $2
             AND status = 'autorizada'
           GROUP BY ${dateFormatGroup}
           ORDER BY date ASC`,
          [from, to]
        );
      } else {
        // Si no hay einvoices, intentar con pos_orders
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
               COALESCE(SUM(total), 0) as total_sales,
               COUNT(*) as numero_transacciones,
               COUNT(DISTINCT customer_id) as clientes_unicos
             FROM "${schema}".pos_orders
             WHERE DATE(created_at) >= $1 
               AND DATE(created_at) <= $2
               AND status = 'paid'
             GROUP BY ${dateFormatGroup}
             ORDER BY date ASC`,
            [from, to]
          );
        }
      }
    } catch (err) {
      console.warn('Warning - Sales query failed:', err.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. GASTOS: Obtener de expenses - USANDO COLUMNA "date" NO "created_at"
    // ─────────────────────────────────────────────────────────────────────────
    let expensesResult = { rows: [] };
    try {
      expensesResult = await query(
        `SELECT 
           ${dateFormatLabel.replace(/created_at/g, '"date"')} as date,
           COALESCE(SUM(amount), 0) as total_expenses
         FROM "${schema}".expenses
         WHERE "date" >= $1::DATE
           AND "date" <= $2::DATE
         GROUP BY ${dateFormatGroup.replace(/created_at/g, '"date"')}
         ORDER BY date ASC`,
        [from, to]
      );
    } catch (err) {
      console.warn('Warning - Expenses query failed:', err.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. CUENTAS POR COBRAR: Obtener de accounts_receivable - USANDO "issue_date"
    // ─────────────────────────────────────────────────────────────────────────
    let receivablesResult = { rows: [] };
    try {
      receivablesResult = await query(
        `SELECT 
           ${dateFormatLabel.replace(/created_at/g, 'issue_date')} as date,
           COALESCE(SUM(amount), 0) as total_receivable
         FROM "${schema}".accounts_receivable
         WHERE issue_date >= $1::DATE
           AND issue_date <= $2::DATE
           AND status = 'pending'
         GROUP BY ${dateFormatGroup.replace(/created_at/g, 'issue_date')}
         ORDER BY date ASC`,
        [from, to]
      );
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
