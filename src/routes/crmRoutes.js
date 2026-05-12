import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendCampaign } from '../services/crmEmailService.js';

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// HELPERS: Determinar fuente de datos (einvoicing vs POS)
// ─────────────────────────────────────────────────────────────
async function getDataSource(schema) {
  try {
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
      const hasEinvoiceData = await query(
        `SELECT EXISTS (
          SELECT 1 FROM "${schema}".einvoices 
          WHERE status IN ('emitida', 'autorizada', 'valid', 'AUTORIZADO', 'paid')
          LIMIT 1
        ) as has_data`,
        []
      );
      
      if (hasEinvoiceData.rows[0]?.has_data) {
        return {
          source: 'einvoicing',
          ordersTable: 'einvoices',
          customerIdField: 'customer_ruc',
          statusCondition: `status IN ('emitida', 'autorizada', 'valid', 'AUTORIZADO', 'paid')`,
          taxColumn: 'iva_amount'
        };
      }
    }
    
    return {
      source: 'pos',
      ordersTable: 'pos_orders',
      customerIdField: 'customer_id',
      statusCondition: `status = 'paid'`,
      taxColumn: 'tax_amount'
    };
  } catch (error) {
    console.error('[getDataSource] Error:', error);
    return {
      source: 'pos',
      ordersTable: 'pos_orders',
      customerIdField: 'customer_id',
      statusCondition: `status = 'paid'`,
      taxColumn: 'tax_amount'
    };
  }
}

// ─────────────────────────────────────────────────────────────
// SEGMENTOS DE CLIENTES
// ─────────────────────────────────────────────────────────────

const PREDEFINED_SEGMENTS = [
  {
    id: 'vip',
    name: 'Clientes VIP',
    description: 'Alto gasto total (≥ $300) o 10+ órdenes',
    color: '#f59e0b',
    icon: '⭐',
    filter: (c) => parseFloat(c.total_spent) >= 300 || parseInt(c.total_orders) >= 10
  },
  {
    id: 'frecuente',
    name: 'Clientes Frecuentes',
    description: 'Compran regularmente (5-9 órdenes)',
    color: '#6842fe',
    icon: '🔄',
    filter: (c) => parseInt(c.total_orders) >= 5 && parseInt(c.total_orders) < 10 && parseFloat(c.total_spent) < 300
  },
  {
    id: 'ocasional',
    name: 'Clientes Ocasionales',
    description: 'Han comprado entre 1 y 4 veces',
    color: '#3b82f6',
    icon: '🛒',
    filter: (c) => parseInt(c.total_orders) >= 1 && parseInt(c.total_orders) < 5
  },
  {
    id: 'nuevo',
    name: 'Clientes Nuevos',
    description: 'Registrados en los últimos 30 días',
    color: '#10b981',
    icon: '✨',
    filter: (c) => (Date.now() - new Date(c.created_at)) / 86400000 <= 30
  }
];

