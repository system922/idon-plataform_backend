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


// GET /api/einvoicing/invoices/:id
router.get('/invoices/:id', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { rows } = await query(
      `SELECT id, invoice_number, access_key, auth_number,
              customer_id, customer_name, customer_ruc, customer_email, customer_phone,
              subtotal, iva_amount, total, discount_amount, items,
              COALESCE(credited_amount, 0) AS credited_amount,
              status, sri_message, sri_json,
              emission_date, auth_date, created_at,
              (signed_xml IS NOT NULL AND signed_xml <> '') AS has_signed_xml
         FROM "${schema}".einvoices
         WHERE id = $1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }

    res.json(rows[0]);
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
      remaining_balance NUMERIC(10,2) DEFAULT 0,
      customer_name VARCHAR(255),
      customer_ruc VARCHAR(20),
      customer_email VARCHAR(255),
      status VARCHAR(20) DEFAULT 'emitida',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE IF EXISTS "${schema}".credit_notes ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC(10,2) DEFAULT 0`);
  // Back-fill solo notas emitidas que nunca tuvieron remaining_balance inicializado
  await query(`UPDATE "${schema}".credit_notes SET remaining_balance = total WHERE remaining_balance = 0 AND total > 0 AND status NOT IN ('utilizada', 'anulada')`);
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

    // Ensure credited_amount column exists on einvoices
    await query(`
      ALTER TABLE IF EXISTS "${schema}".einvoices
        ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(10,2) DEFAULT 0
    `).catch(() => {});

    const creditedTotal = parseFloat(total) || 0;

    const result = await query(`
      INSERT INTO "${schema}".credit_notes
        (invoice_id, reference_invoice, reason, items, subtotal, iva_amount, discount_amount, total,
         remaining_balance, customer_name, customer_ruc, customer_email, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'emitida')
      RETURNING *
    `, [
      invoice_id || null, reference_invoice || null, reason,
      JSON.stringify(items || []),
      subtotal || 0, iva_amount || 0, discount_amount || 0, creditedTotal, creditedTotal,
      customer_name || null, customer_ruc || null, customer_email || null
    ]);

    // Update invoice credited_amount and mark as anulada if fully credited
    if (invoice_id) {
      await query(`
        UPDATE "${schema}".einvoices
           SET credited_amount = COALESCE(credited_amount, 0) + $1,
               status = CASE
                 WHEN COALESCE(credited_amount, 0) + $1 >= total THEN 'anulada'
                 ELSE status
               END
         WHERE id = $2
      `, [creditedTotal, invoice_id]);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/einvoicing/credit-notes/available?customer_ruc=RUC&customer_name=NAME
// Solo notas de crédito del cliente exacto con saldo disponible
router.get('/credit-notes/available', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureCreditNotesTable(schema);
    const { customer_ruc, customer_name } = req.query;

    const hasRuc  = customer_ruc && customer_ruc !== '9999999999';
    const hasName = customer_name && customer_name.trim().length > 0;

    // Sin datos del cliente no se devuelve nada
    if (!hasRuc && !hasName) return res.json([]);

    const params = [];
    const conditions = ["remaining_balance > 0", "status NOT IN ('utilizada', 'anulada')"];

    if (hasRuc) {
      params.push(customer_ruc.trim());
      conditions.push(`customer_ruc = $${params.length}`);
    }
    if (hasName) {
      params.push(customer_name.trim());
      conditions.push(`LOWER(customer_name) = LOWER($${params.length})`);
    }

    const { rows } = await query(
      `SELECT id, reference_invoice, reason, total, remaining_balance, customer_name, customer_ruc, created_at
         FROM "${schema}".credit_notes
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT 20`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/einvoicing/credit-notes/:id/apply  { amount }
// Aplica (consume) saldo de una nota de crédito como forma de pago
router.post('/credit-notes/:id/apply', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    await ensureCreditNotesTable(schema);
    const { id } = req.params;
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });

    const { rows } = await query(
      `SELECT id, remaining_balance FROM "${schema}".credit_notes WHERE id = $1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Nota de crédito no encontrada' });

    const cn = rows[0];
    const balance = parseFloat(cn.remaining_balance);
    if (amount > balance + 0.01) {
      return res.status(400).json({ error: `Saldo insuficiente. Disponible: $${balance.toFixed(2)}` });
    }

    const newBalance = Math.max(0, balance - amount);
    const { rows: updated } = await query(
      `UPDATE "${schema}".credit_notes
          SET remaining_balance = $1::numeric,
              status = CASE WHEN $1::numeric <= 0 THEN 'utilizada' ELSE status END
        WHERE id = $2
        RETURNING *`,
      [newBalance, id]
    );
    res.json(updated[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/einvoicing/credit-notes/:id/pdf
router.get('/credit-notes/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const pdfBuf = await svc.generateCreditNotePdf(schema, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="nota_credito_${req.params.id}.pdf"`);
    res.send(pdfBuf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/debit-notes ──────────────────────────────────────────
router.get('/debit-notes', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    await query(`
      CREATE TABLE IF NOT EXISTS "${schema}".debit_notes (
        id                 SERIAL PRIMARY KEY,
        invoice_id         UUID,
        reference_invoice  VARCHAR(50),
        debit_note_number  VARCHAR(50),
        reason             TEXT NOT NULL,
        additional_value   NUMERIC(10,2) DEFAULT 0,
        interest_value     NUMERIC(10,2) DEFAULT 0,
        subtotal           NUMERIC(10,2) DEFAULT 0,
        iva_amount         NUMERIC(10,2) DEFAULT 0,
        total              NUMERIC(10,2) DEFAULT 0,
        customer_name      VARCHAR(255),
        customer_ruc       VARCHAR(20),
        customer_email     VARCHAR(255),
        status             VARCHAR(20)   DEFAULT 'pendiente',
        auth_number        VARCHAR(100),
        signed_xml         TEXT,
        created_at         TIMESTAMPTZ   DEFAULT NOW()
      )
    `);

    const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const { rows } = await query(
      `SELECT * FROM "${schema}".debit_notes ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/debit-notes ─────────────────────────────────────────
router.post('/debit-notes', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const {
      invoice_id, reference_invoice, reason,
      additional_value, interest_value, subtotal, iva_amount, total,
      customer_name, customer_ruc, customer_email,
    } = req.body;

    if (!reason?.trim()) return res.status(400).json({ error: 'El motivo es requerido' });

    // Generar número secuencial
    const { rows: countRows } = await query(
      `SELECT COUNT(*) FROM "${schema}".debit_notes`
    );
    const seq = String(parseInt(countRows[0].count) + 1).padStart(9, '0');
    const debitNoteNumber = `001-001-${seq}`;

    const { rows } = await query(
      `INSERT INTO "${schema}".debit_notes
         (invoice_id, reference_invoice, debit_note_number, reason,
          additional_value, interest_value, subtotal, iva_amount, total,
          customer_name, customer_ruc, customer_email, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pendiente')
       RETURNING *`,
      [
        invoice_id || null, reference_invoice || null, debitNoteNumber, reason,
        parseFloat(additional_value) || 0, parseFloat(interest_value) || 0,
        parseFloat(subtotal) || 0, parseFloat(iva_amount) || 0, parseFloat(total) || 0,
        customer_name || null, customer_ruc || null, customer_email || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/debit-notes/:id/pdf ───────────────────────────────────
router.get('/debit-notes/:id/pdf', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { rows } = await query(`SELECT * FROM "${schema}".debit_notes WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Nota de débito no encontrada' });
    const n = rows[0];
    const html = `
      <html><body style="font-family:Arial;padding:20px">
        <h2>Nota de Débito</h2>
        <p><b>Número:</b> ${n.debit_note_number || '-'}</p>
        <p><b>Factura referida:</b> ${n.reference_invoice || '-'}</p>
        <p><b>Motivo:</b> ${n.reason}</p>
        <p><b>Cliente:</b> ${n.customer_name || '-'} | RUC: ${n.customer_ruc || '-'}</p>
        <p><b>Valor adicional:</b> $${parseFloat(n.additional_value).toFixed(2)}</p>
        <p><b>Interés:</b> $${parseFloat(n.interest_value).toFixed(2)}</p>
        <p><b>Subtotal:</b> $${parseFloat(n.subtotal).toFixed(2)}</p>
        <p><b>IVA:</b> $${parseFloat(n.iva_amount).toFixed(2)}</p>
        <p><b>Total:</b> $${parseFloat(n.total).toFixed(2)}</p>
        <p><b>Estado:</b> ${n.status}</p>
        <p><b>Fecha:</b> ${new Date(n.created_at).toLocaleDateString('es-EC')}</p>
      </body></html>
    `;
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/void ──────────────────────────────────────────────────
router.get('/void', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    await query(`
      CREATE TABLE IF NOT EXISTS "${schema}".einvoice_voids (
        id            SERIAL PRIMARY KEY,
        invoice_id    UUID,
        invoice_number VARCHAR(50),
        customer_name  VARCHAR(255),
        customer_ruc   VARCHAR(20),
        reason         TEXT,
        total          NUMERIC(10,2) DEFAULT 0,
        status         VARCHAR(20)   DEFAULT 'pendiente',
        auth_number    VARCHAR(100),
        void_date      DATE          DEFAULT CURRENT_DATE,
        created_at     TIMESTAMPTZ   DEFAULT NOW()
      )
    `);

    const { rows } = await query(
      `SELECT * FROM "${schema}".einvoice_voids ORDER BY void_date DESC, created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/void ─────────────────────────────────────────────────
router.post('/void', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { invoice_id, invoice_number, customer_name, customer_ruc, reason, total, void_date } = req.body;
    if (!invoice_number || !reason) return res.status(400).json({ error: 'N° comprobante y motivo son requeridos' });

    const { rows } = await query(
      `INSERT INTO "${schema}".einvoice_voids
         (invoice_id, invoice_number, customer_name, customer_ruc, reason, total, void_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pendiente') RETURNING *`,
      [invoice_id || null, invoice_number, customer_name || null, customer_ruc || null,
       reason, parseFloat(total) || 0, void_date || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/remissions ────────────────────────────────────────────
router.get('/remissions', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    await query(`
      CREATE TABLE IF NOT EXISTS "${schema}".einvoice_remissions (
        id                  SERIAL PRIMARY KEY,
        number              VARCHAR(50),
        emission_date       DATE          DEFAULT CURRENT_DATE,
        destinatario        VARCHAR(255),
        ruc_destinatario    VARCHAR(20),
        direccion_destino   VARCHAR(500),
        transportista       VARCHAR(255),
        ruc_transportista   VARCHAR(20),
        placa               VARCHAR(20),
        signed_xml          TEXT,
        auth_number         VARCHAR(100),
        status              VARCHAR(20)   DEFAULT 'pendiente',
        created_at          TIMESTAMPTZ   DEFAULT NOW()
      )
    `);

    const { rows } = await query(
      `SELECT * FROM "${schema}".einvoice_remissions ORDER BY emission_date DESC, created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/reports ───────────────────────────────────────────────
router.get('/reports', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    await query(`
      CREATE TABLE IF NOT EXISTS "${schema}".einvoice_reports (
        id               SERIAL PRIMARY KEY,
        name             VARCHAR(255),
        type             VARCHAR(50)  DEFAULT 'general',
        period           VARCHAR(20),
        total_vouchers   INTEGER      DEFAULT 0,
        file_url         TEXT,
        status           VARCHAR(20)  DEFAULT 'pendiente',
        generated_at     TIMESTAMPTZ  DEFAULT NOW(),
        created_at       TIMESTAMPTZ  DEFAULT NOW()
      )
    `);

    const { rows } = await query(
      `SELECT * FROM "${schema}".einvoice_reports ORDER BY generated_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/einvoicing/retentions ────────────────────────────────────────────
router.get('/retentions', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const limit  = Math.min(parseInt(req.query.limit)  || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    await query(`
      CREATE TABLE IF NOT EXISTS "${schema}".einvoice_retentions (
        id               SERIAL PRIMARY KEY,
        number           VARCHAR(50),
        emission_date    DATE          DEFAULT CURRENT_DATE,
        supplier_name    VARCHAR(255),
        supplier_ruc     VARCHAR(20),
        invoice_ref      VARCHAR(50),
        base_imponible   NUMERIC(10,2) DEFAULT 0,
        total_retenido   NUMERIC(10,2) DEFAULT 0,
        detalles         JSONB         DEFAULT '[]',
        signed_xml       TEXT,
        auth_number      VARCHAR(100),
        status           VARCHAR(20)   DEFAULT 'pendiente',
        created_at       TIMESTAMPTZ   DEFAULT NOW()
      )
    `);

    const { rows } = await query(
      `SELECT * FROM "${schema}".einvoice_retentions ORDER BY emission_date DESC, created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/einvoicing/retentions ───────────────────────────────────────────
router.post('/retentions', authMiddleware, requireInvoicingModule, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { number, emission_date, supplier_name, supplier_ruc, invoice_ref,
            base_imponible, total_retenido, detalles } = req.body;
    if (!number) return res.status(400).json({ error: 'N° retención es requerido' });

    const { rows } = await query(
      `INSERT INTO "${schema}".einvoice_retentions
         (number, emission_date, supplier_name, supplier_ruc, invoice_ref,
          base_imponible, total_retenido, detalles, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendiente') RETURNING *`,
      [number, emission_date || null, supplier_name || null, supplier_ruc || null,
       invoice_ref || null, parseFloat(base_imponible) || 0, parseFloat(total_retenido) || 0,
       JSON.stringify(detalles || [])]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


export default router;
