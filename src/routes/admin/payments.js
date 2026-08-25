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
    const { notes, payment_method, reference } = req.body;

    // Obtener suscripción con datos del negocio y propietario
    const { rows: subRows } = await query(`
      SELECT 
        s.*,
        b.name AS business_name,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email AS owner_email,
        bo.id AS owner_id
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      JOIN public.users u ON u.id = bu.user_id
      JOIN public.business_owners bo ON bo.user_id = u.id
      WHERE s.id = $1
    `, [subId]);

    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }

    const sub = subRows[0];
    const ownerName = `${sub.first_name} ${sub.last_name || ''}`.trim();

    // No permitir si ya está activa
    if (sub.status === 'active') {
      return res.status(400).json({ ok: false, message: 'Esta suscripción ya está activa' });
    }

    // --- Definir fecha base según el estado ---
    const now = new Date();
    let baseDate;

    if (sub.status === 'pending_activation') {
      // Primer pago: la base es hoy (fecha del pago)
      baseDate = new Date(now);
    } else {
      // Renovación (estado 'active' o 'suspended'? solo permitimos si no está activa, pero puede ser 'suspended')
      // Si está suspendida, usamos la fecha actual o la del próximo cobro si existe y es futura
      baseDate = sub.next_billing_at ? new Date(sub.next_billing_at) : new Date(now);
      // Si la fecha base es anterior a hoy, usar hoy (para reactivaciones)
      if (baseDate < now) {
        baseDate = new Date(now);
      }
    }

    // Calcular próximo cobro (sumar un período)
    const nextBilling = new Date(baseDate);
    if (sub.billing_period === 'monthly') {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    } else {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    }

    // Asegurar día 1 si lo prefieres (comenta si no)
    // nextBilling.setDate(1);
    // nextBilling.setHours(0, 0, 0, 0);

    const invoiceNumber = `INV-${Date.now()}`;
    const periodStart = baseDate.toISOString();
    const periodEnd = nextBilling.toISOString();
    const monthsPaid = 1; // Siempre 1 mes en este endpoint

    // --- Registrar en billing_history con todos los campos ---
    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number,
          notes, payment_method, reference, period_start, period_end, months_paid)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5, $6, $7, $8, $9, $10)`,
      [
        sub.id,
        sub.next_billing_at,   // due_date (fecha de vencimiento anterior, puede ser null)
        sub.total_amount,
        invoiceNumber,
        notes || null,
        payment_method || null,
        reference || null,
        periodStart,
        periodEnd,
        monthsPaid
      ]
    );

    // --- Actualizar suscripción ---
    // Cambiar estado a 'active' si estaba pendiente
    let statusChanged = false;
    if (sub.status === 'pending_activation') {
      await query(
        `UPDATE public.subscriptions 
         SET status = 'active', 
             activated_at = NOW(),
             next_billing_at = $1,
             paid_until = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextBilling.toISOString(), sub.id]
      );
      // Activar el negocio
      await query(
        `UPDATE public.businesses 
         SET is_active = TRUE, updated_at = NOW() 
         WHERE id = (SELECT business_id FROM public.subscriptions WHERE id = $1)`,
        [sub.id]
      );
      statusChanged = true;
    } else {
      // Si ya estaba activa (no debería por la validación anterior) o suspendida
      // Solo actualizar next_billing_at y paid_until
      await query(
        `UPDATE public.subscriptions 
         SET next_billing_at = $1,
             paid_until = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [nextBilling.toISOString(), sub.id]
      );
    }

    // --- Enviar email de confirmación ---
    try {
      await sendPaymentConfirmedEmail(subId, ownerName, sub.owner_email, monthsPaid);
    } catch (emailError) {
      logger.error('Error enviando email de pago confirmado:', emailError);
    }

    logger.info(`[PAYMENT] Pago registrado para suscripción ${subId}, invoice ${invoiceNumber}, próximo cobro ${nextBilling}`);

    res.json({
      ok: true,
      message: 'Pago registrado correctamente. Suscripción activada.',
      data: {
        invoice_number: invoiceNumber,
        next_billing_at: nextBilling,
        status: 'active',
        period_start: periodStart,
        period_end: periodEnd,
        months_paid: monthsPaid
      }
    });

  } catch (error) {
    logger.error('Error registrando pago:', error);
    res.status(500).json({
      ok: false,
      message: 'Error al registrar el pago: ' + error.message
    });
  }
});

// 🔥 Función para enviar email de pago confirmado
async function sendPaymentConfirmedEmail(subscriptionId, ownerName, ownerEmail, monthsPaid = 1) {
  try {
    // Obtener datos de la suscripción
    const { rows } = await query(`
      SELECT 
        s.*,
        b.name AS business_name
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      WHERE s.id = $1
    `, [subscriptionId]);

    if (rows.length === 0) {
      throw new Error('Suscripción no encontrada');
    }

    const sub = rows[0];
    const email = ownerEmail || sub.owner_email;
    const name = ownerName || 'usuario';

    // Buscar plantilla de pago confirmado
    const { rows: tplRows } = await query(
      `SELECT subject, body, is_active FROM public.email_templates WHERE type = $1 AND is_active = true`,
      ['pago_confirmado']
    );

    if (tplRows.length === 0) {
      logger.warn('Plantilla de pago confirmado no encontrada');
      return;
    }

    const template = tplRows[0];

    // Formatear fecha
    const fmtDate = (d) => {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('es-EC', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
    };

    const vars = {
      owner_name: name,
      business_name: sub.business_name || '—',
      amount: `$${parseFloat(sub.total_amount || 0).toFixed(2)}`,
      due_date: fmtDate(sub.next_billing_at),
      months_paid: monthsPaid,
    };
    

    const interpolate = (str) =>
      str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

    const subject = interpolate(template.subject);
    const html = interpolate(template.body);

    // Enviar email
    await sendGenericEmail({
      to: email,
      subject,
      html,
      businessName: 'IDON PLATAFORM'
    });

    logger.info(`Email de pago confirmado enviado a ${email}`);

  } catch (error) {
    logger.error('Error en sendPaymentConfirmedEmail:', error);
    throw error;
  }
}


// POST /api/admin/payments/record
router.post('/payments/record', async (req, res, next) => {
  try {
    const { subscriptionId, notes, payment_method, reference, months = 1 } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ ok: false, message: 'subscriptionId es requerido' });
    }

    const monthsToAdd = Math.max(1, parseInt(months) || 1);

    // Obtener suscripción con negocio y propietario
    const { rows: subRows } = await query(`
      SELECT 
        s.*,
        b.name AS business_name,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email AS owner_email,
        bo.id AS owner_id
      FROM public.subscriptions s
      JOIN public.businesses b ON s.business_id = b.id
      JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      JOIN public.users u ON u.id = bu.user_id
      JOIN public.business_owners bo ON bo.user_id = u.id
      WHERE s.id = $1
    `, [subscriptionId]);

    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }

    const sub = subRows[0];
    const ownerName = `${sub.first_name} ${sub.last_name || ''}`.trim();

    // No permitir pagos si suspendida
    if (sub.status === 'suspended') {
      return res.status(400).json({
        ok: false,
        message: 'No se puede registrar un pago para una suscripción suspendida. Primero reactívala.'
      });
    }

    // --- Calcular fecha base para sumar los meses ---
    // Si está pendiente o no tiene next_billing_at o ya expiró, partimos de hoy
    let baseDate = sub.next_billing_at ? new Date(sub.next_billing_at) : new Date();
    const now = new Date();
    // Ajustar a día 1 y cero horas
    baseDate.setDate(1);
    baseDate.setHours(0, 0, 0, 0);
    // Si baseDate es menor que hoy, usar hoy (para renovaciones atrasadas)
    if (baseDate < now) {
      baseDate = new Date(now);
      baseDate.setDate(1);
      baseDate.setHours(0, 0, 0, 0);
    }

    // Sumar los meses pagados
    const newNextBilling = new Date(baseDate);
    newNextBilling.setMonth(newNextBilling.getMonth() + monthsToAdd);
    newNextBilling.setDate(1); // asegurar día 1

    const invoiceNumber = `INV-${Date.now()}`;

    // --- Calcular el período cubierto por este pago ---
    const periodStart = baseDate.toISOString();
    const periodEnd = newNextBilling.toISOString();

    // Registrar en billing_history (con las columnas agregadas)
    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, 
          notes, payment_method, reference, period_start, period_end, months_paid)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5, $6, $7, $8, $9, $10)`,
      [
        sub.id,
        sub.next_billing_at,  // due_date (fecha de vencimiento anterior)
        sub.total_amount,
        invoiceNumber,
        notes || null,
        payment_method || null,
        reference || null,
        periodStart,
        periodEnd,
        monthsToAdd
      ]
    );

    // --- Actualizar suscripción ---
    // Actualizar next_billing_at y paid_until
    await query(
      `UPDATE public.subscriptions 
       SET next_billing_at = $1,
           paid_until = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [newNextBilling.toISOString(), sub.id]
    );

    // Si estaba pendiente, activar
    let statusChanged = false;
    if (sub.status === 'pending_activation') {
      await query(
        `UPDATE public.subscriptions 
         SET status = 'active', 
             activated_at = NOW()
         WHERE id = $1`,
        [sub.id]
      );
      await query(
        'UPDATE public.businesses SET is_active = TRUE, updated_at = NOW() WHERE id = (SELECT business_id FROM public.subscriptions WHERE id = $1)',
        [sub.id]
      );
      statusChanged = true;
    }

    // Enviar email de confirmación (opcional)
    try {
      await sendPaymentConfirmedEmail(sub.id, ownerName, sub.owner_email, monthsToAdd);
    } catch (emailError) {
      logger.error('Error enviando email de pago confirmado:', emailError);
    }

    logger.info(`[PAYMENT-RECORD] Pago registrado para suscripción ${sub.id}, meses=${monthsToAdd}, invoice ${invoiceNumber}`);

    res.json({
      ok: true,
      message: `Pago de ${monthsToAdd} mes(es) registrado correctamente.`,
      data: {
        invoice_number: invoiceNumber,
        next_billing_at: newNextBilling,
        months_paid: monthsToAdd,
        status: sub.status,
        activated: statusChanged
      }
    });

  } catch (error) {
    logger.error('Error registrando pago en /payments/record:', error);
    res.status(500).json({
      ok: false,
      message: 'Error al registrar el pago: ' + error.message
    });
  }
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

    // Cargar plantilla desde la base de datos
    const { rows } = await query(
      `SELECT subject, body, is_active FROM public.email_templates WHERE type = $1`,
      [templateKey]
    );

    if (!rows.length) return res.status(400).json({ ok: false, message: `Plantilla no encontrada: ${templateKey}` });
    if (!rows[0].is_active) return res.status(400).json({ ok: false, message: 'Plantilla inactiva' });

    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-EC', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
    const fmtAmt  = (a) => a != null ? `$${parseFloat(a).toFixed(2)}` : '—';

    const vars = {
      owner_name:    ownerName    || 'usuario',
      business_name: businessName || '—',
      amount:        fmtAmt(amount),
      due_date:      fmtDate(dueDate),
    };

    const interpolate = (str) =>
      str.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);

    const subject = interpolate(rows[0].subject);
    const html    = interpolate(rows[0].body);

    await sendGenericEmail({ to, subject, html, businessName: 'IDON PLATAFORM' });
    logger.info({ to, templateKey, businessName }, 'Admin email sent');
    res.json({ ok: true, message: 'Correo enviado correctamente' });
  } catch (e) { next(e); }
});

export default router;