import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendCampaign } from '../services/crmEmailService.js';

const router = express.Router();

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
// ANALYTICS DE CRM
// ─────────────────────────────────────────────────────────────

// GET /api/crm/analytics/summary
router.get('/analytics/summary', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT
        COUNT(DISTINCT c.id) AS total_customers,
        COUNT(DISTINCT CASE WHEN c.is_active THEN c.id END) AS active_customers,
        COUNT(DISTINCT CASE WHEN c.created_at >= NOW() - INTERVAL '30 days' THEN c.id END) AS new_this_month,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        CASE WHEN COUNT(o.id) > 0 THEN COALESCE(SUM(o.total), 0) / COUNT(o.id) ELSE 0 END AS avg_ticket
      FROM "${schema}".customers c
      LEFT JOIN "${schema}".pos_orders o ON o.customer_id = c.id AND o.status = 'paid'
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/customer-segments
router.get('/analytics/customer-segments', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const customers = await getCustomerStats(schema);
    const segments = PREDEFINED_SEGMENTS.map(seg => ({
      name: seg.name,
      count: customers.filter(seg.filter).length,
      color: seg.color
    }));
    res.json({ success: true, data: segments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/top-customers
router.get('/analytics/top-customers', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { limit = 10 } = req.query;
    const result = await query(`
      SELECT
        c.id, c.name, c.email, c.phone,
        COUNT(o.id)::int AS total_orders,
        COALESCE(SUM(o.total), 0)::numeric AS total_spent,
        MAX(o.created_at) AS last_purchase
      FROM "${schema}".customers c
      JOIN "${schema}".pos_orders o ON o.customer_id = c.id AND o.status = 'paid'
      GROUP BY c.id, c.name, c.email, c.phone
      ORDER BY total_spent DESC
      LIMIT $1
    `, [parseInt(limit)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/sales-by-hour
router.get('/analytics/sales-by-hour', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT
        EXTRACT(HOUR FROM created_at)::int AS hour,
        COUNT(*)::int AS orders,
        COALESCE(SUM(total), 0)::numeric AS revenue
      FROM "${schema}".pos_orders
      WHERE status = 'paid' AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY hour
      ORDER BY hour
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/sales-by-day
router.get('/analytics/sales-by-day', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT
        EXTRACT(DOW FROM created_at)::int AS day_of_week,
        TO_CHAR(created_at, 'Day') AS day_name,
        COUNT(*)::int AS orders,
        COALESCE(SUM(total), 0)::numeric AS revenue
      FROM "${schema}".pos_orders
      WHERE status = 'paid' AND created_at >= NOW() - INTERVAL '90 days'
      GROUP BY day_of_week, day_name
      ORDER BY day_of_week
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/monthly-trend
router.get('/analytics/monthly-trend', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { months = 6 } = req.query;
    const result = await query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(DISTINCT customer_id)::int AS unique_customers,
        COUNT(*)::int AS total_orders,
        COALESCE(SUM(total), 0)::numeric AS revenue
      FROM "${schema}".pos_orders
      WHERE status = 'paid'
        AND created_at >= DATE_TRUNC('month', NOW()) - ($1::int - 1) * INTERVAL '1 month'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY DATE_TRUNC('month', created_at)
    `, [parseInt(months)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/crm/analytics/customer-lifetime-value
router.get('/analytics/customer-lifetime-value', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT
        AVG(total_spent)::numeric AS avg_clv,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_spent)::numeric AS median_clv,
        MAX(total_spent)::numeric AS max_clv,
        MIN(CASE WHEN total_spent > 0 THEN total_spent END)::numeric AS min_clv
      FROM (
        SELECT c.id, COALESCE(SUM(o.total), 0) AS total_spent
        FROM "${schema}".customers c
        LEFT JOIN "${schema}".pos_orders o ON o.customer_id = c.id AND o.status = 'paid'
        GROUP BY c.id
      ) sub
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

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

    // 5.3 Enviar campaña usando el servicio con Resend (BCC, lotes)
    const result = await sendCampaign({
      recipients: emails,
      subject: campaign.subject,
      html: campaign.content,
      batchSize: 50,   // Resend permite hasta 50 en BCC
    });

    // 5.4 Actualizar fecha de envío de la campaña (aunque haya fallos parciales)
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