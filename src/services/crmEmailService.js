import { Resend } from 'resend';
import logger from '../utils/logger.js';

const resend = new Resend(process.env.RESEND_API_KEY);
const NOTIFICATIONS_ADDRESS = process.env.NOTIFICATIONS_EMAIL || process.env.FROM_EMAIL || 'onboarding@resend.dev';

function buildFrom(businessName) {
  const name = businessName || 'Idon Plataforma';
  return `${name} <${NOTIFICATIONS_ADDRESS}>`;
}

/**
 * Función base para enviar correos (no usarla directamente, usar las específicas)
 */
async function sendEmail({ to, subject, html, attachments = [], businessName }) {
  const payload = {
    from: buildFrom(businessName),
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    ...(attachments.length && { attachments }),
  };
  const { data, error } = await resend.emails.send(payload);
  if (error) {
    logger.error({ err: error }, 'Resend email error');
    throw new Error(error.message || 'Error al enviar correo');
  }
  logger.info({ emailId: data?.id, to }, 'Email sent');
  return data;
}

/**
 * Envía una campaña a múltiples destinatarios (ocultos entre sí, usando BCC)
 * @param {string[]} recipients - Array de correos
 * @param {string} subject
 * @param {string} html
 * @param {number} batchSize - máx por lote (Resend permite hasta 50 en BCC)
 */
export async function sendCampaign({ recipients, subject, html, batchSize = 50, businessName }) {
  const results = { sent: 0, failed: 0, errors: [] };
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    try {
      const { data, error } = await resend.emails.send({
        from: buildFrom(businessName),
        bcc: batch,
        subject,
        html,
      });
      if (error) throw error;
      results.sent += batch.length;
      logger.info({ batchLen: batch.length, first: batch[0] }, 'Campaign batch sent');
    } catch (err) {
      results.failed += batch.length;
      results.errors.push({ batch: batch.slice(0, 3), error: err.message });
      logger.error({ err, batchLen: batch.length }, 'Campaign batch failed');
    }
  }
  return results;
}

/**
 * Correo genérico a un solo destinatario (para notificaciones, alertas, etc.)
 */
export async function sendGenericEmail({ to, subject, html, businessName }) {
  return sendEmail({ to, subject, html, businessName });
}

/**
 * Ejemplo: correo de bienvenida a nuevos clientes
 */
export async function sendWelcomeEmail(to, customerName, businessName) {
  const subject = `¡Bienvenido a ${businessName}!`;
  const html = `
    <div style="font-family:sans-serif; max-width:600px; margin:auto;">
      <h2>Hola ${customerName}</h2>
      <p>Gracias por registrarte. A partir de ahora recibirás nuestras promociones y facturas electrónicas.</p>
    </div>
  `;
  return sendGenericEmail({ to, subject, html });
}

/**
 * Ejemplo: restablecimiento de contraseña
 */
export async function sendPasswordResetEmail(to, resetLink, businessName) {
  const subject = `Restablece tu contraseña - ${businessName}`;
  const html = `
    <div style="font-family:sans-serif;">
      <p>Recibimos una solicitud para restablecer tu contraseña.</p>
      <a href="${resetLink}" style="background:#6842fe; color:white; padding:10px 20px;">Restablecer contraseña</a>
      <p>Si no solicitaste esto, ignora este mensaje.</p>
    </div>
  `;
  return sendGenericEmail({ to, subject, html });
}