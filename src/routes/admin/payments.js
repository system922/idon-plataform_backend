import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { sendGenericEmail } from '../../services/crmEmailService.js';
import { issuePlatformPaymentInvoice } from '../../services/platformInvoiceService.js';

const router = express.Router();

const addMonthsClamped = (date, months) => {
  const source = new Date(date);
  const day = source.getDate();
  const targetMonth = new Date(
    source.getFullYear(),
    source.getMonth() + months,
    1,
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds()
  );
  const lastDay = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0
  ).getDate();
  targetMonth.setDate(Math.min(day, lastDay));
  return targetMonth;
};

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
        bo.first_name || ' ' || bo.last_name AS owner_name, bo.email AS owner_email,
        bo.document_type, bo.document_number
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
    const {
      notes,
      payment_method,
      reference,
      invoice_customer_name,
      invoice_document_type,
      invoice_document_number,
      invoice_email,
    } = req.body;

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

    if (sub.status === 'active') {
      return res.status(400).json({ ok: false, message: 'Esta suscripción ya está activa' });
    }

    const customerName = typeof invoice_customer_name === 'string' ? invoice_customer_name.trim() : '';
    const customerEmail = typeof invoice_email === 'string' ? invoice_email.trim() : '';
    const documentType = typeof invoice_document_type === 'string'
      ? invoice_document_type.trim().toLowerCase()
      : '';
    const documentNumber = typeof invoice_document_number === 'string'
      ? invoice_document_number.trim()
      : '';

    if (!customerName) {
      return res.status(400).json({ ok: false, message: 'El nombre del cliente de la factura es obligatorio' });
    }
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ ok: false, message: 'Ingrese un correo válido para enviar la factura' });
    }
    if (!['cedula', 'ruc', 'pasaporte', 'consumidor_final'].includes(documentType) || !documentNumber) {
      return res.status(400).json({
        ok: false,
        message: 'Complete el tipo y número de identificación del cliente para emitir la factura',
      });
    }
    if (documentType === 'cedula' && !/^\d{10}$/.test(documentNumber)) {
      return res.status(400).json({ ok: false, message: 'La cédula del cliente debe tener 10 dígitos' });
    }
    if (documentType === 'ruc' && !/^\d{13}$/.test(documentNumber)) {
      return res.status(400).json({ ok: false, message: 'El RUC del cliente debe tener 13 dígitos' });
    }
    if (documentType === 'pasaporte' && documentNumber.length > 20) {
      return res.status(400).json({
        ok: false,
        message: 'El número de pasaporte del cliente no puede exceder 20 caracteres',
      });
    }
    if (documentType === 'consumidor_final' && documentNumber !== '9999999999999') {
      return res.status(400).json({ ok: false, message: 'La identificación de consumidor final no es válida' });
    }

    const amount = Number(sub.total_amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, message: 'El monto de la suscripción debe ser mayor a cero' });
    }

    const now = new Date();
    let baseDate = sub.status === 'pending_activation' || !sub.next_billing_at
      ? new Date(now)
      : new Date(sub.next_billing_at);
    if (baseDate < now) baseDate = new Date(now);

    const monthsPaid = sub.billing_period === 'annual' ? 12 : 1;
    const nextBilling = addMonthsClamped(baseDate, monthsPaid);
    const periodStart = baseDate.toISOString();
    const periodEnd = nextBilling.toISOString();

    const { rows: billingRows } = await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number,
          notes, payment_method, reference, period_start, period_end, months_paid,
          customer_name, customer_document_type, customer_document_number, customer_email,
          invoice_status)
       VALUES ($1, NOW(), $2, $3, 'paid', NULL, $4, $5, $6, $7, $8, $9,
               $10, $11, $12, $13, 'pendiente')
       RETURNING id`,
      [
        subId,
        sub.next_billing_at,
        amount,
        notes || null,
        payment_method || null,
        reference || null,
        periodStart,
        periodEnd,
        monthsPaid,
        customerName,
        documentType,
        documentNumber,
        customerEmail,
      ]
    );
    const billingHistoryId = billingRows[0].id;

    await query(
      `UPDATE public.subscriptions
       SET status = 'active',
           activated_at = COALESCE(activated_at, NOW()),
           next_billing_at = $1,
           paid_until = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [nextBilling.toISOString(), subId]
    );
    await query(
      `UPDATE public.businesses
       SET is_active = TRUE, updated_at = NOW()
       WHERE id = $1`,
      [sub.business_id]
    );

    let invoice;
    try {
      invoice = await issuePlatformPaymentInvoice(billingHistoryId);
    } catch (error) {
      logger.error({ err: error, billingHistoryId, subscriptionId: subId }, 'Payment invoice emission failed');
      try {
        await query(
          `UPDATE public.billing_history
           SET invoice_status = 'error', invoice_error = $1
           WHERE id = $2`,
          [error.message, billingHistoryId]
        );
      } catch (updateError) {
        logger.error({ err: updateError, billingHistoryId }, 'Could not save payment invoice error');
      }
      return res.status(502).json({
        ok: false,
        message: `Pago registrado, pero no se pudo emitir o enviar la factura: ${error.message}`,
        data: { billing_history_id: billingHistoryId, payment_recorded: true, invoice_status: 'error' },
      });
    }

    try {
      await sendPaymentConfirmedEmail(subId, ownerName, sub.owner_email, monthsPaid);
    } catch (emailError) {
      logger.error('Error enviando email de pago confirmado:', emailError);
    }

    logger.info({ subscriptionId: subId, billingHistoryId, invoiceNumber: invoice.invoice_number }, 'Payment and invoice completed');
    return res.json({
      ok: true,
      message: 'Pago registrado y factura emitida correctamente.',
      data: {
        billing_history_id: billingHistoryId,
        invoice_number: invoice.invoice_number,
        invoice_status: invoice.status,
        invoice_email: invoice.customer_email || customerEmail,
        next_billing_at: nextBilling,
        period_start: periodStart,
        period_end: periodEnd,
        months_paid: monthsPaid,
        status: 'active',
      }
    });

  } catch (error) {
    logger.error({ err: error, subscriptionId: req.params.subId }, 'Error registrando pago');
    return res.status(500).json({
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
    const {
      subscriptionId, notes, payment_method, reference, months = 1,
      invoice_customer_name, invoice_document_type, invoice_document_number, invoice_email,
    } = req.body;

    if (!subscriptionId) {
      logger.warn({ route: '/payments/record' }, 'Payment validation failed: subscriptionId is required');
      return res.status(400).json({ ok: false, message: 'subscriptionId es requerido' });
    }

    const monthsToAdd = parseInt(months, 10);
    if (![1, 2, 3, 6, 12].includes(monthsToAdd)) {
      logger.warn({ subscriptionId, months }, 'Payment validation failed: invalid billing months');
      return res.status(400).json({ ok: false, message: 'La cantidad de meses seleccionada no es válida' });
    }

    // Obtener suscripción con negocio y propietario
    const { rows: subRows } = await query(`
      SELECT 
        s.*,
        b.name AS business_name,
        u.id AS user_id,
        u.first_name,
        u.last_name,
        u.email AS owner_email,
        bo.id AS owner_id,
        bo.document_type,
        bo.document_number
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
    const documentType = invoice_document_type?.trim().toLowerCase();
    const documentNumber = invoice_document_number?.trim();
    const customerName = invoice_customer_name?.trim();
    const customerEmail = invoice_email?.trim();

    if (!customerName) {
      logger.warn({ subscriptionId }, 'Payment validation failed: invoice customer name is required');
      return res.status(400).json({ ok: false, message: 'El nombre del cliente de la factura es obligatorio' });
    }
    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      logger.warn({ subscriptionId }, 'Payment validation failed: invalid invoice customer email');
      return res.status(400).json({ ok: false, message: 'Ingrese un correo válido para enviar la factura' });
    }
    if (!['cedula', 'ruc', 'pasaporte', 'consumidor_final'].includes(documentType) || !documentNumber) {
      logger.warn({ subscriptionId, documentType }, 'Payment validation failed: invoice identification is incomplete');
      return res.status(400).json({ ok: false, message: 'Complete el tipo y número de identificación del cliente para emitir la factura' });
    }
    if (documentType === 'cedula' && !/^\d{10}$/.test(documentNumber)) {
      logger.warn({ subscriptionId }, 'Payment validation failed: invalid customer cedula');
      return res.status(400).json({ ok: false, message: 'La cédula del cliente debe tener 10 dígitos' });
    }
    if (documentType === 'ruc' && !/^\d{13}$/.test(documentNumber)) {
      logger.warn({ subscriptionId }, 'Payment validation failed: invalid customer RUC');
      return res.status(400).json({ ok: false, message: 'El RUC del cliente debe tener 13 dígitos' });
    }
    if (documentType === 'pasaporte' && documentNumber.length > 20) {
      logger.warn({ subscriptionId }, 'Payment validation failed: customer passport number is too long');
      return res.status(400).json({ ok: false, message: 'El número de pasaporte del cliente no puede exceder 20 caracteres' });
    }
    if (documentType === 'consumidor_final' && documentNumber !== '9999999999999') {
      logger.warn({ subscriptionId }, 'Payment validation failed: invalid final consumer identification');
      return res.status(400).json({ ok: false, message: 'La identificación de consumidor final no es válida' });
    }

    // No permitir pagos si suspendida
    if (sub.status === 'suspended') {
      logger.warn({ subscriptionId, status: sub.status }, 'Payment validation failed: subscription is suspended');
      return res.status(400).json({
        ok: false,
        message: 'No se puede registrar un pago para una suscripción suspendida. Primero reactívala.'
      });
    }

    const subscriptionAmount = Number(sub.total_amount);
    const monthlyAmount = sub.billing_period === 'annual'
      ? subscriptionAmount / 12
      : subscriptionAmount;
    const paymentAmount = Number((monthlyAmount * monthsToAdd).toFixed(2));
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      logger.warn({
        subscriptionId,
        billingPeriod: sub.billing_period,
        totalAmount: sub.total_amount,
        months: monthsToAdd,
      }, 'Payment validation failed: payment amount must be greater than zero');
      return res.status(400).json({ ok: false, message: 'El monto de la suscripción debe ser mayor a cero' });
    }

    // --- Calcular fecha base para sumar los meses ---
    const now = new Date();
    let baseDate = sub.status === 'pending_activation' || !sub.next_billing_at
      ? new Date(now)
      : new Date(sub.next_billing_at);
    if (baseDate < now) baseDate = new Date(now);

    // Sumar los meses pagados
    const newNextBilling = addMonthsClamped(baseDate, monthsToAdd);

    // --- Calcular el período cubierto por este pago ---
    const periodStart = baseDate.toISOString();
    const periodEnd = newNextBilling.toISOString();

    const { rows: billingRows } = await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, 
          notes, payment_method, reference, period_start, period_end, months_paid,
          customer_name, customer_document_type, customer_document_number, customer_email,
          invoice_status)
       VALUES ($1, NOW(), $2, $3, 'paid', NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pendiente')
       RETURNING id`,
      [
        sub.id,
        sub.next_billing_at,  // due_date (fecha de vencimiento anterior)
        paymentAmount,
        notes || null,
        payment_method || null,
        reference || null,
        periodStart,
        periodEnd,
        monthsToAdd,
        customerName,
        documentType || null,
        documentNumber || null,
        customerEmail || null,
      ]
    );
    const billingHistoryId = billingRows[0].id;

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

    let invoice = null;
    try {
      invoice = await issuePlatformPaymentInvoice(billingHistoryId);
    } catch (error) {
      try {
        await query(
          `UPDATE public.billing_history
              SET invoice_status = 'error', invoice_error = $1
            WHERE id = $2`,
          [error.message, billingHistoryId]
        );
      } catch (updateError) {
        logger.error({ err: updateError, billingHistoryId }, 'Could not persist platform invoice error status');
      }
      logger.error({ err: error, billingHistoryId }, 'Pago registrado, pero falló la emisión de su factura');
      return res.status(502).json({
        ok: false,
        message: `Pago registrado, pero no se pudo emitir o enviar la factura: ${error.message}`,
        data: {
          billing_history_id: billingHistoryId,
          payment_recorded: true,
          invoice_status: 'error',
        },
      });
    }

    logger.info(`[PAYMENT-RECORD] Pago registrado para suscripción ${sub.id}, meses=${monthsToAdd}, invoice ${invoice?.invoice_number || 'pendiente'}`);

    res.json({
      ok: true,
      message: `Pago de ${monthsToAdd} mes(es) registrado correctamente.`,
      data: {
        billing_history_id: billingHistoryId,
        invoice_number: invoice?.invoice_number || null,
        invoice_status: invoice?.status || null,
        invoice_email: invoice?.customer_email || customerEmail,
        amount: paymentAmount,
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
      message: 'Error al registrar el pago: ' + error.message,
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