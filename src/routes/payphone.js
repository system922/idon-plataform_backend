import express from 'express';
import axios from 'axios';
import { query } from '../config/database.js';
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
    const { amount, subscriptionId, businessId, email, businessName } = req.body;

    const recipientEmail = typeof email === 'string' ? email.trim() : '';
    if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return res.status(400).json({ error: 'El correo del cliente no es válido' });
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'El monto debe ser mayor a cero' });
    }
    if (subscriptionId === undefined || subscriptionId === null || String(subscriptionId).trim() === '') {
      return res.status(400).json({ error: 'La suscripción es obligatoria' });
    }
    if (typeof businessId !== 'string' || !businessId.trim()) {
      return res.status(400).json({ error: 'El negocio es obligatorio' });
    }

    const { rows: subscriptions } = await query(
      `SELECT s.total_amount, b.name AS business_name
       FROM public.subscriptions s
       JOIN public.businesses b ON b.id = s.business_id
       WHERE s.id = $1 AND s.business_id = $2
       LIMIT 1`,
      [subscriptionId, businessId]
    );
    if (!subscriptions.length) {
      return res.status(404).json({ error: 'La suscripción no existe para el negocio indicado' });
    }

    const subscription = subscriptions[0];
    const amountInCents = Math.round(parsedAmount * 100);
    const storedAmountInCents = Math.round(Number(subscription.total_amount) * 100);
    if (!Number.isFinite(storedAmountInCents) || storedAmountInCents <= 0) {
      throw new Error('La suscripción tiene un monto inválido');
    }
    if (amountInCents !== storedAmountInCents) {
      return res.status(409).json({ error: 'El monto enviado no coincide con el monto de la suscripción' });
    }

    if (!process.env.PAYPHONE_TOKEN || !process.env.PAYPHONE_STORE_ID) {
      throw new Error('Falta configurar PAYPHONE_TOKEN o PAYPHONE_STORE_ID');
    }

    const transactionId = `TX-${Date.now()}`;
    const response = await axios.post(
      'https://pay.payphonetodoesposible.com/api/button/Prepare',
      {
        amount: amountInCents,
        amountWithoutTax: amountInCents,
        amountWithTax: 0,
        tax: 0,
        clientTransactionId: transactionId,
        currency: 'USD',
        storeId: process.env.PAYPHONE_STORE_ID,
        reference: `Suscripción ${subscription.business_name || businessName || ''}`.trim(),
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
    if (parsedPaymentUrl.protocol !== 'https:') {
      throw new Error('PayPhone devolvió un enlace de pago no válido');
    }

    const safeBusinessName = escapeHtml(subscription.business_name || businessName || 'tu negocio');
    const safePaymentUrl = escapeHtml(parsedPaymentUrl.toString());
    const html = `
      <!DOCTYPE html>
      <html lang="es">
        <body style="font-family:Arial,sans-serif;color:#222;line-height:1.6;max-width:600px;margin:0 auto;padding:24px;">
          <h2>Acción requerida: link de pago para tu suscripción</h2>
          <p>Hola,</p>
          <p>La suscripción de <strong>${safeBusinessName}</strong> tiene un pago pendiente.</p>
          <p><strong>Monto a pagar:</strong> $${(storedAmountInCents / 100).toFixed(2)} USD</p>
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
      to: recipientEmail,
      subject: 'Acción requerida: Link de pago para tu suscripción',
      html,
      businessName: 'IDON PLATAFORM',
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('--- ERROR REAL DE PAYPHONE ---');
    if (error.response?.data) {
      console.error('Mensaje:', error.response.data.message);
      if (error.response.data.errors) {
        console.error(
          'Detalle de validaciones:',
          JSON.stringify(error.response.data.errors, null, 2)
        );
      }
    } else {
      console.error(error.message);
    }
    console.error('-------------------------------');
    return res.status(500).json({ error: 'No se pudo generar el link o enviar el correo' });
  }
});

export default router;
