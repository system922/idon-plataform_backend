import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendCampaign, sendGenericEmail } from '../services/crmEmailService.js';

const router = express.Router();

async function ensureTables(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".email_templates (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      subject VARCHAR(500) NOT NULL,
      body TEXT NOT NULL,
      category VARCHAR(50) DEFAULT 'general',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".email_logs (
      id SERIAL PRIMARY KEY,
      template_id INTEGER,
      recipient VARCHAR(500),
      recipients JSONB,
      subject VARCHAR(500),
      type VARCHAR(20) DEFAULT 'single',
      status VARCHAR(20) DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      error_message TEXT,
      invoice_id INTEGER,
      invoice_number VARCHAR(100),
      recipient_count INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// GET /api/notifications/email/templates
router.get('/email/templates', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureTables(schema);
    const result = await query(`SELECT * FROM "${schema}".email_templates ORDER BY created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/email/templates
router.post('/email/templates', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureTables(schema);
    const { name, subject, body, category, is_active } = req.body;
    if (!name?.trim() || !subject?.trim() || !body?.trim()) {
      return res.status(400).json({ success: false, error: 'Nombre, asunto y contenido son requeridos' });
    }
    const result = await query(`
      INSERT INTO "${schema}".email_templates (name, subject, body, category, is_active)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [name, subject, body, category || 'general', is_active !== false]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/notifications/email/templates/:id
router.put('/email/templates/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { name, subject, body, category, is_active } = req.body;
    const result = await query(`
      UPDATE "${schema}".email_templates
      SET name=$1, subject=$2, body=$3, category=$4, is_active=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [name, subject, body, category || 'general', is_active !== false, id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/notifications/email/templates/:id
router.delete('/email/templates/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const result = await query(`DELETE FROM "${schema}".email_templates WHERE id=$1 RETURNING id`, [id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/notifications/email/templates/:id/toggle
router.patch('/email/templates/:id/toggle', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { is_active } = req.body;
    const result = await query(`
      UPDATE "${schema}".email_templates SET is_active=$1, updated_at=NOW() WHERE id=$2 RETURNING *
    `, [is_active, id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/email/templates/:id/duplicate
router.post('/email/templates/:id/duplicate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const orig = await query(`SELECT * FROM "${schema}".email_templates WHERE id=$1`, [id]);
    if (!orig.rows.length) return res.status(404).json({ success: false, error: 'Plantilla no encontrada' });
    const t = orig.rows[0];
    const result = await query(`
      INSERT INTO "${schema}".email_templates (name, subject, body, category, is_active)
      VALUES ($1, $2, $3, $4, false) RETURNING *
    `, [`${t.name} (copia)`, t.subject, t.body, t.category]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/notifications/email/logs
router.get('/email/logs', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureTables(schema);
    const { limit = 100 } = req.query;
    const result = await query(`
      SELECT * FROM "${schema}".email_logs ORDER BY created_at DESC LIMIT $1
    `, [parseInt(limit)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/notifications/email/send
router.post('/email/send', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureTables(schema);
    const { to, recipients, subject, html, invoice_id } = req.body;

    if (recipients && Array.isArray(recipients)) {
      try {
        const result = await sendCampaign({ recipients, subject, html });
        await query(`
          INSERT INTO "${schema}".email_logs (recipients, subject, type, status, sent_at, recipient_count)
          VALUES ($1, $2, 'campaign', $3, NOW(), $4)
        `, [JSON.stringify(recipients), subject, result.failed === 0 ? 'sent' : 'failed', recipients.length]);
        res.json({ success: true, sent: result.sent, failed: result.failed });
      } catch (err) {
        await query(`
          INSERT INTO "${schema}".email_logs (recipients, subject, type, status, error_message, recipient_count)
          VALUES ($1, $2, 'campaign', 'failed', $3, $4)
        `, [JSON.stringify(recipients), subject, err.message, recipients.length]);
        throw err;
      }
    } else {
      if (!to) return res.status(400).json({ success: false, error: 'Destinatario requerido' });
      try {
        await sendGenericEmail({ to, subject, html });
        await query(`
          INSERT INTO "${schema}".email_logs (recipient, subject, type, status, sent_at, invoice_id)
          VALUES ($1, $2, 'single', 'sent', NOW(), $3)
        `, [to, subject, invoice_id || null]);
        res.json({ success: true, sent: 1 });
      } catch (err) {
        await query(`
          INSERT INTO "${schema}".email_logs (recipient, subject, type, status, error_message)
          VALUES ($1, $2, 'single', 'failed', $3)
        `, [to, subject, err.message]);
        throw err;
      }
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
