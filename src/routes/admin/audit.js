import express from 'express';
import { query } from '../../config/database.js';

const router = express.Router();

// GET /api/admin/billing-history
router.get('/billing-history', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT bh.*, b.name AS business_name, s.billing_period
      FROM public.billing_history bh
      JOIN public.subscriptions s ON bh.subscription_id = s.id
      JOIN public.businesses b ON s.business_id = b.id
      ORDER BY bh.billing_date DESC LIMIT 100
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// GET /api/admin/notifications/system
router.get('/notifications/system', async (req, res, next) => {
  try {
    const notifications = [];
    const now = new Date();

    const { rows: overdue } = await query(`
      SELECT s.id AS sub_id, s.next_billing_at, s.total_amount, s.status,
             b.name AS business_name, b.id AS business_id
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      WHERE s.next_billing_at < NOW() AND s.status = 'active'
      ORDER BY s.next_billing_at ASC
    `);
    overdue.forEach(r => {
      const days = Math.floor((now - new Date(r.next_billing_at)) / 86400000);
      notifications.push({
        id: `overdue-${r.sub_id}`, type: 'payment_overdue',
        priority: days > 7 ? 'high' : 'medium',
        title: `Pago vencido: ${r.business_name}`,
        message: `Pago de $${parseFloat(r.total_amount).toFixed(2)} vencido hace ${days} día(s)`,
        business_id: r.business_id, sub_id: r.sub_id,
        date: r.next_billing_at, days_overdue: days,
      });
    });

    const { rows: upcoming } = await query(`
      SELECT s.id AS sub_id, s.next_billing_at, s.total_amount,
             b.name AS business_name, b.id AS business_id
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      WHERE s.next_billing_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND s.status = 'active'
      ORDER BY s.next_billing_at ASC
    `);
    upcoming.forEach(r => {
      const days = Math.ceil((new Date(r.next_billing_at) - now) / 86400000);
      notifications.push({
        id: `upcoming-${r.sub_id}`, type: 'payment_upcoming',
        priority: days <= 2 ? 'medium' : 'low',
        title: `Próximo pago: ${r.business_name}`,
        message: `Pago de $${parseFloat(r.total_amount).toFixed(2)} en ${days} día(s)`,
        business_id: r.business_id, sub_id: r.sub_id,
        date: r.next_billing_at, days_until: days,
      });
    });

    const { rows: pending } = await query(`
      SELECT id, business_name, owner_email, requested_at
      FROM public.business_registration_requests WHERE status='pending'
      ORDER BY requested_at ASC
    `);
    pending.forEach(r => {
      const days = Math.floor((now - new Date(r.requested_at)) / 86400000);
      notifications.push({
        id: `req-${r.id}`, type: 'pending_request',
        priority: days > 3 ? 'high' : 'low',
        title: `Solicitud pendiente: ${r.business_name}`,
        message: `Solicitud de ${r.owner_email} hace ${days} día(s)`,
        request_id: r.id, date: r.requested_at, days_waiting: days,
      });
    });

    const { rows: suspended } = await query(`
      SELECT b.id, b.name, s.suspended_at
      FROM public.businesses b JOIN public.subscriptions s ON s.business_id = b.id
      WHERE s.status = 'suspended'
    `);
    suspended.forEach(r => {
      notifications.push({
        id: `susp-${r.id}`, type: 'suspended',
        priority: 'high',
        title: `Negocio suspendido: ${r.name}`,
        message: 'El negocio fue suspendido por falta de pago',
        business_id: r.id, date: r.suspended_at,
      });
    });

    notifications.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] - p[b.priority]) || new Date(a.date) - new Date(b.date);
    });

    res.json({ ok: true, data: notifications, total: notifications.length });
  } catch (e) { next(e); }
});

export default router;
