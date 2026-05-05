import webpush from 'web-push';
import { query } from '../config/database.js';

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_MAIL || 'admin@example.com'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export async function sendPushNotification(schema, title, message) {
  const subscriptions = await query(`SELECT endpoint, p256dh, auth FROM "${schema}".push_subscriptions`);
  const payload = JSON.stringify({ title, body: message, icon: '/logo192.png', url: '/' });
  let sent = 0;
  for (const sub of subscriptions.rows) {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth }
      }, payload);
      sent++;
    } catch (err) {
      if (err.statusCode === 410) {
        await query(`DELETE FROM "${schema}".push_subscriptions WHERE endpoint = $1`, [sub.endpoint]);
      }
    }
  }
  return { sent, total: subscriptions.rows.length };
}