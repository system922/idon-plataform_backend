import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { sendGenericEmail } from '../../services/crmEmailService.js';

const router = express.Router();

// GET /api/admin/payments
router.get('/payments', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        b.id AS business_id, b.name AS business_name, b.slug, b.is_active AS business_active,
        bt.name AS business_type,
        s.id AS sub_id, s.status AS sub_status, s.billing_period, s.billing_day,
        s.amount_monthly, s.amount_annual, s.total_amount, s.discount_percentage,
        s.next_billing_at, s.activated_at,
        (SELECT bh.billing_date FROM public.billing_history bh
         WHERE bh.subscription_id = s.id AND bh.status = 'paid'
         ORDER BY bh.billing_date DESC LIMIT 1) AS last_paid_at,
        bo.first_name || ' ' || bo.last_name AS owner_name, bo.email AS owner_email
      FROM public.businesses b
      JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      LEFT JOIN public.business_owners bo ON bo.user_id = bu.user_id
      ORDER BY s.next_billing_at ASC NULLS LAST, b.name
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// PATCH /api/admin/subscriptions/:subId/discount
router.patch('/subscriptions/:subId/discount', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { discount_percentage = 0 } = req.body;
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);

    const { rows: subRows } = await query(
      'SELECT billing_period, amount_monthly, amount_annual FROM public.subscriptions WHERE id = $1',
      [subId]
    );
    if (!subRows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });

    const sub = subRows[0];
    const baseAmount = sub.billing_period === 'monthly'
      ? parseFloat(sub.amount_monthly)
      : parseFloat(sub.amount_annual);
    const total_amount = parseFloat((baseAmount * (1 - disc / 100)).toFixed(2));

    await query(
      `UPDATE public.subscriptions SET discount_percentage=$1, total_amount=$2, updated_at=NOW() WHERE id=$3`,
      [disc, total_amount, subId]
    );
    res.json({ ok: true, message: 'Descuento actualizado', data: { discount_percentage: disc, total_amount } });
  } catch (error) {
    logger.error('Error actualizando descuento:', error);
    next(error);
  }
});

