import express from 'express';
import axios from 'axios';
import { sendGenericEmail } from '../services/crmEmailService.js';

const router = express.Router();

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

router.post('/enviar-link-email', async (req, res) => {
  try {
    const { amount, subscriptionId, email, businessName } = req.body;

    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'El correo del cliente es obligatorio' });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
    }
    if (subscriptionId === undefined || subscriptionId === null || String(subscriptionId).trim() === '') {
      return res.status(400).json({ error: 'La suscripción es obligatoria' });
    }
    if (!process.env.PAYPHONE_TOKEN || !process.env.PAYPHONE_STORE_ID) {
      throw new Error('Falta configurar PAYPHONE_TOKEN o PAYPHONE_STORE_ID');
    }

    const amountInCents = Math.round(parsedAmount * 100);
    const response = await axios.post(
      'https://pay.payphonetodoesposible.com/api/button/Prepare',
      {
        amount: amountInCents,
        amountWithoutTax: amountInCents,
        amountWithTax: 0,
        tax: 0,
        clientTransactionId: `SUB-${subscriptionId}-${Date.now()}`,
        currency: 'USD',
        storeId: process.env.PAYPHONE_STORE_ID,
        reference: `Suscripción ${businessName || ''}`.trim(),
        expireInMinutes: 1440,
        responseUrl: 'https://www.idonplataform.site/pago-completado',
        cancellationUrl: 'https://www.idonplataform.site/pago-cancelado',
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYPHONE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const paymentUrl = response.data?.payWithPayPhone || response.data?.payWithCard;
    if (typeof paymentUrl !== 'string') {
      throw new Error('PayPhone no devolvió un enlace de pago');
    }

    const parsedPaymentUrl = new URL(paymentUrl);
    if (!['http:', 'https:'].includes(parsedPaymentUrl.protocol)) {
      throw new Error('PayPhone devolvió un enlace de pago no válido');
    }

    const safeBusinessName = escapeHtml(businessName || 'tu negocio');
    const safePaymentUrl = escapeHtml(parsedPaymentUrl.toString());
    const html = `
      <!DOCTYPE html>
      <html lang="es">
        <body style="font-family:Arial,sans-serif;color:#222;line-height:1.6;max-width:600px;margin:0 auto;padding:24px;">
          <h2>Acción requerida: link de pago para tu suscripción</h2>
          <p>Hola,</p>
          <p>La suscripción de <strong>${safeBusinessName}</strong> tiene un pago pendiente.</p>
          <p><strong>Monto a pagar:</strong> $${parsedAmount.toFixed(2)} USD</p>
          <p style="text-align:center;margin:32px 0;">
            <a href="${safePaymentUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:16px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">
              Pagar ahora
            </a>
          </p>
          <p>Este enlace vence en 24 horas.</p>
          <p style="font-size:12px;color:#666;">Si el botón no funciona, copia y pega este enlace en tu navegador: <a href="${safePaymentUrl}">${safePaymentUrl}</a></p>
        </body>
      </html>
    `;

    await sendGenericEmail({
      to: email.trim(),
      subject: 'Acción requerida: Link de pago para tu suscripción',
      html,
      businessName: 'IDON PLATAFORM',
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error generando o enviando el link de pago PayPhone:', error.response?.data || error);
    return res.status(500).json({ error: 'No se pudo generar el link o enviar el correo' });
  }
});

export default router;
