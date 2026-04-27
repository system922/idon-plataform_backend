import express from 'express';
import { query, getClient } from '../config/database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ── GET /api/admin/payments ───────────────────────────────────
// Lista todos los negocios con suscripción, fechas de pago y dueño
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        b.id              AS business_id,
        b.name            AS business_name,
        b.slug,
        b.is_active       AS business_active,
        bt.name           AS business_type,
        s.id              AS sub_id,
        s.status          AS sub_status,
        s.billing_period,
        s.billing_day,
        s.amount_monthly,
        s.amount_annual,
        s.total_amount,
        s.discount_percentage,
        s.next_billing_at,
        s.activated_at,
        -- Último pago registrado
        (SELECT bh.billing_date
         FROM public.billing_history bh
         WHERE bh.subscription_id = s.id AND bh.status = 'paid'
         ORDER BY bh.billing_date DESC LIMIT 1) AS last_paid_at,
        -- Dueño
        bo.first_name || ' ' || bo.last_name AS owner_name,
        bo.email                              AS owner_email
      FROM public.businesses b
      JOIN public.business_types bt  ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s   ON s.business_id = b.id
      LEFT JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      LEFT JOIN public.business_owners bo ON bo.user_id = bu.user_id
      ORDER BY s.next_billing_at ASC NULLS LAST, b.name
    `);
    res.json({ ok: true, data: rows });
  } catch (e) {
    logger.error('Error cargando pagos:', e);
    next(e);
  }
});

// ── POST /api/admin/payments/subscriptions/:subId/mark-paid ──
// Registra pago, avanza next_billing_at y reactiva negocio
router.post('/subscriptions/:subId/mark-paid', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { notes } = req.body;

    const { rows: subRows } = await query(
      'SELECT * FROM public.subscriptions WHERE id = $1',
      [subId]
    );
    if (!subRows.length) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }
    const sub = subRows[0];

    // Calcular próxima fecha de facturación
    const nextBilling = new Date(sub.next_billing_at || new Date());
    if (sub.billing_period === 'monthly') {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    } else {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    }

    const invoiceNumber = `INV-${Date.now()}`;

    // Registrar en billing_history
    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, notes)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5)`,
      [subId, sub.next_billing_at, sub.total_amount, invoiceNumber, notes || null]
    );

    // Actualizar suscripción
    await query(
      `UPDATE public.subscriptions
       SET status = 'active', next_billing_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [nextBilling.toISOString(), subId]
    );

    // Reactivar negocio si estaba suspendido
    await query(
      `UPDATE public.businesses
       SET is_active = TRUE, updated_at = NOW()
       WHERE id = (SELECT business_id FROM public.subscriptions WHERE id = $1)`,
      [subId]
    );

    logger.info(`[PAYMENT] Pago registrado sub=${subId} invoice=${invoiceNumber}`);
    res.json({
      ok: true,
      message: 'Pago registrado correctamente',
      invoice_number: invoiceNumber,
      next_billing_at: nextBilling,
    });
  } catch (e) {
    logger.error('Error registrando pago:', e);
    next(e);
  }
});

// ── POST /api/admin/payments/subscriptions/:subId/suspend ─────
// Suspende la suscripción y bloquea el login del negocio
router.post('/subscriptions/:subId/suspend', async (req, res, next) => {
  try {
    const { subId } = req.params;

    await query(
      `UPDATE public.subscriptions
       SET status = 'suspended', suspended_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [subId]
    );

    await query(
      `UPDATE public.businesses
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = (SELECT business_id FROM public.subscriptions WHERE id = $1)`,
      [subId]
    );

    logger.info(`[SUSPEND] Negocio suspendido por falta de pago sub=${subId}`);
    res.json({ ok: true, message: 'Negocio suspendido correctamente' });
  } catch (e) {
    logger.error('Error suspendiendo negocio:', e);
    next(e);
  }
});

export default router;
