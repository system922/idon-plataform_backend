import express from 'express';
import schedule from 'node-schedule';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendCampaign } from '../services/crmEmailService.js';

const router = express.Router();

async function sendPushNotification(schema, title, message) {
  const subscriptions = await query(`SELECT endpoint, p256dh, auth FROM "${schema}".push_subscriptions`);
  const payload = JSON.stringify({ title, body: message, icon: '/logo192.png', url: '/' });
  const webpush = (await import('web-push')).default;
  const results = [];
  for (const sub of subscriptions.rows) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload);
      results.push(true);
    } catch {
      results.push(false);
    }
  }
  return { sent: results.filter(r => r).length, total: results.length };
}

// Planificador: revisa cada minuto
let job = null;
async function processPending(schema) {
  const now = new Date();
  const pendings = await query(`
    SELECT * FROM "${schema}".scheduled_notifications
    WHERE status = 'pending' AND schedule_at <= $1
  `, [now]);
  for (const n of pendings.rows) {
    try {
      if (n.type === 'push') {
        await sendPushNotification(schema, n.title, n.message);
      } else if (n.type === 'email') {
        // Enviar a todos los clientes con email (similar a campaña)
        const customers = await query(`SELECT email FROM "${schema}".customers WHERE email IS NOT NULL AND email != ''`);
        const emails = customers.rows.map(c => c.email);
        if (emails.length) {
          await sendCampaign({ recipients: emails, subject: n.title, html: `<p>${n.message}</p>` });
        }
      }
      await query(`UPDATE "${schema}".scheduled_notifications SET status = 'sent', sent_at = NOW() WHERE id = $1`, [n.id]);
    } catch (err) {
      await query(`UPDATE "${schema}".scheduled_notifications SET status = 'failed', error = $1 WHERE id = $2`, [err.message, n.id]);
    }
  }
}

// Iniciar planificador (se ejecuta por tenant? Podemos hacerlo genérico, pero cada tenant tiene su esquema)
// Lo óptimo es que al recibir una notificación, se programe un job específico para ese tenant.
// Para simplicidad, aquí crearemos un planificador global que itere sobre todos los schemas,
// pero para evitar complejidad, asumiremos que solo se maneja un schema por petición.
// En un entorno multi-tenant real, deberías guardar el schema en la tabla y filtrar.
// Por ahora, el planificador se ejecutará cada minuto y consultará todas las tablas de todos los tenants.
// Esto requiere conocer los esquemas activos. Se puede hacer pero es más avanzado.
// Alternativa: cada vez que se programa una notificación, crear un job único con node-schedule
// y que ese job se ejecute en la fecha exacta, pasando el schema.
// Es más sencillo y preciso.

// Mejor: al crear una notificación, programar un job único con node-schedule
// en la fecha deseada, que ejecute el envío y actualice la BD.
// Así evitamos revisar cada minuto.

// Vamos a implementar esa segunda opción.

const jobs = new Map();

async function scheduleNotification(schema, notification) {
  const { id, title, message, type, schedule_at } = notification;
  const date = new Date(schedule_at);
  if (date <= new Date()) return;
  const job = schedule.scheduleJob(date, async () => {
    try {
      if (type === 'push') {
        await sendPushNotification(schema, title, message);
      } else if (type === 'email') {
        const customers = await query(`SELECT email FROM "${schema}".customers WHERE email IS NOT NULL AND email != ''`);
        const emails = customers.rows.map(c => c.email);
        if (emails.length) {
          const bizRes = await query(`SELECT name FROM public.businesses WHERE schema_name = $1`, [schema]);
          const businessName = bizRes.rows[0]?.name;
          await sendCampaign({ recipients: emails, subject: title, html: `<p>${message}</p>`, businessName });
        }
      }
      await query(`UPDATE "${schema}".scheduled_notifications SET status = 'sent', sent_at = NOW() WHERE id = $1`, [id]);
    } catch (err) {
      await query(`UPDATE "${schema}".scheduled_notifications SET status = 'failed', error = $2 WHERE id = $1`, [id, err.message]);
    } finally {
      jobs.delete(id);
    }
  });
  jobs.set(id, job);
}

// CRUD endpoints

// Obtener todas las notificaciones programadas
router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const result = await query(`
      SELECT id, title, message, type, schedule_at, sent_at, status, error, created_at
      FROM "${schema}".scheduled_notifications
      ORDER BY schedule_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear nueva notificación programada
router.post('/scheduled', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { title, message, type, schedule_at } = req.body;
    if (!title || !message || !type || !schedule_at) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    const result = await query(`
      INSERT INTO "${schema}".scheduled_notifications (title, message, type, schedule_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [title, message, type, schedule_at, req.user.id]);
    const newNotif = result.rows[0];
    // Programar el job
    await scheduleNotification(schema, newNotif);
    res.status(201).json(newNotif);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Actualizar notificación (solo si está pending)
router.put('/scheduled/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    const { title, message, type, schedule_at } = req.body;
    const existing = await query(`SELECT * FROM "${schema}".scheduled_notifications WHERE id = $1`, [id]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
    if (existing.rows[0].status !== 'pending') return res.status(400).json({ error: 'Solo se pueden editar notificaciones pendientes' });
    await query(`
      UPDATE "${schema}".scheduled_notifications
      SET title = $1, message = $2, type = $3, schedule_at = $4
      WHERE id = $5
    `, [title, message, type, schedule_at, id]);
    // Cancelar job anterior y reprogramar
    if (jobs.has(id)) {
      jobs.get(id).cancel();
      jobs.delete(id);
    }
    const updated = { ...existing.rows[0], title, message, type, schedule_at };
    await scheduleNotification(schema, updated);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancelar (eliminar) notificación programada
router.delete('/scheduled/:id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { id } = req.params;
    if (jobs.has(id)) {
      jobs.get(id).cancel();
      jobs.delete(id);
    }
    await query(`DELETE FROM "${schema}".scheduled_notifications WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;