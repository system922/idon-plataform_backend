/**
 * whatsappService.js
 * Singleton de WhatsApp Web con reconexión automática y keepalive.
 * Mantiene la sesión activa permanentemente para envío de comprobantes.
 */
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from 'qrcode';
import logger from '../utils/logger.js';

// ── Estado global ─────────────────────────────────────────────────────────────
let client          = null;
let qrBase64        = null;
let status          = 'disconnected'; // 'disconnected' | 'qr' | 'ready' | 'auth_failure'
let initializing    = false;
let reconnectTimer  = null;
let keepaliveTimer  = null;
let reconnectCount  = 0;

// Promesas esperando que el cliente esté listo
let readyWaiters = []; // Array de { resolve, reject, timer }

const BASE_RECONNECT_MS  = 10_000;  // 10s primer intento
const MAX_RECONNECT_MS   = 60_000;  // 60s techo
const KEEPALIVE_MS       = 30_000;  // ping cada 30s

// ── Inicialización ─────────────────────────────────────────────────────────────
export function init() {
  if (client || initializing) return;
  initializing = true;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--no-first-run',
        '--disable-default-apps',
      ],
    },
    webVersionCache: { type: 'local' },
  });

  client.on('qr', async (qr) => {
    status   = 'qr';
    qrBase64 = await qrcode.toDataURL(qr);
    logger.info('WhatsApp QR generado — escanea desde el panel');
  });

  client.on('ready', () => {
    status         = 'ready';
    qrBase64       = null;
    initializing   = false;
    reconnectCount = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    logger.info('WhatsApp listo ✓');
    flushWaiters('resolve');

    // Vaciar cola de notificaciones pendientes
    import('../utils/waNotifications.js').then(m => m.flushQueue()).catch(() => {});

    client.pupPage?.on('error', (err) => {
      logger.warn({ err: err.message }, 'WhatsApp pupPage error → reconectando');
      scheduleReconnect();
    });

    startKeepalive();
  });

  client.on('auth_failure', () => {
    status       = 'auth_failure';
    initializing = false;
    logger.error('WhatsApp auth_failure → reconectando');
    scheduleReconnect();
  });

  client.on('disconnected', (reason) => {
    logger.warn({ reason }, 'WhatsApp desconectado → reconectando');
    scheduleReconnect();
  });

  // CRÍTICO: capturar errores de initialize() para que no caiga el proceso
  client.initialize().catch((err) => {
    logger.error({ err: err.message }, '[WA] initialize() falló — no se rompe el servidor');
    initializing = false;
    // Si el navegador ya está corriendo, esperamos más antes de reintentar
    const extraDelay = err.message?.includes('already running') ? 15_000 : 0;
    setTimeout(() => scheduleReconnect(), extraDelay);
  });
}

// ── Keepalive ─────────────────────────────────────────────────────────────────
function startKeepalive() {
  stopKeepalive();
  keepaliveTimer = setInterval(async () => {
    if (status !== 'ready' || !client) return;
    try {
      await client.getState();
    } catch (err) {
      logger.warn({ err: err.message }, 'WhatsApp keepalive falló → reconectando');
      scheduleReconnect();
    }
  }, KEEPALIVE_MS);
}

function stopKeepalive() {
  if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
}

// ── Reset / Reconexión ────────────────────────────────────────────────────────
async function destroyClient() {
  stopKeepalive();
  if (client) {
    const old = client;
    client = null;
    // Esperar destroy con timeout para liberar el directorio de sesión
    await Promise.race([
      old.destroy().catch(() => {}),
      new Promise(r => setTimeout(r, 5_000)),
    ]);
  }
  qrBase64     = null;
  status       = 'disconnected';
  initializing = false;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  flushWaiters('reject');

  // Destruir de forma asíncrona y luego programar el reinicio
  destroyClient().then(() => {
    reconnectCount++;
    const delay = Math.min(BASE_RECONNECT_MS * reconnectCount, MAX_RECONNECT_MS);
    logger.info({ attempt: reconnectCount, delayMs: delay }, 'WhatsApp: programando reconexión');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      init();
    }, delay);
  }).catch(() => {
    // Si destroyClient falla, igual reintentamos con delay largo
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      init();
    }, MAX_RECONNECT_MS);
  });
}

function flushWaiters(mode) {
  const waiters = readyWaiters;
  readyWaiters = [];
  waiters.forEach(({ resolve, reject, timer }) => {
    clearTimeout(timer);
    if (mode === 'resolve') resolve();
    else reject(new Error('WhatsApp se desconectó — reintentando'));
  });
}

// ── API pública ───────────────────────────────────────────────────────────────
export function getStatus() {
  return { status, qr: qrBase64, reconnectAttempts: reconnectCount };
}

export async function logout() {
  // Detener todo antes de cerrar sesión manualmente
  stopKeepalive();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  flushWaiters('reject');
  try {
    if (client) {
      await client.logout().catch(() => {});
      await client.destroy().catch(() => {});
    }
  } finally {
    client        = null;
    qrBase64      = null;
    status        = 'disconnected';
    initializing  = false;
    reconnectCount = 0;
    // No programar reconexión — el usuario cerró sesión a propósito
  }
}

