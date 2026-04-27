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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
    // Never expose password or file path
    const { p12_password, p12_path, ...safe } = cfg;
    res.json({ ...safe, has_signature: !!p12_path });
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
    const { p12_password, p12_path, ...safe } = updated;
    res.json({ ...safe, has_signature: !!p12_path });
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
      p12_path: filePath,
      p12_password: req.body.password || '',
      ruc: req.body.ruc,
      razon_social: req.body.razon_social,
      nombre_comercial: req.body.nombre_comercial,
      direccion_matriz: req.body.direccion_matriz,
      ambiente: req.body.ambiente,
    });
    const { p12_password, p12_path, ...safe } = updated;
    res.json({ ...safe, has_signature: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// ── POST /api/einvoicing/invoices/:id/whatsapp ────────────────────────────────
router.post('/invoices/:id/whatsapp', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Número de teléfono requerido' });
    const inv = await svc.sendInvoiceWhatsapp(schema, req.params.id, phone);
    res.json({ ok: true, invoice_number: inv.invoice_number });
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

export default router;
