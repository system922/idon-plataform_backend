import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Función para determinar qué fuente de datos usar
async function getDataSource(schema) {
  try {
    // 1. Verificar si hay facturación electrónica configurada Y con datos
    const hasEinvoiceConfig = await query(
      `SELECT EXISTS (
        SELECT 1 FROM "${schema}".einvoice_config 
        WHERE id = 1 
          AND ruc IS NOT NULL AND ruc != ''
          AND razon_social IS NOT NULL AND razon_social != ''
      ) as is_configured`,
      []
    );
    
    const isConfigured = hasEinvoiceConfig.rows[0]?.is_configured || false;
    
    if (isConfigured) {
      // Verificar si hay facturas electrónicas con datos
      const hasEinvoiceData = await query(
        `SELECT EXISTS (
          SELECT 1 FROM "${schema}".einvoices 
          WHERE status IN ('emitida', 'autorizada', 'valid', 'AUTORIZADO', 'paid')
          LIMIT 1
        ) as has_data`,
        []
      );
      
      if (hasEinvoiceData.rows[0]?.has_data) {
        console.log('[getDataSource] Usando facturación electrónica (einvoices)');
        return {
          source: 'einvoicing',
          ordersTable: 'einvoices',
          customerIdField: 'customer_ruc',
          statusCondition: `status IN ('emitida', 'autorizada', 'valid', 'AUTORIZADO', 'paid')`,
          taxColumn: 'iva_amount'
        };
      }
    }
    
    // 2. Fallback a POS
    console.log('[getDataSource] Usando POS (pos_orders)');
    return {
      source: 'pos',
      ordersTable: 'pos_orders',
      customerIdField: 'customer_id',
      statusCondition: `status = 'paid'`,
      taxColumn: 'tax_amount'
    };
    
  } catch (error) {
    console.error('[getDataSource] Error, usando POS por defecto:', error);
    return {
      source: 'pos',
      ordersTable: 'pos_orders',
      customerIdField: 'customer_id',
      statusCondition: `status = 'paid'`,
      taxColumn: 'tax_amount'
    };
  }
}

/**
 * GET /api/crm/analytics/debug
 * Endpoint de diagnóstico
 */
