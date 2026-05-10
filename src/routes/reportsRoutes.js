import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función auxiliar para detectar fuente de datos
// Función auxiliar para detectar fuente de datos
async function getDataSource(schema, startDate = null, endDate = null) {
  try {
    let dateFilter = '';
    const params = [];
    let paramIndex = 1;
    
    if (startDate && endDate) {
      dateFilter = `AND DATE(created_at) >= $${paramIndex}::DATE AND DATE(created_at) <= $${paramIndex + 1}::DATE`;
      params.push(startDate, endDate);
      paramIndex += 2;
    }
    
    // Verificar einvoices primero
    const einvoicesCheck = await query(
      `SELECT COUNT(*) as count FROM "${schema}".einvoices 
       WHERE 1=1 ${dateFilter}`,
      params
    );
    
    console.log('Einvoices count:', einvoicesCheck.rows[0]?.count);
    
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
       WHERE 1=1 ${dateFilter}`,
      params
    );
    
    console.log('POS orders count:', posCheck.rows[0]?.count);
    
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
    // Si hay error, intentar con POS como fallback
    try {
      const posCheck = await query(
        `SELECT COUNT(*) as count FROM "${schema}".pos_orders`
      );
      if (posCheck.rows[0]?.count > 0) {
        return { source: 'pos', table: 'pos_orders', statusCondition: "status = 'paid'", taxColumn: 'tax_amount', idField: 'order_number' };
      }
    } catch {}
    return { source: 'none', table: null };
  }
}

/**
 * ============================================
 * 1. REPORTE DE VENTAS
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
 * 2. REPORTE DE PRODUCTOS
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
 * Reporte de productos vendidos (MEJORADO)
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
    
    // Construir filtro de fecha según período o fechas personalizadas
    let dateFilter = '';
    let queryParams = [];
    let paramCounter = 1;
    
    if (startDate && endDate) {
      // Usar fechas personalizadas
      dateFilter = `DATE(created_at) >= $${paramCounter} AND DATE(created_at) <= $${paramCounter + 1}`;
      queryParams.push(startDate, endDate);
      paramCounter += 2;
    } else {
      // Usar período predefinido
      switch(periodo) {
        case 'day':
          dateFilter = `created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day'`;
          break;
        case 'week':
          dateFilter = `created_at >= CURRENT_DATE - INTERVAL '7 days'`;
          break;
        case 'month':
          dateFilter = `created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
          break;
        case 'quarter':
          dateFilter = `created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
          break;
        case 'year':
          dateFilter = `created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
          break;
        default:
          dateFilter = `created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
      }
    }

    // Definir ordenamiento
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

    const dataSource = await getDataSource(schema);
    let result = { rows: [] };
    let usedSource = dataSource.source;

    // Intentar obtener datos de einvoices primero
    if (dataSource.source === 'einvoicing') {
      try {
        let categoryFilter = '';
        let params = [...queryParams];
        
        // Agregar límite
        params.push(parseInt(limit) || 50);
        
        if (categoria) {
          categoryFilter = `AND item->>'category' = $${paramCounter}`;
          params.push(categoria);
          paramCounter++;
        }
        
        const whereClause = dateFilter ? `WHERE ${dateFilter} AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO') ${categoryFilter}` : `WHERE e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO') ${categoryFilter}`;
        
        const queryText = `
          SELECT 
            COALESCE(item->>'id', item->>'product_id', 'unknown') as id,
            COALESCE(item->>'sku', item->>'code', '') as sku,
            COALESCE(item->>'name', item->>'product_name', 'Producto sin nombre') as nombre_producto,
            COALESCE(SUM(CAST(item->>'quantity' AS INTEGER)), 0) as cantidad_vendida,
            COALESCE(SUM(CAST(item->>'quantity' AS INTEGER) * CAST(COALESCE(item->>'price', '0') AS NUMERIC)), 0) as total_vendido,
            COALESCE(item->>'category', 'Sin categoría') as categoria,
            COUNT(DISTINCT e.id) as numero_transacciones
          FROM "${schema}".einvoices e,
               jsonb_array_elements(e.items) as item
          ${whereClause}
          GROUP BY item->>'id', item->>'sku', item->>'name', item->>'category'
          HAVING COALESCE(SUM(CAST(item->>'quantity' AS INTEGER)), 0) > 0
          ORDER BY ${orderByClause}
          LIMIT $${params.length}
        `;
        
        result = await query(queryText, params);
        
        if (result.rows.length > 0) {
          usedSource = 'einvoicing';
        }
      } catch (err) {
        console.warn('Einvoices products query failed:', err.message);
      }
    }
    
    // Si no hay datos de einvoices o no es la fuente principal, intentar con POS
    if (result.rows.length === 0 && dataSource.source !== 'none') {
      try {
        let categoryFilter = '';
        let params = [...queryParams];
        let currentParam = params.length + 1;
        
        params.push(parseInt(limit) || 50);
        
        if (categoria) {
          categoryFilter = `AND c.id = $${currentParam}`;
          params.push(categoria);
          currentParam++;
        }
        
        const whereClause = dateFilter ? `WHERE ${dateFilter} AND o.status = 'paid' ${categoryFilter}` : `WHERE o.status = 'paid' ${categoryFilter}`;
        
        const queryText = `
          SELECT 
            p.id::text,
            COALESCE(p.code, '') as sku,
            COALESCE(p.name, 'Producto sin nombre') as nombre_producto,
            COALESCE(SUM(oi.quantity), 0) as cantidad_vendida,
            COALESCE(SUM(oi.quantity * COALESCE(p.selling_price, 0)), 0) as total_vendido,
            COALESCE(c.name, 'Sin categoría') as categoria,
            COUNT(DISTINCT o.id) as numero_transacciones
          FROM "${schema}".pos_order_items oi
          INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
          INNER JOIN "${schema}".products p ON oi.product_id = p.id
          LEFT JOIN "${schema}".categories c ON p.category_id = c.id
          ${whereClause}
          GROUP BY p.id, p.code, p.name, c.name
          HAVING COALESCE(SUM(oi.quantity), 0) > 0
          ORDER BY ${orderByClause}
          LIMIT $${params.length}
        `;
        
        result = await query(queryText, params);
        
        if (result.rows.length > 0) {
          usedSource = 'pos';
        }
      } catch (err) {
        console.warn('POS products query failed:', err.message);
      }
    }

    // Formatear números para asegurar que sean válidos
    const formattedRows = result.rows.map(row => ({
      ...row,
      cantidad_vendida: parseInt(row.cantidad_vendida) || 0,
      total_vendido: parseFloat(row.total_vendido) || 0
    }));

    res.json({
      success: true,
      data: formattedRows,
      metadata: {
        invoiceSource: usedSource,
        periodo,
        categoria: categoria || 'todas',
        order_by,
        limit: parseInt(limit),
        total_registros: formattedRows.length
      }
    });
  } catch (err) {
    console.error('Error al generar reporte de productos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/reports/products-stats
 * Estadísticas rápidas de productos (NUEVO ENDPOINT)
 */
/**
 * GET /api/reports/products-stats
 * Estadísticas rápidas de productos (CORREGIDO)
 */
router.get('/products-stats', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { periodo = 'month', startDate, endDate } = req.query;
    
    // Construir filtro de fecha
    let dateFilter = '';
    let queryParams = [];
    
    if (startDate && endDate) {
      // Fechas personalizadas
      dateFilter = `created_at >= $1::DATE AND created_at <= $2::DATE`;
      queryParams = [startDate, endDate];
    } else {
      // Período predefinido
      queryParams = [];
      switch(periodo) {
        case 'day':
          dateFilter = `created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day'`;
          break;
        case 'week':
          dateFilter = `created_at >= CURRENT_DATE - INTERVAL '7 days'`;
          break;
        case 'month':
          dateFilter = `created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
          break;
        case 'quarter':
          dateFilter = `created_at >= DATE_TRUNC('quarter', CURRENT_DATE)`;
          break;
        case 'year':
          dateFilter = `created_at >= DATE_TRUNC('year', CURRENT_DATE)`;
          break;
        default:
          dateFilter = `created_at >= DATE_TRUNC('month', CURRENT_DATE)`;
      }
    }

    const dataSource = await getDataSource(schema, startDate, endDate);
    let stats = {
      total_productos_vendidos: 0,
      total_ventas: 0,
      productos_distintos: 0,
      ticket_promedio: 0
    };

    // Intentar con einvoices si es la fuente detectada
    if (dataSource.source === 'einvoicing' || dataSource.source === 'none') {
      try {
        let queryText;
        let params;
        
        if (queryParams.length > 0) {
          queryText = `
            SELECT 
              COALESCE(SUM(CAST(item->>'quantity' AS INTEGER)), 0) as total_cantidad,
              COALESCE(SUM(CAST(item->>'quantity' AS INTEGER) * CAST(COALESCE(item->>'price', item->>'total', '0') AS NUMERIC)), 0) as total_monto,
              COUNT(DISTINCT COALESCE(item->>'id', item->>'code', item->>'name')) as productos_distintos
            FROM "${schema}".einvoices e,
                 jsonb_array_elements(e.items) as item
            WHERE ${dateFilter}
              AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO', 'paid')
          `;
          params = queryParams;
        } else {
          queryText = `
            SELECT 
              COALESCE(SUM(CAST(item->>'quantity' AS INTEGER)), 0) as total_cantidad,
              COALESCE(SUM(CAST(item->>'quantity' AS INTEGER) * CAST(COALESCE(item->>'price', item->>'total', '0') AS NUMERIC)), 0) as total_monto,
              COUNT(DISTINCT COALESCE(item->>'id', item->>'code', item->>'name')) as productos_distintos
            FROM "${schema}".einvoices e,
                 jsonb_array_elements(e.items) as item
            WHERE ${dateFilter}
              AND e.status IN ('autorizada', 'emitida', 'valid', 'AUTORIZADO', 'paid')
          `;
          params = [];
        }
        
        console.log('Stats Query:', queryText, 'Params:', params);
        
        const result = await query(queryText, params);
        
        if (result.rows[0] && result.rows[0].total_cantidad > 0) {
          stats.total_productos_vendidos = parseInt(result.rows[0].total_cantidad) || 0;
          stats.total_ventas = parseFloat(result.rows[0].total_monto) || 0;
          stats.productos_distintos = parseInt(result.rows[0].productos_distintos) || 0;
        }
      } catch (err) {
        console.warn('Einvoices stats query failed:', err.message);
      }
    }
    
    // Si no hay datos o la fuente es POS, intentar con POS
    if (stats.total_productos_vendidos === 0 && dataSource.source !== 'einvoicing') {
      try {
        let queryText;
        let params;
        
        if (queryParams.length > 0) {
          queryText = `
            SELECT 
              COALESCE(SUM(oi.quantity), 0) as total_cantidad,
              COALESCE(SUM(oi.quantity * COALESCE(oi.price, p.selling_price, 0)), 0) as total_monto,
              COUNT(DISTINCT p.id) as productos_distintos
            FROM "${schema}".pos_order_items oi
            INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
            INNER JOIN "${schema}".products p ON oi.product_id = p.id
            WHERE ${dateFilter.replace(/created_at/g, 'o.created_at')}
              AND o.status = 'paid'
          `;
          params = queryParams;
        } else {
          queryText = `
            SELECT 
              COALESCE(SUM(oi.quantity), 0) as total_cantidad,
              COALESCE(SUM(oi.quantity * COALESCE(oi.price, p.selling_price, 0)), 0) as total_monto,
              COUNT(DISTINCT p.id) as productos_distintos
            FROM "${schema}".pos_order_items oi
            INNER JOIN "${schema}".pos_orders o ON oi.order_id = o.id
            INNER JOIN "${schema}".products p ON oi.product_id = p.id
            WHERE ${dateFilter.replace(/created_at/g, 'o.created_at')}
              AND o.status = 'paid'
          `;
          params = [];
        }
        
        console.log('POS Stats Query:', queryText, 'Params:', params);
        
        const result = await query(queryText, params);
        
        if (result.rows[0]) {
          stats.total_productos_vendidos = parseInt(result.rows[0].total_cantidad) || 0;
          stats.total_ventas = parseFloat(result.rows[0].total_monto) || 0;
          stats.productos_distintos = parseInt(result.rows[0].productos_distintos) || 0;
        }
      } catch (err) {
        console.warn('POS stats query failed:', err.message);
      }
    }

    // Calcular ticket promedio
    stats.ticket_promedio = stats.productos_distintos > 0 
      ? stats.total_ventas / stats.productos_distintos 
      : 0;

    // Redondear valores
    stats.total_ventas = Math.round(stats.total_ventas * 100) / 100;
    stats.ticket_promedio = Math.round(stats.ticket_promedio * 100) / 100;

    console.log('Stats calculados:', stats);

    res.json({
      success: true,
      data: stats,
      metadata: {
        invoiceSource: dataSource.source,
        periodo,
        dateFilter
      }
    });
  } catch (err) {
    console.error('Error al obtener estadísticas:', err);
    res.status(500).json({ 
      success: false, 
      error: err.message,
      data: {
        total_productos_vendidos: 0,
        total_ventas: 0,
        productos_distintos: 0,
        ticket_promedio: 0
      }
    });
  }
});

/**
 * ============================================
 * 3. REPORTE AVANZADO
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