async function ensureSegmentsTable(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".crm_custom_segments (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      color VARCHAR(20) DEFAULT '#6842fe',
      conditions JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getCustomerStats(schema) {
  const result = await query(`
    SELECT
      c.id, c.name, c.email, c.phone, c.created_at,
      COUNT(o.id)::int AS total_orders,
      COALESCE(SUM(o.total), 0)::numeric AS total_spent,
      CASE WHEN COUNT(o.id) > 0 THEN COALESCE(SUM(o.total), 0) / COUNT(o.id) ELSE 0 END::numeric AS avg_ticket,
      MAX(o.created_at) AS last_purchase
    FROM "${schema}".customers c
    LEFT JOIN "${schema}".pos_orders o ON o.customer_id = c.id AND o.status = 'paid'
    GROUP BY c.id, c.name, c.email, c.phone, c.created_at
    ORDER BY total_spent DESC
  `);
  return result.rows;
}

function applyCustomConditions(customers, conds) {
  return customers.filter(c => {
    const spent = parseFloat(c.total_spent);
    const orders = parseInt(c.total_orders);
    const avgTicket = orders > 0 ? spent / orders : 0;
    const daysSinceLast = c.last_purchase ? (Date.now() - new Date(c.last_purchase)) / 86400000 : 9999;

    if (conds.min_spent && spent < parseFloat(conds.min_spent)) return false;
    if (conds.max_spent && parseFloat(conds.max_spent) > 0 && spent > parseFloat(conds.max_spent)) return false;
    if (conds.min_orders && orders < parseInt(conds.min_orders)) return false;
    if (conds.max_orders && parseInt(conds.max_orders) > 0 && orders > parseInt(conds.max_orders)) return false;
    if (conds.min_avg_ticket && avgTicket < parseFloat(conds.min_avg_ticket)) return false;
    if (conds.max_avg_ticket && parseFloat(conds.max_avg_ticket) > 0 && avgTicket > parseFloat(conds.max_avg_ticket)) return false;
    if (conds.days_inactive && daysSinceLast < parseInt(conds.days_inactive)) return false;
    if (conds.days_active && daysSinceLast > parseInt(conds.days_active)) return false;
    return true;
  });
}

// GET /api/crm/segments
router.get('/segments', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureSegmentsTable(schema);

    const customers = await getCustomerStats(schema);

    const predefined = PREDEFINED_SEGMENTS.map(seg => {
      const filtered = customers.filter(seg.filter);
      const avgSpent = filtered.length > 0
        ? filtered.reduce((s, c) => s + parseFloat(c.total_spent), 0) / filtered.length
        : 0;
      return { id: seg.id, name: seg.name, description: seg.description, color: seg.color, icon: seg.icon, count: filtered.length, avg_spent: parseFloat(avgSpent.toFixed(2)), is_custom: false };
    });

    const customResult = await query(`SELECT * FROM "${schema}".crm_custom_segments ORDER BY created_at DESC`);
    const custom = customResult.rows.map(seg => {
      const filtered = applyCustomConditions(customers, seg.conditions || {});
      const avgSpent = filtered.length > 0
        ? filtered.reduce((s, c) => s + parseFloat(c.total_spent), 0) / filtered.length
        : 0;
      return { id: seg.id, name: seg.name, description: seg.description, color: seg.color, icon: '🎯', count: filtered.length, avg_spent: parseFloat(avgSpent.toFixed(2)), is_custom: true };
    });

    res.json({ success: true, data: [...predefined, ...custom] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/crm/segments/custom
router.post('/segments/custom', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureSegmentsTable(schema);
    const { name, description, color, conditions } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, error: 'El nombre es requerido' });

    const result = await query(`
      INSERT INTO "${schema}".crm_custom_segments (name, description, color, conditions)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [name, description || '', color || '#6842fe', JSON.stringify(conditions || {})]);

    const seg = result.rows[0];
    res.status(201).json({
      success: true,
      data: { id: seg.id, name: seg.name, description: seg.description, color: seg.color, icon: '🎯', count: 0, avg_spent: 0, is_custom: true }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/segments/:segId/customers
router.get('/segments/:segId/customers', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { segId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const customers = await getCustomerStats(schema);

    let filtered;
    const predefined = PREDEFINED_SEGMENTS.find(s => s.id === segId);
    if (predefined) {
      filtered = customers.filter(predefined.filter);
    } else {
      const segResult = await query(`SELECT conditions FROM "${schema}".crm_custom_segments WHERE id=$1`, [segId]);
      if (!segResult.rows.length) return res.status(404).json({ success: false, error: 'Segmento no encontrado' });
      filtered = applyCustomConditions(customers, segResult.rows[0].conditions || {});
    }

    const total = filtered.length;
    const data = filtered.slice(offset, offset + parseInt(limit));
    res.json({ success: true, data, pagination: { page: parseInt(page), limit: parseInt(limit), total, totalPages: Math.ceil(total / parseInt(limit)) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ANALYTICS DE CRM (mejorado: soporta einvoicing y POS)
// ─────────────────────────────────────────────────────────────

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
 * Resumen general de clientes y ventas (mejorado con soporte einvoicing)
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
 * Segmentación de clientes por comportamiento (mejorado con soporte einvoicing)
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
 * Top clientes por gasto (mejorado con soporte einvoicing)
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
 * Ventas por hora del día (mejorado con soporte einvoicing)
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
 * Ventas por día de la semana (mejorado con soporte einvoicing)
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
 * Tendencia mensual de ventas (mejorado con soporte einvoicing)
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
 * Valor de vida del cliente (CLV) (mejorado con soporte einvoicing)
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

// ─────────────────────────────────────────────────────────────
// ANALYTICS DE CRM
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 1. OBTENER todas las campañas
// ─────────────────────────────────────────────────────────────
router.get('/email-campaigns', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT id, title, subject, content, is_active, sent_at, created_at, updated_at
      FROM "${schema}".email_campaigns
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 2. CREAR nueva campaña
// ─────────────────────────────────────────────────────────────
router.post('/email-campaigns', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { title, subject, content, is_active } = req.body;

    if (!title || !subject || !content) {
      return res.status(400).json({ error: 'Título, asunto y contenido son requeridos' });
    }

    const result = await query(`
      INSERT INTO "${schema}".email_campaigns (title, subject, content, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [title, subject, content, is_active !== false]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 3. ACTUALIZAR campaña existente
// ─────────────────────────────────────────────────────────────
router.put('/email-campaigns/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { title, subject, content, is_active } = req.body;

    const result = await query(`
      UPDATE "${schema}".email_campaigns
      SET title = $1, subject = $2, content = $3, is_active = $4, updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [title, subject, content, is_active, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 4. ELIMINAR campaña
// ─────────────────────────────────────────────────────────────
router.delete('/email-campaigns/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    const result = await query(`
      DELETE FROM "${schema}".email_campaigns WHERE id = $1 RETURNING id
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// 5. ENVIAR campaña a todos los clientes con email (usando Resend)
// ─────────────────────────────────────────────────────────────
router.post('/email-campaigns/:id/send', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;

    // 5.1 Obtener la campaña
    const campaignRes = await query(`
      SELECT * FROM "${schema}".email_campaigns WHERE id = $1
    `, [id]);
    if (campaignRes.rows.length === 0) {
      return res.status(404).json({ error: 'Campaña no encontrada' });
    }
    const campaign = campaignRes.rows[0];

    // 5.2 Obtener todos los clientes con email registrado
    const customersRes = await query(`
      SELECT email FROM "${schema}".customers
      WHERE email IS NOT NULL AND email != ''
    `);
    const emails = customersRes.rows.map(c => c.email);

    if (emails.length === 0) {
      return res.status(400).json({ error: 'No hay clientes con correo electrónico registrado' });
    }

    // 5.3 Obtener nombre del negocio para el remitente
    let businessName = 'Idon Plataforma';
    try {
      const settingsRes = await query(
        `SELECT trade_name, company_name FROM "${schema}".pos_settings LIMIT 1`
      );
      businessName = settingsRes.rows[0]?.trade_name || settingsRes.rows[0]?.company_name || businessName;
    } catch (_) {}

    // 5.4 Enviar campaña usando el servicio con Resend (BCC, lotes)
    const result = await sendCampaign({
      recipients: emails,
      subject: campaign.subject,
      html: campaign.content,
      batchSize: 50,
      businessName,
    });

    // 5.5 Actualizar fecha de envío de la campaña (aunque haya fallos parciales)
    await query(`
      UPDATE "${schema}".email_campaigns SET sent_at = NOW() WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      sent_count: result.sent,
      total: emails.length,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;