/**
 * waNotifications.js
 * Dispatcher de notificaciones WhatsApp con cola persistente en memoria.
 * Si WA no está listo al momento del envío, el mensaje queda en cola
 * y se reintenta automáticamente hasta que WA conecte.
 */
import { query } from '../config/database.js';
import { sendText, getStatus } from '../services/whatsappService.js';
import logger from './logger.js';

// ── Plantillas por defecto (fallback si DB falla) ─────────────
const DEFAULTS = {
  registro:      '👋 *¡Bienvenido a IDON!*\n_Plataforma de Gestión Multi-Negocios_\n\nHola *{{firstName}} {{lastName}}*, tu solicitud ha sido recibida. ✅\n🏢 Negocio: {{businessName}}\n🔗 ID: {{businessSlug}}\n\n⏳ Pendiente de aprobación.\n📞 Soporte: wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión_',
  aprobacion:    '🎉 *¡Negocio APROBADO!*\n\nHola *{{firstName}} {{lastName}}*, tu negocio *{{businessName}}* ha sido activado. ✅\nYa puedes iniciar sesión.\n📞 Soporte: wa.me/{{supportNumber}}\n\n_IDON — Sistema Integral de Gestión_',
  suscripcion:   '📦 *Suscripción Activada*\n\nHola *{{firstName}} {{lastName}}*, tu suscripción de *{{businessName}}* está activa.\n💵 Monto: ${{amount}} ({{plan}})\n📅 Próximo pago: {{nextBillingDate}}\n📞 Soporte: wa.me/{{supportNumber}}\n\n_IDON_',
  recordatorio:  '⏰ *Recordatorio de Pago*\n\nHola *{{firstName}} {{lastName}}*, tu suscripción de *{{businessName}}* vence en *{{daysLeft}} día(s)*.\n💵 Monto: ${{amount}} — Límite: {{dueDate}}\n📞 Soporte: wa.me/{{supportNumber}}\n\n_IDON_',
  pago_recibido: '✅ *Pago Recibido*\n\nHola *{{firstName}} {{lastName}}*, registramos tu pago de *${{amount}}* para *{{businessName}}*. ¡Gracias!\n🧾 Ref: {{invoiceNumber}} — Próximo: {{nextBillingDate}}\n📞 Soporte: wa.me/{{supportNumber}}\n\n_IDON_',
};

// ── Cola de mensajes pendientes ───────────────────────────────
// { type, phone, text, addedAt, attempts }
const pendingQueue = [];
let flushTimer = null;

// ── Renderizador ──────────────────────────────────────────────
function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// ── Plantilla desde DB ────────────────────────────────────────
async function getTemplate(type) {
  try {
    const { rows } = await query(
      "SELECT body FROM public.whatsapp_templates WHERE type=$1 AND is_active=TRUE",
      [type]
    );
    return rows[0]?.body || DEFAULTS[type] || '';
  } catch {
    return DEFAULTS[type] || '';
  }
}

// ── Número de soporte ─────────────────────────────────────────
async function getSupportNumber() {
  try {
    const { rows } = await query(
      "SELECT value FROM public.platform_settings WHERE key='whatsapp_support_number'"
    );
    return (rows[0]?.value || '').replace(/\D/g, '');
  } catch {
    return '';
  }
}

// ── Intentar enviar un item de la cola ────────────────────────
async function trySend(phone, text) {
  await sendText(phone, text);
}

// ── Vaciar cola cuando WA está listo ─────────────────────────
export async function flushQueue() {
  if (pendingQueue.length === 0) return;
  if (getStatus().status !== 'ready') return;

  console.log(`[WA-COLA] Vaciando ${pendingQueue.length} mensaje(s) pendiente(s)...`);
  const items = pendingQueue.splice(0, pendingQueue.length); // vaciar
  for (const item of items) {
    try {
      await trySend(item.phone, item.text);
      console.log(`[WA-COLA] ✅ Enviado (${item.type}) a ${item.phone}`);
      logger.info({ type: item.type, phone: item.phone }, '[WA] Mensaje de cola enviado ✓');
    } catch (err) {
      console.warn(`[WA-COLA] ⚠ Reintento fallido (${item.type}) a ${item.phone}: ${err.message}`);
      item.attempts = (item.attempts || 0) + 1;
      // Reintentar máximo 10 veces (≈ 10 minutos)
      if (item.attempts < 10) pendingQueue.push(item);
      else console.error(`[WA-COLA] ❌ Descartado tras 10 intentos (${item.type}) a ${item.phone}`);
    }
  }
}

// ── Iniciar timer de cola (llamar al arrancar el servidor) ────
export function startQueueFlusher() {
  if (flushTimer) return;
  flushTimer = setInterval(flushQueue, 60_000); // cada 60 segundos
  console.log('[WA-COLA] Timer de cola iniciado (cada 60s)');
}

// ── Dispatcher principal ──────────────────────────────────────
async function dispatch(type, phone, vars) {
  if (!phone) {
    console.warn(`[WA][${type}] ⚠ Sin teléfono — omitido`);
    return;
  }

  const supportNumber = vars.supportNumber ?? await getSupportNumber();
  const tpl  = await getTemplate(type);
  const text = render(tpl, { ...vars, supportNumber });

  const waStatus = getStatus().status;
  console.log(`[WA][${type}] Estado: ${waStatus} → destino: ${phone}`);

  if (waStatus === 'ready') {
    // WA listo: enviar directamente (con timeout de 20s)
    try {
      await Promise.race([
        trySend(phone, text),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 20s')), 20_000)),
      ]);
      console.log(`[WA][${type}] ✅ Enviado a ${phone}`);
      logger.info({ type, phone }, '[WA] Notificación enviada ✓');
      return;
    } catch (err) {
      console.warn(`[WA][${type}] ⚠ Fallo directo: ${err.message} → encolando para reintento`);
    }
  } else {
    console.warn(`[WA][${type}] ⚠ WhatsApp no listo (${waStatus}) → encolando`);
  }

  // Si llegamos aquí: encolar para cuando WA esté disponible
  pendingQueue.push({ type, phone, text, addedAt: new Date(), attempts: 0 });
  console.log(`[WA][${type}] 📥 Encolado. Cola total: ${pendingQueue.length} mensaje(s)`);
}

// ── Fire-and-forget ───────────────────────────────────────────
function fireAndForget(type, phone, vars) {
  if (!phone) {
    console.warn(`[WA][${type}] ⚠ phone vacío — omitido`);
    return;
  }
  (async () => {
    try {
      await dispatch(type, phone, vars);
    } catch (err) {
      console.error(`[WA][${type}] ❌ Error inesperado:`, err.message);
      logger.warn({ type, phone, err: err.message }, '[WA] Error inesperado en notificación');
    }
  })();
}

// ── API pública ───────────────────────────────────────────────

export function notifyRegistro(phone, data) {
  fireAndForget('registro', phone, data);
}

export function notifyAprobacion(phone, data) {
  fireAndForget('aprobacion', phone, data);
}

export function notifySuscripcion(phone, data) {
  fireAndForget('suscripcion', phone, data);
}

export function notifyRecordatorio(phone, data) {
  fireAndForget('recordatorio', phone, data);
}

export function notifyPagoRecibido(phone, data) {
  fireAndForget('pago_recibido', phone, data);
}

export async function testSend(type, phone, sampleVars = {}) {
  await dispatch(type, phone, sampleVars);
}

export function getQueueStatus() {
  return { pending: pendingQueue.length, items: pendingQueue.map(i => ({ type: i.type, phone: i.phone, attempts: i.attempts, addedAt: i.addedAt })) };
}
