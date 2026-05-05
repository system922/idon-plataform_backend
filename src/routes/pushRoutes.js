import express from 'express';
import webpush from 'web-push';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidEnabled = !!(vapidPublicKey && vapidPrivateKey);

if (vapidEnabled) {
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_MAIL || 'admin@example.com'}`,
    vapidPublicKey,
    vapidPrivateKey
  );
}

// -------------------------------------------------------------
// Obtener la clave pública VAPID (para que el frontend la use)
router.get('/push/vapid-public-key', authMiddleware, (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

// -------------------------------------------------------------
// Suscripción (guardar token)
router.post('/push/subscribe', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { subscription, userAgent } = req.body;
    const { endpoint, keys } = subscription;
    const userId = req.user.id;

    await query(`
      INSERT INTO "${schema}".push_subscriptions (endpoint, p256dh, auth, user_agent, user_id)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (endpoint) DO UPDATE
      SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, user_id = EXCLUDED.user_id
    `, [endpoint, keys.p256dh, keys.auth, userAgent || null, userId]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Desuscribir (eliminar token)
router.delete('/push/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { endpoint } = req.body;
    await query(`DELETE FROM "${schema}".push_subscriptions WHERE endpoint = $1`, [endpoint]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Enviar notificación a todos los suscriptores del tenant
router.post('/push/send', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { title, body, icon, url } = req.body;
    if (!vapidEnabled) return res.status(503).json({ error: 'Push notifications not configured (VAPID keys missing)' });
    if (!title || !body) return res.status(400).json({ error: 'Title and body required' });

    // Obtener todas las suscripciones del tenant (si se filtra por negocio)
    const subscriptions = await query(`SELECT endpoint, p256dh, auth FROM "${schema}".push_subscriptions`);
    const payload = JSON.stringify({ title, body, icon: icon || '/logo192.png', url: url || '/' });

    const results = [];
    for (const sub of subscriptions.rows) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      };
      try {
        await webpush.sendNotification(pushSubscription, payload);
        results.push({ endpoint: sub.endpoint, status: 'sent' });
      } catch (err) {
        console.error(`Error enviando a ${sub.endpoint}:`, err.message);
        // Si el endpoint expiró (410), eliminarlo
        if (err.statusCode === 410) {
          await query(`DELETE FROM "${schema}".push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
        }
        results.push({ endpoint: sub.endpoint, status: 'failed', error: err.message });
      }
    }

    // Guardar historial (opcional)
    await query(`
      INSERT INTO "${schema}".push_notifications_history (title, body, icon, url, sent_count, failed_count, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [title, body, icon || null, url || null, results.filter(r => r.status === 'sent').length, results.filter(r => r.status === 'failed').length, req.user.id]);

    res.json({ sent: results.filter(r => r.status === 'sent').length, total: results.length, details: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Historial de notificaciones enviadas
router.get('/push/history', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { limit = 50 } = req.query;
    const result = await query(`
      SELECT id, title, body, icon, url, sent_count, failed_count, created_at, created_by
      FROM "${schema}".push_notifications_history
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;