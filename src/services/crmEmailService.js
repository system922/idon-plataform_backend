import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const NOTIFICATIONS_ADDRESS = process.env.NOTIFICATIONS_EMAIL || process.env.FROM_EMAIL || 'onboarding@resend.dev';

function buildFrom(businessName) {
  const name = businessName || 'IDON PLATAFORM';
  return `${name} <${NOTIFICATIONS_ADDRESS}>`;
}

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
    console.error('❌ Resend email error:', error);
    throw new Error(error.message || 'Error al enviar correo');
  }
  console.log(`✅ Email sent to ${to}, id: ${data?.id}`);
  return data;
}

export async function sendCampaign({ recipients, subject, html, batchSize = 50, businessName }) {
  const results = { sent: 0, failed: 0, errors: [] };
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    try {
      const { data, error } = await resend.emails.send({
        from: buildFrom(businessName),
        to:   [NOTIFICATIONS_ADDRESS],
        bcc:  batch,
        subject,
        html,
      });
      if (error) throw error;
      results.sent += batch.length;
      console.log(`✅ Campaign batch sent: ${batch.length} emails`);
    } catch (err) {
      results.failed += batch.length;
      results.errors.push({ batch: batch.slice(0, 3), error: err.message });
      console.error('❌ Campaign batch failed:', err.message);
    }
  }
  return results;
}

export async function sendGenericEmail({ to, subject, html, businessName, attachments = [] }) {
  return sendEmail({ to, subject, html, businessName, attachments });
}

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