export function resetReconnectCounter() {
  reconnectCount = 0;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

// ── Envío genérico de texto ───────────────────────────────────────────────────
export async function sendText(phone, text) {
  if (!phone) throw new Error('Número de teléfono no disponible');
  if (!client && !initializing) init();
  await waitReady(15_000);
  const to = formatPhone(phone);
  try {
    await client.sendMessage(to, text);
  } catch (err) {
    if (isStaleError(err)) scheduleReconnect();
    throw err;
  }
}

// ── Helpers internos ──────────────────────────────────────────────────────────
function waitReady(ms = 15_000) {
  if (status === 'ready' && client) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter(w => w.resolve !== resolve);
      reject(new Error('WhatsApp no disponible (timeout)'));
    }, ms);
    readyWaiters.push({ resolve, reject, timer });
  });
}

function formatPhone(phone) {
  let n = String(phone).replace(/\D/g, '');
  if (n.startsWith('0'))                      n = '593' + n.slice(1);
  if (!n.startsWith('593') && n.length === 9) n = '593' + n;
  return `${n}@c.us`;
}

const STALE_ERRORS = [
  'detached Frame', 'Session closed', 'Target closed',
  'Protocol error',  'page has been closed', 'Cannot read properties of null',
];

function isStaleError(err) {
  return STALE_ERRORS.some(msg => err?.message?.includes(msg));
}

// ── Bienvenida de nuevo negocio ───────────────────────────────────────────────
/**
 * Envía mensaje de bienvenida al dueño del negocio al crear su cuenta.
 * @param {string} phone         Teléfono del propietario (destino del mensaje)
 * @param {object} data          { firstName, lastName, email, businessName, businessSlug, supportNumber }
 */
export async function sendWelcome(phone, data) {
  if (!phone) throw new Error('Número de teléfono no disponible');

  if (!client && !initializing) init();
  await waitReady(15_000);

  const to = formatPhone(phone);

  const {
    firstName = '',
    lastName  = '',
    email     = '',
    businessName  = '',
    businessSlug  = '',
    supportNumber = '',
  } = data;

  const supportLine = supportNumber
    ? `\n📞 *Soporte IDON:* wa.me/${supportNumber.replace(/\D/g, '')}`
    : '';

  const text =
    `👋 *¡Bienvenido a IDON!*\n` +
    `_Plataforma de Gestión Multi-Negocios_\n\n` +
    `Hola *${firstName} ${lastName}*, tu solicitud de registro ha sido recibida exitosamente. ✅\n\n` +
    `📋 *Datos registrados:*\n` +
    `👤 Nombre: ${firstName} ${lastName}\n` +
    `📧 Email: ${email}\n` +
    `🏢 Negocio: ${businessName}\n` +
    `🔗 Identificador: ${businessSlug}\n\n` +
    `⏳ Tu cuenta está *pendiente de aprobación* por el equipo IDON.\n` +
    `Recibirás una notificación en cuanto sea activada.` +
    supportLine + `\n\n` +
    `_IDON — Sistema Integral de Gestión de Negocios_`;

  try {
    await client.sendMessage(to, text);
  } catch (err) {
    if (isStaleError(err)) scheduleReconnect();
    throw err;
  }
}

// ── Envío de factura ──────────────────────────────────────────────────────────
export async function sendInvoice(phone, pdfBuf, inv) {
  if (!phone) throw new Error('Número de teléfono no disponible');

  // Asegurar que el cliente esté corriendo
  if (!client && !initializing) init();
  await waitReady(15_000);

  const to = formatPhone(phone);

  const authDateFmt = inv.auth_date
    ? new Date(inv.auth_date).toLocaleString('es-EC', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : '-';

  const claveAcceso = inv.access_key || inv.auth_number || '';

  const text =
    `📄 *Comprobante Electrónico*\n` +
    `Estimado cliente ${inv.customer_name},\n` +
    `Reciba un cordial saludo. Nos complace informarle que su documento electrónico ` +
    `ha sido generado con el siguiente detalle:\n\n` +
    `📄 *Factura Electrónica*\n` +
    `N°: ${inv.invoice_number}\n` +
    `📅 Fecha y Hora: ${authDateFmt}\n` +
    `🔑 Clave de Acceso:\n${claveAcceso}\n` +
    `✅ Autorizada por el SRI\n\n` +
    `Se adjunta el archivo PDF.`;

  try {
    await client.sendMessage(to, text);
    const media = new MessageMedia(
      'application/pdf',
      pdfBuf.toString('base64'),
      `FACT-${inv.invoice_number}.pdf`,
    );
    await client.sendMessage(to, media);
  } catch (err) {
    if (isStaleError(err)) scheduleReconnect(); // browser caído → reconectar
    throw err;
  }
}
