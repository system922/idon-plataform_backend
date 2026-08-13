import { query } from '../config/database.js';
import { sendGenericEmail } from './crmEmailService.js';

/**
 * Servicio para enviar emails desde rutas públicas
 * Reutiliza el mismo servicio de correo pero con lógica de plantillas
 */
export async function sendPublicEmail({ 
  to, 
  templateKey, 
  variables = {}, 
  businessName = 'IDON PLATAFORM' 
}) {
  try {
    // Validar campos requeridos
    if (!to || !templateKey) {
      throw new Error('Faltan campos requeridos: to y templateKey son obligatorios');
    }

    // Obtener la plantilla de la base de datos
    const { rows } = await query(
      `SELECT subject, body, is_active FROM public.email_templates WHERE type = $1`,
      [templateKey]
    );

    if (!rows.length) {
      throw new Error(`Plantilla no encontrada: ${templateKey}`);
    }

    if (!rows[0].is_active) {
      throw new Error('Plantilla inactiva');
    }

    // Función para formatear fechas
    const fmtDate = (d) => {
      if (!d) return new Date().toLocaleDateString('es-EC', { 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
      });
      return new Date(d).toLocaleDateString('es-EC', { 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
      });
    };

    // Función para formatear montos
    const fmtAmount = (a) => {
      if (a == null) return '—';
      return `$${parseFloat(a).toFixed(2)}`;
    };

    // Variables por defecto con formateo
    const defaultVars = {
      owner_name: variables.ownerName || 'usuario',
      business_name: variables.businessName || '—',
      email: to,
      request_date: fmtDate(variables.requestDate),
      approval_date: fmtDate(variables.approvalDate),
      amount: fmtAmount(variables.amount),
      due_date: fmtDate(variables.dueDate),
      app_url: process.env.APP_URL || 'https://tuapp.com',
    };

    // Combinar variables por defecto con las proporcionadas
    const allVars = { ...defaultVars, ...variables };

    // Función para reemplazar variables en el template
    const interpolate = (str) => {
      return str.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return allVars[key] ?? `{{${key}}}`;
      });
    };

    const subject = interpolate(rows[0].subject);
    const html = interpolate(rows[0].body);

    // Enviar email usando el servicio existente
    const result = await sendGenericEmail({
      to,
      subject,
      html,
      businessName: businessName || 'IDON PLATAFORM'
    });

    console.log(`✅ Email enviado a ${to} - Plantilla: ${templateKey}`);

    return {
      success: true,
      message: 'Email enviado correctamente',
      emailId: result?.id
    };

  } catch (error) {
    console.error(`❌ Error enviando email a ${to}:`, error.message);
    throw error;
  }
}

// Funciones específicas para cada tipo de email público
export async function sendRegistrationPendingEmail({ email, ownerName, businessName, requestDate }) {
  return sendPublicEmail({
    to: email,
    templateKey: 'registration_pending',
    variables: {
      ownerName,
      businessName,
      requestDate
    }
  });
}

export async function sendBusinessApprovedEmail({ email, ownerName, businessName, approvalDate }) {
  return sendPublicEmail({
    to: email,
    templateKey: 'business_approved',
    variables: {
      ownerName,
      businessName,
      approvalDate
    }
  });
}