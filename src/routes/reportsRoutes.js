import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para detectar fuente de datos
async function getDataSource(schema, startDate = null, endDate = null) {
  try {
    let dateFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (startDate && endDate) {
      dateFilter = `AND DATE(created_at) >= $${paramIndex} AND DATE(created_at) <= $${paramIndex + 1}`;
      params.push(startDate, endDate);
      paramIndex += 2;
    }
    
    // Verificar einvoices
    const einvoicesCheck = await query(
      `SELECT COUNT(*) as count FROM "${schema}".einvoices 
       WHERE status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO') ${dateFilter}`,
      params
    );
    
    if (einvoicesCheck.rows[0]?.count > 0) {
      return { 
        source: 'einvoicing', 
        table: 'einvoices', 
        statusCondition: `status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')`, 
        taxColumn: 'iva_amount', 
        idField: 'invoice_number',
        customerIdField: 'customer_ruc',
        customerNameField: 'customer_name'
      };
    }
    
    // Verificar pos_orders
    const posCheck = await query(
      `SELECT COUNT(*) as count FROM "${schema}".pos_orders 
       WHERE status = 'paid' ${dateFilter}`,
      params
    );
    
    if (posCheck.rows[0]?.count > 0) {
      return { 
        source: 'pos', 
        table: 'pos_orders', 
        statusCondition: `status = 'paid'`, 
        taxColumn: 'tax_amount', 
        idField: 'order_number',
        customerIdField: 'customer_id',
        customerNameField: 'customer_name'
      };
    }
    
    return { source: 'none', table: null };
  } catch (err) {
    console.error('Error detecting data source:', err);
    return { source: 'none', table: null };
  }
}

/**
 * ============================================
 * REPORTE DE VENTAS
 * ============================================
 */

/**
 * GET /api/reports/sales
 * Reporte de ventas con paginación
 */
