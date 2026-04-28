import { Resend } from 'resend';
import logger from '../utils/logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM   = process.env.FROM_EMAIL || 'Facturación <onboarding@resend.dev>';

/**
 * Envía el RIDE (PDF) de una factura autorizada al correo del cliente.
 * @param {object} inv   - Fila de einvoices (invoice_number, customer_name, total, etc.)
 * @param {Buffer} pdfBuf - PDF generado por generateInvoicePdf
 * @param {string} to     - Email destino
 * @param {string} businessName - Nombre comercial del emisor
 */
export async function sendInvoiceEmail(inv, pdfBuf, to, businessName) {
  const subject = `Factura Electrónica ${inv.invoice_number} — ${businessName}`;
  const total   = parseFloat(inv.total || 0).toFixed(2);

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
      <div style="background:#ff8c42;padding:24px 28px;border-radius:10px 10px 0 0">
        <h2 style="color:#fff;margin:0;font-size:20px">${businessName}</h2>
        <p style="color:#e0d9ff;margin:4px 0 0;font-size:13px">Factura Electrónica Autorizada</p>
      </div>
      <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
        <p style="margin:0 0 8px">Estimado/a <strong>${inv.customer_name}</strong>,</p>
        <p style="margin:0 0 20px;color:#475569;font-size:14px">
          Se adjunta su factura electrónica autorizada por el SRI.
        </p>
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          <tr>
            <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;color:#64748b">N° Factura</td>
            <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;font-weight:700;color:#6842fe">${inv.invoice_number}</td>
          </tr>
          <tr>
            <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b">RUC / CI</td>
            <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0">${inv.customer_ruc || '—'}</td>
          </tr>
          <tr>
            <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;color:#64748b">Total</td>
            <td style="padding:7px 10px;background:#fff;border:1px solid #e2e8f0;font-weight:800;color:#059669">$${total}</td>
          </tr>
          <tr>
            <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#64748b">Estado SRI</td>
            <td style="padding:7px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#15803d;font-weight:700">✓ Autorizada</td>
          </tr>
        </table>
        <p style="margin:20px 0 4px;font-size:12px;color:#94a3b8">
          El archivo PDF adjunto es el Comprobante de Retención / RIDE oficial.
        </p>
        <p style="margin:0;font-size:11px;color:#cbd5e1">
          Clave de acceso: ${inv.access_key || inv.auth_number || '—'}
        </p>
      </div>
    </div>`;

  const { data, error } = await resend.emails.send({
    from:        FROM,
    to:          [to],
    subject,
    html,
    attachments: [{
      filename: `FACTURA-${inv.invoice_number}.pdf`,
      content:  pdfBuf.toString('base64'),
    }],
  });

  if (error) {
    logger.error({ err: error }, 'Resend email error');
    throw new Error(error.message || 'Error al enviar correo');
  }

  logger.info({ emailId: data?.id, to, invoice: inv.invoice_number }, 'Invoice email sent');
  return data;
}
