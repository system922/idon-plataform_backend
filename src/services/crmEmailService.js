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
  const subject = `Restablece tu contraseña - ${businessName || 'IDON'}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; border-radius: 12px;">
      <div style="text-align: center; padding: 20px 0;">
        <h1 style="color: #1a1a2e; font-size: 24px; margin: 0;">${businessName || 'IDON'}</h1>
      </div>
      
      <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
        <h2 style="color: #1a1a2e; margin-top: 0;">Recuperación de contraseña</h2>
        
        <p style="color: #333; line-height: 1.6;">
          Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en <strong>${businessName || 'IDON'}</strong>.
        </p>
        
        <p style="color: #333; line-height: 1.6;">
          Para crear una nueva contraseña, haz clic en el siguiente botón:
        </p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" 
             style="display: inline-block; background: #ff8c42; color: white; padding: 14px 32px; 
                    border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px;">
            Restablecer contraseña
          </a>
        </div>
        
        <p style="color: #666; font-size: 14px; line-height: 1.6;">
          ⏰ Este enlace expirará en <strong>1 hora</strong>.
        </p>
        
        <p style="color: #666; font-size: 14px; line-height: 1.6;">
          🔒 Si no solicitaste este cambio, puedes ignorar este mensaje. Tu contraseña seguirá siendo la misma.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        
        <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
          Este es un mensaje automático de ${businessName || 'IDON'}. Por favor no respondas a este correo.
        </p>
      </div>
    </div>
  `;
  
  return sendGenericEmail({ 
    to, 
    subject, 
    html, 
    businessName: businessName || 'IDON' 
  });
}