// POST /api/admin/subscriptions/:subId/mark-paid
router.post('/subscriptions/:subId/mark-paid', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { notes } = req.body;
    const { rows: subRows } = await query('SELECT * FROM public.subscriptions WHERE id=$1', [subId]);
    if (!subRows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    const sub = subRows[0];

    const nextBilling = new Date(sub.next_billing_at || new Date());
    if (sub.billing_period === 'monthly') nextBilling.setMonth(nextBilling.getMonth() + 1);
    else nextBilling.setFullYear(nextBilling.getFullYear() + 1);

    const invoiceNumber = `INV-${Date.now()}`;

    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, notes)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5)`,
      [subId, sub.next_billing_at, sub.total_amount, invoiceNumber, notes||null]
    );

    await query(
      `UPDATE public.subscriptions SET status='active', next_billing_at=$1, updated_at=NOW() WHERE id=$2`,
      [nextBilling.toISOString(), subId]
    );

    await query(
      'UPDATE public.businesses SET is_active=TRUE, updated_at=NOW() WHERE id=(SELECT business_id FROM public.subscriptions WHERE id=$1)',
      [subId]
    );

    res.json({ ok: true, message: 'Pago registrado', invoice_number: invoiceNumber, next_billing_at: nextBilling });
  } catch (e) { next(e); }
});

// POST /api/admin/subscriptions/:subId/suspend
router.post('/subscriptions/:subId/suspend', async (req, res, next) => {
  try {
    const { subId } = req.params;
    await query(
      "UPDATE public.subscriptions SET status='suspended', suspended_at=NOW(), updated_at=NOW() WHERE id=$1",
      [subId]
    );
    await query(
      'UPDATE public.businesses SET is_active=FALSE, updated_at=NOW() WHERE id=(SELECT business_id FROM public.subscriptions WHERE id=$1)',
      [subId]
    );
    res.json({ ok: true, message: 'Negocio suspendido' });
  } catch (e) { next(e); }
});

// POST /api/admin/email/send-template
router.post('/email/send-template', async (req, res, next) => {
  try {
    const { to, templateKey, businessName, ownerName, amount, dueDate } = req.body;
    if (!to || !templateKey) return res.status(400).json({ ok: false, message: 'to y templateKey son requeridos' });

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
    const fmtAmt  = (a) => a ? `$${parseFloat(a).toFixed(2)}` : '—';

    const base = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:linear-gradient(135deg,#1e293b,#334155);padding:32px 28px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Idon Plataforma</h1>
        </div>
        <div style="padding:32px 28px;">
    `;
    const close = `
        </div>
        <div style="background:#f8fafc;padding:16px 28px;text-align:center;font-size:11px;color:#94a3b8;">
          Este mensaje fue enviado automáticamente por el equipo de Idon Plataforma.
        </div>
      </div>
    `;

    const tpls = {
      bienvenida: {
        subject: `Bienvenido a Idon Plataforma`,
        html: base + `
          <h2 style="color:#1e293b;margin:0 0 12px;">¡Bienvenido, ${ownerName || 'estimado usuario'}!</h2>
          <p style="color:#475569;line-height:1.6;">Tu negocio <strong>${businessName}</strong> ya está activo en <strong>Idon Plataforma</strong>.</p>
          <p style="color:#475569;line-height:1.6;">Desde ahora puedes gestionar tus ventas, inventario, empleados y más desde un solo lugar.</p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:6px;margin:20px 0;">
            <p style="color:#166534;margin:0;font-weight:600;">Tu cuenta está lista para usar.</p>
          </div>
          <p style="color:#475569;line-height:1.6;">Si tienes alguna duda, no dudes en contactarnos.</p>
        ` + close,
      },
      recordatorio_pago: {
        subject: `Recordatorio de pago — ${businessName}`,
        html: base + `
          <h2 style="color:#1e293b;margin:0 0 12px;">Recordatorio de pago</h2>
          <p style="color:#475569;line-height:1.6;">Hola <strong>${ownerName || 'estimado usuario'}</strong>, te recordamos que tienes un pago pendiente para tu suscripción de <strong>${businessName}</strong>.</p>
          <div style="background:#fffbeb;border-left:4px solid #f59e0b;padding:14px 18px;border-radius:6px;margin:20px 0;">
            <p style="color:#92400e;margin:0 0 6px;font-weight:600;">Detalles del pago</p>
            <p style="color:#92400e;margin:0;">Monto: <strong>${fmtAmt(amount)}</strong></p>
            <p style="color:#92400e;margin:4px 0 0;">Fecha de vencimiento: <strong>${fmtDate(dueDate)}</strong></p>
          </div>
          <p style="color:#475569;line-height:1.6;">Por favor realiza tu pago a tiempo para mantener tu negocio activo sin interrupciones.</p>
        ` + close,
      },
      suspension: {
        subject: `Suscripción suspendida — ${businessName}`,
        html: base + `
          <h2 style="color:#1e293b;margin:0 0 12px;">Suscripción suspendida</h2>
          <p style="color:#475569;line-height:1.6;">Hola <strong>${ownerName || 'estimado usuario'}</strong>, lamentamos informarte que la suscripción de <strong>${businessName}</strong> ha sido <strong>suspendida</strong> por falta de pago.</p>
          <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:14px 18px;border-radius:6px;margin:20px 0;">
            <p style="color:#991b1b;margin:0;font-weight:600;">El acceso a tu cuenta ha sido bloqueado temporalmente.</p>
          </div>
          <p style="color:#475569;line-height:1.6;">Para reactivar tu suscripción, comunícate con nosotros y realiza el pago correspondiente de <strong>${fmtAmt(amount)}</strong>.</p>
        ` + close,
      },
      activacion: {
        subject: `Suscripción activada — ${businessName}`,
        html: base + `
          <h2 style="color:#1e293b;margin:0 0 12px;">Suscripción activada</h2>
          <p style="color:#475569;line-height:1.6;">Hola <strong>${ownerName || 'estimado usuario'}</strong>, confirmamos que la suscripción de <strong>${businessName}</strong> ha sido <strong>activada exitosamente</strong>.</p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:6px;margin:20px 0;">
            <p style="color:#166534;margin:0 0 6px;font-weight:600;">Tu cuenta está activa</p>
            <p style="color:#166534;margin:0;">Próximo cobro: <strong>${fmtDate(dueDate)}</strong> — <strong>${fmtAmt(amount)}</strong></p>
          </div>
          <p style="color:#475569;line-height:1.6;">Gracias por continuar con nosotros. ¡Sigue adelante con tu negocio!</p>
        ` + close,
      },
    };

    const tpl = tpls[templateKey];
    if (!tpl) return res.status(400).json({ ok: false, message: 'Plantilla no válida' });

    await sendGenericEmail({ to, subject: tpl.subject, html: tpl.html, businessName: 'Idon Plataforma' });
    logger.info({ to, templateKey, businessName }, 'Admin email sent');
    res.json({ ok: true, message: 'Correo enviado correctamente' });
  } catch (e) { next(e); }
});

export default router;
