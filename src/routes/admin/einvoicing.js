import express from 'express';
import multer from 'multer';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import * as platformEinvoicingService from '../../services/platformEinvoicingService.js';
import { sendInvoiceEmail } from '../../services/emailService.js';
import { issuePlatformPaymentInvoice } from '../../services/platformInvoiceService.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function safeConfig(config) {
  if (!config) return null;
  const { p12_password, p12_path, p12_base64, ...safe } = config;
  return { ...safe, has_signature: Boolean(p12_base64 || p12_path) };
}

router.get('/einvoicing/config', async (req, res, next) => {
  try {
    res.json({ ok: true, data: safeConfig(await platformEinvoicingService.getPlatformEinvoicingConfig()) });
  } catch (error) {
    next(error);
  }
});

router.put('/einvoicing/config', async (req, res, next) => {
  try {
    const updated = await platformEinvoicingService.savePlatformEinvoicingConfig(req.body);
    res.json({ ok: true, data: safeConfig(updated) });
  } catch (error) {
    next(error);
  }
});

router.post('/einvoicing/config/signature', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, message: 'Se requiere el archivo .p12' });
    if (!req.body.password) return res.status(400).json({ ok: false, message: 'La contraseña de la firma es obligatoria' });

    const updated = await platformEinvoicingService.savePlatformSignature(req.file.buffer, req.body.password);
    res.json({ ok: true, data: safeConfig(updated) });
  } catch (error) {
    next(error);
  }
});

router.get('/einvoicing/invoices', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT bh.id AS billing_history_id,
             bh.billing_date,
             bh.amount,
             bh.invoice_status,
             bh.invoice_error,
             bh.customer_name,
             COALESCE(ei.customer_email, bh.customer_email) AS customer_email,
             b.name AS business_name,
             ei.id AS invoice_id,
             ei.invoice_number,
             ei.access_key,
             ei.auth_number,
             ei.customer_ruc,
             ei.total AS invoice_total,
             ei.emission_date,
             ei.status AS sri_status,
             ei.sri_message,
             ei.auth_date,
             (ei.signed_xml IS NOT NULL AND ei.signed_xml <> '') AS has_signed_xml
        FROM public.billing_history bh
        JOIN public.subscriptions s ON s.id = bh.subscription_id
        JOIN public.businesses b ON b.id = s.business_id
        LEFT JOIN public.platform_einvoices ei ON ei.billing_history_id = bh.id
       WHERE bh.status = 'paid'
         AND (ei.id IS NOT NULL OR bh.invoice_status IN ('error', 'pendiente'))
       ORDER BY bh.billing_date DESC NULLS LAST
       LIMIT 100
    `);
    res.json({ ok: true, data: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/einvoicing/payments/:billingHistoryId/emit', async (req, res, next) => {
  const { billingHistoryId } = req.params;
  try {
    const invoice = await issuePlatformPaymentInvoice(billingHistoryId);
    res.json({
      ok: true,
      data: {
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        status: invoice.status,
        billing_history_id: billingHistoryId,
      },
    });
  } catch (error) {
    logger.error({ err: error, billingHistoryId }, 'Could not issue platform payment invoice');
    await query(`
      UPDATE public.billing_history
         SET invoice_status = 'error', invoice_error = $1
       WHERE id = $2 AND status = 'paid'
    `, [error.message, billingHistoryId]).catch((updateError) => {
      logger.error({ err: updateError, billingHistoryId }, 'Could not save platform invoice error');
    });
    res.status(400).json({ ok: false, message: error.message });
  }
});

router.get('/einvoicing/invoices/:invoiceId/pdf', async (req, res, next) => {
  try {
    const pdf = await platformEinvoicingService.generatePlatformInvoicePdf(req.params.invoiceId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="factura-idon.pdf"');
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});

router.get('/einvoicing/invoices/:invoiceId/xml', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT invoice_number, signed_xml FROM public.platform_einvoices WHERE id = $1',
      [req.params.invoiceId]
    );
    const invoice = rows[0];
    if (!invoice?.signed_xml) return res.status(404).json({ ok: false, message: 'XML firmado no disponible' });
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoice_number}.xml"`);
    res.send(invoice.signed_xml);
  } catch (error) {
    next(error);
  }
});

router.post('/einvoicing/invoices/:invoiceId/email', async (req, res, next) => {
  try {
    const email = req.body.email?.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, message: 'Ingrese un correo válido' });
    }
    const { rows } = await query('SELECT * FROM public.platform_einvoices WHERE id = $1', [req.params.invoiceId]);
    const invoice = rows[0];
    if (!invoice) return res.status(404).json({ ok: false, message: 'Factura no encontrada' });
    if (invoice.status !== 'autorizada') {
      return res.status(400).json({ ok: false, message: 'Solo se pueden enviar facturas autorizadas por el SRI' });
    }
    const config = await platformEinvoicingService.getPlatformEinvoicingConfig();
    const emitterName = config?.nombre_comercial || config?.razon_social || 'IDON';
    const pdf = await platformEinvoicingService.generatePlatformInvoicePdf(invoice.id);
    await sendInvoiceEmail(invoice, pdf, email, emitterName);
    res.json({ ok: true, data: { email, invoice_number: invoice.invoice_number } });
  } catch (error) {
    next(error);
  }
});

export default router;