router.get('/sales', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { page = 1, limit = 20, startDate = null, endDate = null } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    const dataSource = await getDataSource(schema, startDate, endDate);
    
    if (dataSource.source === 'none') {
      return res.json({
        success: true,
        data: [],
        pagination: { page: parseInt(page), limit: parseInt(limit), total: 0, totalPages: 0 },
        metadata: { invoiceSource: 'none' }
      });
    }
    
    let whereConditions = [`${dataSource.statusCondition}`];
    let params = [];
    let paramIndex = 1;
    
    if (startDate) {
      whereConditions.push(`DATE(created_at) >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      whereConditions.push(`DATE(created_at) <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    
    // Contar total
    const countResult = await query(
      `SELECT COUNT(*) as total FROM "${schema}".${dataSource.table} t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);
    
    // Obtener datos paginados
    let selectQuery = '';
    if (dataSource.source === 'einvoicing') {
      selectQuery = `
        SELECT 
          t.id,
          t.invoice_number as numero_factura,
          t.customer_id,
          COALESCE(t.customer_name, 'CONSUMIDOR FINAL') as cliente_nombre,
          t.customer_ruc as cliente_cedula,
          t.created_at as fecha,
          t.subtotal,
          t.${dataSource.taxColumn} as iva,
          t.total,
          t.status as estado
        FROM "${schema}".${dataSource.table} t
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
    } else {
      selectQuery = `
        SELECT 
          t.id,
          t.order_number as numero_factura,
          t.customer_id,
          COALESCE(c.name, t.customer_name, 'CONSUMIDOR FINAL') as cliente_nombre,
          c.document_number as cliente_cedula,
          t.created_at as fecha,
          t.subtotal,
          t.${dataSource.taxColumn} as iva,
          t.total,
          t.status as estado
        FROM "${schema}".${dataSource.table} t
        LEFT JOIN "${schema}".customers c ON t.customer_id = c.id
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
    }
    
    params.push(parseInt(limit), offset);
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
      metadata: {
        invoiceSource: dataSource.source
      }
    });
  } catch (err) {
    console.error('Error en sales report:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/sales/summary
 * Resumen de ventas
 */
router.get('/sales/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { startDate = null, endDate = null } = req.query;
    
    const dataSource = await getDataSource(schema, startDate, endDate);
    
    if (dataSource.source === 'none') {
      return res.json({
        success: true,
        data: { total_ventas: 0, total_ingresos: 0, total_subtotal: 0, total_iva: 0, clientes_unicos: 0 },
        metadata: { invoiceSource: 'none' }
      });
    }
    
    let whereConditions = [`${dataSource.statusCondition}`];
    let params = [];
    let paramIndex = 1;
    
    if (startDate) {
      whereConditions.push(`DATE(created_at) >= $${paramIndex}`);
      params.push(startDate);
      paramIndex++;
    }
    
    if (endDate) {
      whereConditions.push(`DATE(created_at) <= $${paramIndex}`);
      params.push(endDate);
      paramIndex++;
    }
    
    const whereClause = `WHERE ${whereConditions.join(' AND ')}`;
    
    let clientesUnicosField = '';
    if (dataSource.source === 'einvoicing') {
      clientesUnicosField = 'COUNT(DISTINCT customer_ruc) as clientes_unicos';
    } else {
      clientesUnicosField = 'COUNT(DISTINCT customer_id) as clientes_unicos';
    }
    
    const result = await query(
      `SELECT
         COUNT(*) as total_ventas,
         COALESCE(SUM(total), 0) as total_ingresos,
         COALESCE(SUM(subtotal), 0) as total_subtotal,
         COALESCE(SUM(${dataSource.taxColumn}), 0) as total_iva,
         ${clientesUnicosField}
       FROM "${schema}".${dataSource.table} t
       ${whereClause}`,
      params
    );
    
    res.json({
      success: true,
      data: result.rows[0],
      metadata: {
        invoiceSource: dataSource.source
      }
    });
  } catch (err) {
    console.error('Error en sales summary:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ============================================
 * REPORTE DE PRODUCTOS
 * ============================================
 */

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
         (SELECT COUNT(*) FROM "${schema}".products WHERE category_id = c.id AND is_active = true) as product_count
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
 * Reporte de productos vendidos
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
        dateFilter = `created_at >= DATE(NOW()) AND created_at < DATE(NOW()) + INTERVAL '1 day'`;
        break;
      case 'week':
        dateFilter = `created_at >= DATE(NOW() - INTERVAL '7 days')`;
        break;
      case 'month':
        dateFilter = `created_at >= DATE_TRUNC('month', NOW())`;
        break;
      case 'quarter':
        dateFilter = `created_at >= DATE_TRUNC('quarter', NOW())`;
        break;
      case 'year':
        dateFilter = `created_at >= DATE_TRUNC('year', NOW())`;
        break;
      default:
        dateFilter = `created_at >= DATE_TRUNC('month', NOW())`;
    }

    let orderByClause = 'cantidad_vendida DESC';
    switch(order_by) {
      case 'total':
        orderByClause = 'total_vendido DESC';
        break;
      case 'name':
        orderByClause = 'nombre_producto ASC';
        break;
      default:
        orderByClause = 'cantidad_vendida DESC';
    }

    const dataSource = await getDataSource(schema);
    
    let result = { rows: [] };

    if (dataSource.source === 'einvoicing') {
      try {
        let categoryFilter = '';
        let params = [parseInt(limit) || 50];
        
        if (categoria) {
          categoryFilter = `AND item->>'category' = $2`;
          params.push(categoria);
        }
        
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
             AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO')
             ${categoryFilter}
           GROUP BY item->>'id', item->>'sku', item->>'name', item->>'category'
           ORDER BY ${orderByClause}
           LIMIT $1`,
          params
        );
      } catch (err) {
        console.warn('Einvoices products query failed:', err.message);
      }
    }
    
    if ((dataSource.source !== 'einvoicing' || result.rows.length === 0) && dataSource.source !== 'none') {
      try {
        let categoryFilter = '';
        let params = [parseInt(limit) || 50];
        let paramIndex = 2;
        
        if (categoria) {
          categoryFilter = `AND c.id = $${paramIndex}`;
          params.push(categoria);
          paramIndex++;
        }
        
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
             ${categoryFilter}
           GROUP BY p.id, p.code, p.name, c.name
           ORDER BY ${orderByClause}
           LIMIT $1`,
          params
        );
      } catch (err) {
        console.warn('POS products query failed:', err.message);
      }
    }

    res.json({
      success: true,
      data: result.rows,
      metadata: {
        invoiceSource: dataSource.source
      }
    });
  } catch (err) {
    console.error('Error al generar reporte de productos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ============================================
 * REPORTE AVANZADO
 * ============================================
 */

/**
 * GET /api/reports/advanced
 * Reporte avanzado con ventas y gastos
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
      case 'category':
        dateFormatGroup = `'Categoría'`;
        dateFormatLabel = `'Categoría'`;
        break;
      default:
        dateFormatGroup = `DATE(created_at)`;
        dateFormatLabel = `DATE(created_at)`;
    }

    const dataSource = await getDataSource(schema, from, to);
    
    let salesResult = { rows: [] };
    
    if (dataSource.source !== 'none') {
      let selectFields = '';
      if (groupBy === 'category') {
        selectFields = `
          'Ventas' as category,
          COALESCE(SUM(total), 0) as total_sales,
          COUNT(*) as numero_transacciones,
          ${dataSource.source === 'einvoicing' ? 'COUNT(DISTINCT customer_ruc)' : 'COUNT(DISTINCT customer_id)'} as clientes_unicos
        `;
        salesResult = await query(
          `SELECT ${selectFields}
           FROM "${schema}".${dataSource.table}
           WHERE ${dataSource.statusCondition}
             AND DATE(created_at) >= $1 
             AND DATE(created_at) <= $2`,
          [from, to]
        );
      } else {
        salesResult = await query(
          `SELECT 
             ${dateFormatLabel} as date,
             COALESCE(SUM(total), 0) as total_sales,
             COUNT(*) as numero_transacciones,
             ${dataSource.source === 'einvoicing' ? 'COUNT(DISTINCT customer_ruc)' : 'COUNT(DISTINCT customer_id)'} as clientes_unicos
           FROM "${schema}".${dataSource.table}
           WHERE ${dataSource.statusCondition}
             AND DATE(created_at) >= $1 
             AND DATE(created_at) <= $2
           GROUP BY ${dateFormatGroup}
           ORDER BY date ASC`,
          [from, to]
        );
      }
    }

    // Gastos
    let expensesResult = { rows: [] };
    try {
      if (groupBy === 'category') {
        expensesResult = await query(
          `SELECT 
             'Gastos' as category,
             COALESCE(SUM(amount), 0) as total_expenses
           FROM "${schema}".expenses
           WHERE date >= $1::DATE
             AND date <= $2::DATE`,
          [from, to]
        );
      } else {
        expensesResult = await query(
          `SELECT 
             DATE(date) as date,
             COALESCE(SUM(amount), 0) as total_expenses
           FROM "${schema}".expenses
           WHERE date >= $1::DATE
             AND date <= $2::DATE
           GROUP BY DATE(date)
           ORDER BY date ASC`,
          [from, to]
        );
      }
    } catch (err) {
      console.warn('Expenses query failed:', err.message);
    }

    // Totales generales
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
    console.error('Error en reporte avanzado:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;