/**
 * einvoicing.js
 * Routes for SRI Ecuador electronic invoicing.
 *
 * All routes require:
 *   Authorization: Bearer <token>
 *   X-DB-Name: <tenant_schema>
 */
import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { query } from '../config/database.js';
import * as svc from '../services/einvoicingService.js';
import { sendInvoiceEmail } from '../services/emailService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

export async function getIvaRate() {
  try {
    const { rows } = await query(`
      SELECT iva_rate FROM public.fiscal_config WHERE is_active = true LIMIT 1
    `);
    
    if (rows.length > 0 && rows[0].iva_rate) {
      return parseFloat(rows[0].iva_rate);
    }
    return 15.00; // Valor por defecto
  } catch (err) {
    console.error('Error al obtener tasa de IVA:', err);
    return 15.00;
  }
}

// ── Verifica que el negocio tenga el módulo 'invoicing' activo ────────────────
async function requireInvoicingModule(req, res, next) {
  try {
    const businessId = req.user?.businessId;
    if (!businessId) return res.status(401).json({ error: 'Business context required' });

    const { rows } = await query(
      `SELECT bm.is_active
         FROM public.business_modules bm
         JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND m.code = 'einvoicing' AND bm.is_active = true
        LIMIT 1`,
      [businessId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: 'El módulo de facturación electrónica no está activo para este negocio' });
    }

    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── GET /api/einvoicing/config ────────────────────────────────────────────────
router.get('/config', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const cfg = await svc.getConfig(schema);
    if (!cfg) return res.json({});
    // Never expose password, file path, or raw certificate bytes
    const { p12_password, p12_path, p12_base64, ...safe } = cfg;
    res.json({ ...safe, has_signature: !!(p12_base64 || p12_path) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/einvoicing/config ────────────────────────────────────────────────
router.put('/config', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const updated = await svc.saveConfig(schema, req.body);
    const { p12_password, p12_path, p12_base64, ...safe } = updated;
    res.json({ ...safe, has_signature: !!(p12_base64 || p12_path) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/config/logo ─────────────────────────────────────────
// multipart/form-data: file=imagen (jpg/png/svg)
router.post('/config/logo', authMiddleware, requireInvoicingModule, upload.single('file'), async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    if (!req.file) return res.status(400).json({ error: 'Se requiere una imagen' });

    const logoUrl = await svc.uploadLogo(schema, req.file.buffer);
    res.json({ logo_url: logoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/config/signature ─────────────────────────────────────
// multipart/form-data: file=firma.p12, password=xxx, (optionally config fields)
router.post('/config/signature', authMiddleware, requireInvoicingModule, upload.single('file'), async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    if (!req.file) return res.status(400).json({ error: 'Se requiere el archivo .p12' });

    const filePath = await svc.saveSignatureFile(schema, req.file.buffer);
    const updated = await svc.saveConfig(schema, {
      p12_path: filePath || undefined,
      p12_password: req.body.password || '',
      ruc: req.body.ruc,
      razon_social: req.body.razon_social,
      nombre_comercial: req.body.nombre_comercial,
      direccion_matriz: req.body.direccion_matriz,
      ambiente: req.body.ambiente,
    });
    const { p12_password, p12_path, p12_base64, ...safe } = updated;
    res.json({ ...safe, has_signature: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/invoices/by-order/:orderId ────────────────────────────
router.get('/invoices/by-order/:orderId', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { rows } = await query(
      `SELECT invoice_number FROM "${schema}".einvoices
        WHERE order_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [req.params.orderId]
    );
    res.json(rows[0] || null);
  } catch {
    res.json(null);
  }
});

// ── GET /api/einvoicing/invoices ──────────────────────────────────────────────
router.get('/invoices', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const invoices = await svc.listInvoices(schema, req.query);
    res.json(invoices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/invoices/emit ────────────────────────────────────────
// Body: { order_id?, customer, items, subtotal, iva_rate, iva_amount, total, forma_pago? }
router.post('/invoices/emit', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const invoice = await svc.emitInvoice(schema, req.body);
    res.status(201).json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/invoices/:id/resend ──────────────────────────────────
router.post('/invoices/:id/resend', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const invoice = await svc.resendInvoice(schema, req.params.id);
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/invoices/:id/pdf ──────────────────────────────────────
router.get('/invoices/:id/pdf', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const pdfBuffer = await svc.generateInvoicePdf(schema, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${req.params.id}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/invoices/:id/xml ──────────────────────────────────────
router.get('/invoices/:id/xml', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { query: dbQuery } = await import('../config/database.js');
    const { rows } = await dbQuery(
      `SELECT invoice_number, signed_xml FROM "${schema}".einvoices WHERE id = $1`,
      [req.params.id]
    );
    if (!rows[0] || !rows[0].signed_xml) return res.status(404).json({ error: 'XML no disponible' });

    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].invoice_number}.xml"`);
    res.send(rows[0].signed_xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/invoices/:id/email ───────────────────────────────────
// Body: { email: "cliente@ejemplo.com" }
router.post('/invoices/:id/email', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requerido' });

    const { rows } = await query(
      `SELECT * FROM "${schema}".einvoices WHERE id = $1`, [req.params.id]
    );
    const inv = rows[0];
    if (!inv) return res.status(404).json({ error: 'Factura no encontrada' });
    if (inv.status !== 'autorizada') return res.status(400).json({ error: 'Solo se pueden enviar por correo facturas autorizadas' });

    const cfg    = await svc.getConfig(schema);
    const bizName = cfg?.nombre_comercial || cfg?.razon_social || 'Empresa';
    const pdfBuf = await svc.generateInvoicePdf(schema, req.params.id);
    await sendInvoiceEmail(inv, pdfBuf, email.trim(), bizName);

    res.json({ ok: true, email: email.trim(), invoice_number: inv.invoice_number });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREDIT NOTES ─────────────────────────────────────────────────────────────

async function ensureCreditNotesTable(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS "${schema}".credit_notes (
      id SERIAL PRIMARY KEY,
      invoice_id UUID,
      reference_invoice VARCHAR(50),
      reason TEXT NOT NULL,
      items JSONB DEFAULT '[]',
      subtotal NUMERIC(10,2) DEFAULT 0,
      iva_amount NUMERIC(10,2) DEFAULT 0,
      discount_amount NUMERIC(10,2) DEFAULT 0,
      total NUMERIC(10,2) DEFAULT 0,
      customer_name VARCHAR(255),
      customer_ruc VARCHAR(20),
      customer_email VARCHAR(255),
      status VARCHAR(20) DEFAULT 'emitida',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// GET /api/einvoicing/credit-notes
router.get('/credit-notes', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureCreditNotesTable(schema);
    const result = await query(`
      SELECT cn.*, ei.invoice_number
      FROM "${schema}".credit_notes cn
      LEFT JOIN "${schema}".einvoices ei ON ei.id = cn.invoice_id
      ORDER BY cn.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/einvoicing/credit-notes
router.post('/credit-notes', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureCreditNotesTable(schema);
    const {
      invoice_id, reason, items, subtotal, iva_amount, discount_amount, total,
      customer_name, customer_ruc, customer_email, reference_invoice
    } = req.body;

    if (!reason?.trim()) return res.status(400).json({ error: 'Motivo es requerido' });

    const result = await query(`
      INSERT INTO "${schema}".credit_notes
        (invoice_id, reference_invoice, reason, items, subtotal, iva_amount, discount_amount, total,
         customer_name, customer_ruc, customer_email, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'emitida')
      RETURNING *
    `, [
      invoice_id || null, reference_invoice || null, reason,
      JSON.stringify(items || []),
      subtotal || 0, iva_amount || 0, discount_amount || 0, total || 0,
      customer_name || null, customer_ruc || null, customer_email || null
    ]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/einvoicing/credit-notes/:id/pdf — retorna PDF simple
router.get('/credit-notes/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const result = await query(`SELECT * FROM "${schema}".credit_notes WHERE id=$1`, [id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Nota de crédito no encontrada' });

    const cn = result.rows[0];
    const html = `
      <html><body style="font-family:Arial;padding:20px">
        <h2>Nota de Crédito</h2>
        <p><b>Factura referida:</b> ${cn.reference_invoice || '-'}</p>
        <p><b>Motivo:</b> ${cn.reason}</p>
        <p><b>Cliente:</b> ${cn.customer_name || '-'} | RUC: ${cn.customer_ruc || '-'}</p>
        <p><b>Subtotal:</b> $${parseFloat(cn.subtotal).toFixed(2)}</p>
        <p><b>IVA:</b> $${parseFloat(cn.iva_amount).toFixed(2)}</p>
        <p><b>Total:</b> $${parseFloat(cn.total).toFixed(2)}</p>
        <p><b>Estado:</b> ${cn.status}</p>
        <p><b>Fecha:</b> ${new Date(cn.created_at).toLocaleDateString('es-EC')}</p>
      </body></html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
