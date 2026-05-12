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

    const wrap = (title, subtitle, body) => `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1e293b">
        <div style="background:#ff8c42;padding:24px 28px;border-radius:10px 10px 0 0">
          <h2 style="color:#fff;margin:0;font-size:20px">Idon Plataforma</h2>
          <p style="color:#fff3e0;margin:4px 0 0;font-size:13px">${subtitle}</p>
        </div>
        <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px">
          ${body}
          <p style="margin:20px 0 0;font-size:11px;color:#cbd5e1;text-align:center">
            Idon Plataforma — mensaje automático, no responder a este correo.
          </p>
        </div>
      </div>`;

    const row = (label, value, alt) => `
      <tr>
        <td style="padding:7px 10px;background:${alt ? '#f8fafc' : '#fff'};border:1px solid #e2e8f0;color:#64748b">${label}</td>
        <td style="padding:7px 10px;background:${alt ? '#f8fafc' : '#fff'};border:1px solid #e2e8f0;font-weight:700">${value}</td>
      </tr>`;

    const tpls = {
      bienvenida: {
        subject: `Bienvenido a Idon Plataforma — ${businessName}`,
        html: wrap('Bienvenida', 'Tu cuenta está lista', `
          <p style="margin:0 0 8px">Estimado/a <strong>${ownerName || 'usuario'}</strong>,</p>
          <p style="margin:0 0 20px;color:#475569;font-size:14px">
            Tu negocio <strong>${businessName}</strong> ya está activo en <strong>Idon Plataforma</strong>. Desde ahora puedes gestionar tus ventas, inventario, empleados y más desde un solo lugar.
          </p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            ${row('Negocio', businessName, false)}
            ${row('Estado', '<span style="color:#059669">✓ Activo</span>', true)}
          </table>
          <p style="margin:16px 0 0;color:#475569;font-size:13px">Si tienes alguna duda, contáctanos.</p>
        `),
      },
      recordatorio_pago: {
        subject: `Recordatorio de pago — ${businessName}`,
        html: wrap('Recordatorio de pago', 'Tienes un pago pendiente', `
          <p style="margin:0 0 8px">Estimado/a <strong>${ownerName || 'usuario'}</strong>,</p>
          <p style="margin:0 0 20px;color:#475569;font-size:14px">
            Te recordamos que tienes un pago pendiente para mantener activa tu suscripción de <strong>${businessName}</strong>.
          </p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            ${row('Negocio', businessName, false)}
            ${row('Monto a pagar', `<span style="color:#d97706;font-weight:800">${fmtAmt(amount)}</span>`, true)}
            ${row('Fecha de vencimiento', `<span style="color:#ef4444">${fmtDate(dueDate)}</span>`, false)}
          </table>
          <p style="margin:16px 0 0;color:#475569;font-size:13px">Por favor realiza tu pago a tiempo para evitar la suspensión del servicio.</p>
        `),
      },
      suspension: {
        subject: `Suscripción suspendida — ${businessName}`,
        html: wrap('Suscripción suspendida', 'Acceso bloqueado temporalmente', `
          <p style="margin:0 0 8px">Estimado/a <strong>${ownerName || 'usuario'}</strong>,</p>
          <p style="margin:0 0 20px;color:#475569;font-size:14px">
            Lamentamos informarte que la suscripción de <strong>${businessName}</strong> ha sido <strong>suspendida</strong> por falta de pago y el acceso ha sido bloqueado.
          </p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            ${row('Negocio', businessName, false)}
            ${row('Estado', '<span style="color:#ef4444">✗ Suspendida</span>', true)}
            ${row('Monto pendiente', `<span style="color:#ef4444;font-weight:800">${fmtAmt(amount)}</span>`, false)}
          </table>
          <p style="margin:16px 0 0;color:#475569;font-size:13px">Para reactivar tu cuenta, comunícate con nosotros y realiza el pago correspondiente.</p>
        `),
      },
      activacion: {
        subject: `Suscripción activada — ${businessName}`,
        html: wrap('Suscripción activada', 'Tu cuenta está activa nuevamente', `
          <p style="margin:0 0 8px">Estimado/a <strong>${ownerName || 'usuario'}</strong>,</p>
          <p style="margin:0 0 20px;color:#475569;font-size:14px">
            Confirmamos que la suscripción de <strong>${businessName}</strong> ha sido <strong>activada exitosamente</strong>. ¡Ya puedes acceder a todas las funciones de la plataforma!
          </p>
          <table style="width:100%;font-size:13px;border-collapse:collapse">
            ${row('Negocio', businessName, false)}
            ${row('Estado', '<span style="color:#059669">✓ Activa</span>', true)}
            ${row('Próximo cobro', fmtDate(dueDate), false)}
            ${row('Monto', `<span style="color:#059669;font-weight:800">${fmtAmt(amount)}</span>`, true)}
          </table>
          <p style="margin:16px 0 0;color:#475569;font-size:13px">Gracias por continuar con nosotros.</p>
        `),
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