router.get('/analytics/debug', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    // Verificar datos en einvoices
    let einvoicesCount = { rows: [{ count: 0, total: 0 }] };
    let posOrdersCount = { rows: [{ count: 0, total: 0 }] };
    
    try {
      einvoicesCount = await query(
        `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total 
         FROM "${schema}".einvoices 
         WHERE ${dataSource.statusCondition}`,
        []
      );
    } catch (e) {}
    
    try {
      posOrdersCount = await query(
        `SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total 
         FROM "${schema}".pos_orders 
         WHERE status = 'paid'`,
        []
      );
    } catch (e) {}

    res.json({
      success: true,
      data: {
        source: dataSource.source,
        einvoices: {
          count: parseInt(einvoicesCount.rows[0]?.count || 0),
          total: parseFloat(einvoicesCount.rows[0]?.total || 0)
        },
        pos_orders: {
          count: parseInt(posOrdersCount.rows[0]?.count || 0),
          total: parseFloat(posOrdersCount.rows[0]?.total || 0)
        }
      }
    });
  } catch (err) {
    console.error('Error en debug:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/summary
 * Resumen general de clientes y ventas
 */
router.get('/analytics/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    let totalRevenueQuery = '';
    let totalOrdersQuery = '';
    let avgTicketQuery = '';
    let customersLast30dQuery = '';
    
    if (dataSource.source === 'einvoicing') {
      totalRevenueQuery = `(SELECT COALESCE(SUM(total), 0) FROM "${schema}".einvoices WHERE ${dataSource.statusCondition})`;
      totalOrdersQuery = `(SELECT COUNT(*) FROM "${schema}".einvoices WHERE ${dataSource.statusCondition})`;
      avgTicketQuery = `(SELECT COALESCE(AVG(total), 0) FROM "${schema}".einvoices WHERE ${dataSource.statusCondition})`;
      customersLast30dQuery = `(SELECT COUNT(DISTINCT customer_ruc) FROM "${schema}".einvoices WHERE ${dataSource.statusCondition} AND created_at > NOW() - INTERVAL '30 days')`;
    } else {
      totalRevenueQuery = `(SELECT COALESCE(SUM(total), 0) FROM "${schema}".pos_orders WHERE status = 'paid')`;
      totalOrdersQuery = `(SELECT COUNT(*) FROM "${schema}".pos_orders WHERE status = 'paid')`;
      avgTicketQuery = `(SELECT COALESCE(AVG(total), 0) FROM "${schema}".pos_orders WHERE status = 'paid')`;
      customersLast30dQuery = `(SELECT COUNT(DISTINCT customer_id) FROM "${schema}".pos_orders WHERE status = 'paid' AND created_at > NOW() - INTERVAL '30 days')`;
    }

    const result = await query(
      `SELECT
         COUNT(*) as total_customers,
         COUNT(CASE WHEN is_active = true THEN 1 END) as active_customers,
         ${totalRevenueQuery} as total_revenue,
         ${totalOrdersQuery} as total_orders,
         ${avgTicketQuery} as avg_ticket,
         ${customersLast30dQuery} as customers_last_30d
       FROM "${schema}".customers`
    );

    res.json({
      success: true,
      data: result.rows[0],
      metadata: {
        invoiceSource: dataSource.source
      }
    });
  } catch (err) {
    console.error('Error en summary:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/customer-segments
 * Segmentación de clientes por comportamiento
 */
router.get('/analytics/customer-segments', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    let joinCondition = '';
    if (dataSource.source === 'einvoicing') {
      joinCondition = `e.customer_ruc = c.document_number AND ${dataSource.statusCondition}`;
    } else {
      joinCondition = `e.customer_id = c.id AND e.status = 'paid'`;
    }

    const result = await query(
      `WITH customer_stats AS (
        SELECT 
          c.id,
          c.name,
          c.document_number,
          c.is_active,
          COUNT(e.id) as total_orders,
          COALESCE(SUM(e.total), 0) as total_spent,
          COALESCE(AVG(e.total), 0) as avg_spent
        FROM "${schema}".customers c
        LEFT JOIN "${schema}".${dataSource.ordersTable} e ON ${joinCondition}
        GROUP BY c.id
      ),
      segments AS (
        SELECT 
          *,
          CASE 
            WHEN total_spent >= 500 AND total_orders >= 5 THEN 'vip'
            WHEN total_orders >= 3 OR total_spent >= 200 THEN 'frecuente'
            WHEN total_orders >= 1 THEN 'ocasional'
            ELSE 'nuevo'
          END as segment
        FROM customer_stats
      )
      SELECT 
        segment,
        COUNT(*) as count,
        COALESCE(AVG(total_spent), 0) as avg_spent,
        COALESCE(AVG(total_orders), 0) as avg_orders
      FROM segments
      WHERE segment IS NOT NULL
      GROUP BY segment
      ORDER BY 
        CASE segment
          WHEN 'vip' THEN 1
          WHEN 'frecuente' THEN 2
          WHEN 'ocasional' THEN 3
          WHEN 'nuevo' THEN 4
        END`,
      []
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error en customer-segments:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/top-customers
 * Top clientes por gasto
 */
router.get('/analytics/top-customers', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { limit = 10, period = 'all' } = req.query;
    const dataSource = await getDataSource(schema);
    
    let dateFilter = '';
    if (period === 'month') {
      dateFilter = `AND e.created_at > NOW() - INTERVAL '30 days'`;
    } else if (period === 'week') {
      dateFilter = `AND e.created_at > NOW() - INTERVAL '7 days'`;
    }
    
    let joinCondition = '';
    if (dataSource.source === 'einvoicing') {
      joinCondition = `e.customer_ruc = c.document_number AND ${dataSource.statusCondition}`;
    } else {
      joinCondition = `e.customer_id = c.id AND e.status = 'paid'`;
    }

    const result = await query(
      `SELECT 
         c.id,
         c.name,
         c.email,
         c.document_number,
         COUNT(e.id) as total_orders,
         COALESCE(SUM(e.total), 0) as total_spent,
         COALESCE(AVG(e.total), 0) as avg_ticket,
         MAX(e.created_at) as last_order
       FROM "${schema}".customers c
       INNER JOIN "${schema}".${dataSource.ordersTable} e ON ${joinCondition} ${dateFilter}
       GROUP BY c.id, c.name, c.email, c.document_number
       HAVING COALESCE(SUM(e.total), 0) > 0
       ORDER BY total_spent DESC
       LIMIT $1`,
      [parseInt(limit)]
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error en top-customers:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/sales-by-hour
 * Ventas por hora del día
 */
router.get('/analytics/sales-by-hour', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    let whereCondition = '';
    if (dataSource.source === 'einvoicing') {
      whereCondition = `WHERE ${dataSource.statusCondition}`;
    } else {
      whereCondition = `WHERE status = 'paid'`;
    }

    const result = await query(
      `SELECT 
         EXTRACT(HOUR FROM created_at) as hour,
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(*) as order_count
       FROM "${schema}".${dataSource.ordersTable}
       ${whereCondition}
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour`,
      []
    );

    // Completar horas faltantes (0-23)
    const hoursMap = new Map(result.rows.map(r => [Number(r.hour), r]));
    const completeHours = [];
    for (let i = 0; i < 24; i++) {
      if (hoursMap.has(i)) {
        completeHours.push(hoursMap.get(i));
      } else {
        completeHours.push({ hour: i, total_sales: 0, order_count: 0 });
      }
    }

    res.json({
      success: true,
      data: completeHours
    });
  } catch (err) {
    console.error('Error en sales-by-hour:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/sales-by-day
 * Ventas por día de la semana
 */
router.get('/analytics/sales-by-day', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    let whereCondition = '';
    if (dataSource.source === 'einvoicing') {
      whereCondition = `WHERE ${dataSource.statusCondition}`;
    } else {
      whereCondition = `WHERE status = 'paid'`;
    }

    const result = await query(
      `SELECT 
         EXTRACT(DOW FROM created_at) as day_of_week,
         CASE EXTRACT(DOW FROM created_at)
           WHEN 0 THEN 'Domingo'
           WHEN 1 THEN 'Lunes'
           WHEN 2 THEN 'Martes'
           WHEN 3 THEN 'Miércoles'
           WHEN 4 THEN 'Jueves'
           WHEN 5 THEN 'Viernes'
           WHEN 6 THEN 'Sábado'
         END as day_name,
         COALESCE(SUM(total), 0) as total_sales,
         COUNT(*) as order_count
       FROM "${schema}".${dataSource.ordersTable}
       ${whereCondition}
       GROUP BY EXTRACT(DOW FROM created_at)
       ORDER BY day_of_week`,
      []
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error en sales-by-day:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/monthly-trend
 * Tendencia mensual de ventas
 */
router.get('/analytics/monthly-trend', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const { months = 6 } = req.query;
    const dataSource = await getDataSource(schema);
    
    let whereCondition = '';
    if (dataSource.source === 'einvoicing') {
      whereCondition = `WHERE ${dataSource.statusCondition}`;
    } else {
      whereCondition = `WHERE status = 'paid'`;
    }
    
    let uniqueCustomersField = '';
    if (dataSource.source === 'einvoicing') {
      uniqueCustomersField = 'COUNT(DISTINCT customer_ruc) as unique_customers';
    } else {
      uniqueCustomersField = 'COUNT(DISTINCT customer_id) as unique_customers';
    }

    const result = await query(
      `SELECT 
         EXTRACT(YEAR FROM created_at) as year,
         EXTRACT(MONTH FROM created_at) as month,
         TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') as month_key,
         COALESCE(SUM(total), 0) as total_sales,
         ${uniqueCustomersField}
       FROM "${schema}".${dataSource.ordersTable}
       ${whereCondition}
         AND created_at > NOW() - INTERVAL '${months} months'
       GROUP BY EXTRACT(YEAR FROM created_at), EXTRACT(MONTH FROM created_at), DATE_TRUNC('month', created_at)
       ORDER BY year, month`,
      []
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    console.error('Error en monthly-trend:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/crm/analytics/customer-lifetime-value
 * Valor de vida del cliente (CLV)
 */
router.get('/analytics/customer-lifetime-value', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ error: 'Business context required' });
    }

    const dataSource = await getDataSource(schema);
    
    let joinCondition = '';
    if (dataSource.source === 'einvoicing') {
      joinCondition = `e.customer_ruc = c.document_number AND ${dataSource.statusCondition}`;
    } else {
      joinCondition = `e.customer_id = c.id AND e.status = 'paid'`;
    }

    const result = await query(
      `WITH customer_clv AS (
        SELECT 
          c.id,
          COALESCE(SUM(e.total), 0) as total_spent,
          COUNT(e.id) as total_orders
        FROM "${schema}".customers c
        LEFT JOIN "${schema}".${dataSource.ordersTable} e ON ${joinCondition}
        GROUP BY c.id
      )
      SELECT 
        AVG(total_spent) as avg_clv,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_spent) as median_clv,
        MAX(total_spent) as max_clv,
        AVG(CASE WHEN total_orders > 0 THEN total_spent * 4 ELSE 0 END) as avg_projected_annual
      FROM customer_clv`,
      []
    );

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Error en customer-lifetime-value:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;