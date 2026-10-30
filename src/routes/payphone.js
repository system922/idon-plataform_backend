import express from 'express';
import axios from 'axios';
import { getClient, query } from '../config/database.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { sendGenericEmail } from '../services/crmEmailService.js';

const router = express.Router();

const payphoneResponse = (res, response, errorCode) =>
  res.status(200).json({ Response: response, ErrorCode: errorCode });

const addMonthsClamped = (date, months) => {
  const source = new Date(date);
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(source.getDate(), lastDay));
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
  return target;
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

router.post('/enviar-link-email', authMiddleware, adminMiddleware, async (req, res) => {
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

    const compactSubscriptionId = String(subscriptionId).replace(/-/g, '');
    if (!/^[\da-f]{32}$/i.test(compactSubscriptionId)) {
      throw new Error('El ID de suscripción no tiene un formato UUID válido');
    }
    const transactionId = `S${compactSubscriptionId}-${Date.now()}`;
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

router.post('/confirmar', async (req, res) => {
  let client;
  let transactionOpen = false;

  try {
    const {
      Amount,
      ClientTransactionId,
      StatusCode,
      TransactionStatus,
      StoreId,
    } = req.body || {};
    const approved = TransactionStatus === 'Approved' || Number(StatusCode) === 3;

    if (!approved) {
      return payphoneResponse(res, true, '000');
    }

    if (!process.env.PAYPHONE_STORE_ID ||
        String(StoreId) !== String(process.env.PAYPHONE_STORE_ID)) {
      throw new Error('Webhook PayPhone recibido con un StoreId inválido');
    }

    const transactionMatch = /^S([\da-f]{32})-(\d{13})$/i.exec(String(ClientTransactionId || ''));
    if (!transactionMatch) {
      throw new Error('ClientTransactionId no identifica una suscripción válida');
    }
    const compactSubscriptionId = transactionMatch[1];
    const subscriptionId = [
      compactSubscriptionId.slice(0, 8),
      compactSubscriptionId.slice(8, 12),
      compactSubscriptionId.slice(12, 16),
      compactSubscriptionId.slice(16, 20),
      compactSubscriptionId.slice(20),
    ].join('-');
    const amountInCents = Number(Amount);
    if (!Number.isSafeInteger(amountInCents) || amountInCents <= 0) {
      throw new Error('Amount inválido en la notificación de PayPhone');
    }

    client = await getClient();
    await client.query('BEGIN');
    transactionOpen = true;

    const { rows } = await client.query(
      `SELECT id, business_id, total_amount, billing_period, next_billing_at
       FROM public.subscriptions
       WHERE id = $1
       FOR UPDATE`,
      [subscriptionId]
    );
    if (!rows.length) {
      throw new Error(`No se encontró la suscripción ${subscriptionId}`);
    }

    const subscription = rows[0];
    const expectedAmountInCents = Math.round(Number(subscription.total_amount) * 100);
    if (amountInCents !== expectedAmountInCents) {
      throw new Error(`El Amount recibido no coincide con la suscripción ${subscriptionId}`);
    }

    const paymentReference = `PayPhone transaction ${ClientTransactionId}`;
    const { rows: existingPayments } = await client.query(
      `SELECT id
       FROM public.billing_history
       WHERE subscription_id = $1 AND notes = $2
       LIMIT 1`,
      [subscriptionId, paymentReference]
    );

    if (!existingPayments.length) {
      const now = new Date();
      const dueDate = subscription.next_billing_at
        ? new Date(subscription.next_billing_at)
        : now;
      const baseDate = dueDate > now ? dueDate : now;
      const months = subscription.billing_period === 'annual' ? 12 : 1;
      const nextBillingAt = addMonthsClamped(baseDate, months);

      await client.query(
        `INSERT INTO public.billing_history
           (subscription_id, billing_date, due_date, amount, status, notes)
         VALUES ($1, NOW(), $2, $3, 'paid', $4)`,
        [subscriptionId, dueDate, expectedAmountInCents / 100, paymentReference]
      );
      await client.query(
        `UPDATE public.subscriptions
         SET status = 'active',
             activated_at = COALESCE(activated_at, NOW()),
             next_billing_at = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextBillingAt, subscriptionId]
      );
      await client.query(
        `UPDATE public.businesses
         SET is_active = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [subscription.business_id]
      );
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return payphoneResponse(res, true, '000');
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir la transacción del webhook PayPhone:', rollbackError);
      }
    }
    console.error('Error procesando confirmación PayPhone:', error);
    return payphoneResponse(res, false, '222');
  } finally {
    client?.release();
  }
});

export default router;
