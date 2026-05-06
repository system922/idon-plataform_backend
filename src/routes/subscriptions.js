import express from 'express';
import { query, getClient } from '../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// ── POST /admin/businesses/:businessId/subscribe ──────────────
router.post('/businesses/:businessId/subscribe', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const {
      billing_period      = 'monthly',
      billing_day         = 1,
      discount_percentage = 0,
    } = req.body;

    // Verificar que el negocio existe
    const { rows: bizRows } = await query(
      'SELECT id FROM public.businesses WHERE id = $1',
      [businessId]
    );
    if (bizRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    }

    // Verificar que no tenga ya suscripción
    const { rows: existingSub } = await query(
      'SELECT id FROM public.subscriptions WHERE business_id = $1',
      [businessId]
    );
    if (existingSub.length > 0) {
      return res.status(409).json({ ok: false, message: 'Este negocio ya tiene una suscripción' });
    }

    // Calcular precio desde módulos activos del negocio
    const { rows: modRows } = await query(`
      SELECT m.price_monthly, m.price_annual
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id = $1 AND bm.is_active = TRUE
    `, [businessId]);

    const amount_monthly_base = modRows.reduce((s, m) => s + parseFloat(m.price_monthly || 0), 0);
    const amount_annual_base  = modRows.reduce((s, m) => s + parseFloat(m.price_annual  || 0), 0);
    const disc                = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);
    const amount_monthly      = parseFloat((amount_monthly_base * (1 - disc / 100)).toFixed(2));
    const amount_annual       = parseFloat((amount_annual_base  * (1 - disc / 100)).toFixed(2));
    const total_amount        = billing_period === 'monthly' ? amount_monthly : amount_annual;

    // Calcular próxima fecha de facturación
    const now = new Date();
    const next_billing = new Date(now);
    if (billing_period === 'monthly') {
      next_billing.setMonth(next_billing.getMonth() + 1);
    } else {
      next_billing.setFullYear(next_billing.getFullYear() + 1);
    }

    // Insertar suscripción
    const { rows: newSub } = await query(`
      INSERT INTO public.subscriptions
        (business_id, status, billing_period, billing_day,
         amount_monthly, amount_annual, total_amount,
         discount_percentage,
         next_billing_at, activated_at, created_at, updated_at)
      VALUES
        ($1, 'active', $2, $3,
         $4, $5, $6,
         $7,
         $8, NOW(), NOW(), NOW())
      RETURNING *
    `, [
      businessId, billing_period, billing_day,
      amount_monthly, amount_annual, total_amount,
      disc,
      next_billing.toISOString()
    ]);

    // Insertar líneas de suscripción por módulo
    for (const mod of modRows) {
      await query(`
        INSERT INTO public.subscription_line_items
          (subscription_id, module_id, quantity, unit_price, total_price)
        SELECT $1, bm.module_id, 1,
          CASE WHEN $2 = 'monthly' THEN m.price_monthly ELSE m.price_annual END,
          CASE WHEN $2 = 'monthly' THEN m.price_monthly ELSE m.price_annual END
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $3 AND bm.is_active = TRUE
        ON CONFLICT (subscription_id, module_id) DO NOTHING
      `, [newSub[0].id, billing_period, businessId]);
    }

    logger.info(`[SUBSCRIPTION] Creada para business=${businessId} period=${billing_period} total=$${total_amount}`);
    res.status(201).json({ ok: true, message: 'Suscripción creada correctamente', data: newSub[0] });

  } catch (error) {
    logger.error('Error creando suscripción:', error);
    next(error);
  }
});

// ── GET /admin/businesses/:businessId/subscription ──────────────
// Obtener suscripción existente de un negocio
router.get('/businesses/:businessId/subscription', async (req, res, next) => {
  try {
    const { businessId } = req.params;

    const { rows } = await query(`
      SELECT 
        s.id, s.business_id, s.status, s.billing_period, s.billing_day,
        s.amount_monthly, s.amount_annual, s.total_amount, s.discount_percentage,
        s.next_billing_at, s.activated_at, s.created_at, s.updated_at,
        s.suspended_at,
        -- Calcular módulos activos del negocio para referencia
        (
          SELECT json_agg(json_build_object(
            'id', m.id, 'code', m.code, 'name', m.name,
            'price_monthly', m.price_monthly, 'price_annual', m.price_annual
          ))
          FROM public.business_modules bm
          JOIN public.modules m ON bm.module_id = m.id
          WHERE bm.business_id = s.business_id AND bm.is_active = TRUE
        ) AS active_modules
      FROM public.subscriptions s
      WHERE s.business_id = $1
      ORDER BY s.created_at DESC
      LIMIT 1
    `, [businessId]);

    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada para este negocio' });
    }

    res.json({ ok: true, data: rows[0] });
  } catch (error) {
    logger.error('Error obteniendo suscripción:', error);
    next(error);
  }
});

// ── PUT /admin/businesses/:businessId/subscription/:subId ─────────
// Actualiza una suscripción existente (RUTA QUE NECESITAS)
router.put('/businesses/:businessId/subscription/:subId', async (req, res, next) => {
  try {
    const { businessId, subId } = req.params;
    const { billing_period, billing_day, discount_percentage, status } = req.body;

    // Verificar que la suscripción existe y pertenece al negocio
    const { rows: subRows } = await query(
      'SELECT * FROM public.subscriptions WHERE id = $1 AND business_id = $2',
      [subId, businessId]
    );
    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }

    const sub = subRows[0];
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);
    const discountChanged = disc !== parseFloat(sub.discount_percentage || 0);
    const periodChanged = billing_period && billing_period !== sub.billing_period;

    let amount_monthly = sub.amount_monthly;
    let amount_annual = sub.amount_annual;
    let total_amount = sub.total_amount;

    // Si cambió el descuento o el período, recalcular montos
    if (discountChanged || periodChanged) {
      const { rows: modRows } = await query(`
        SELECT m.price_monthly, m.price_annual
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = TRUE
      `, [businessId]);

      const amount_monthly_base = modRows.reduce((s, m) => s + parseFloat(m.price_monthly || 0), 0);
      const amount_annual_base = modRows.reduce((s, m) => s + parseFloat(m.price_annual || 0), 0);
      amount_monthly = parseFloat((amount_monthly_base * (1 - disc / 100)).toFixed(2));
      amount_annual = parseFloat((amount_annual_base * (1 - disc / 100)).toFixed(2));
      total_amount = (billing_period || sub.billing_period) === 'monthly' ? amount_monthly : amount_annual;
    }

    // Calcular nueva próxima fecha de facturación si cambió el período
    let next_billing = sub.next_billing_at;
    if (periodChanged && next_billing) {
      const newPeriod = billing_period || sub.billing_period;
      const nextDate = new Date(next_billing);
      if (newPeriod === 'monthly') {
        nextDate.setMonth(nextDate.getMonth() + 1);
      } else {
        nextDate.setFullYear(nextDate.getFullYear() + 1);
      }
      next_billing = nextDate.toISOString();
    }

    const finalBillingPeriod = billing_period || sub.billing_period;
    const finalBillingDay = billing_day || sub.billing_day;

    await query(`
      UPDATE public.subscriptions
      SET
        billing_period = $1,
        billing_day = $2,
        amount_monthly = $3,
        amount_annual = $4,
        total_amount = $5,
        discount_percentage = $6,
        status = $7,
        next_billing_at = $8,
        updated_at = NOW()
      WHERE id = $9
    `, [finalBillingPeriod, finalBillingDay, amount_monthly, amount_annual, total_amount, disc, status || sub.status, next_billing, subId]);

    res.json({ ok: true, message: 'Suscripción actualizada correctamente' });
  } catch (error) {
    logger.error('Error actualizando suscripción:', error);
    next(error);
  }
});

// ── PATCH /admin/subscriptions/:subId/discount ───────────────
router.patch('/subscriptions/:subId/discount', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { discount_percentage = 0 } = req.body;
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);

    const { rows: subRows } = await query(
      'SELECT billing_period, amount_monthly, amount_annual FROM public.subscriptions WHERE id = $1',
      [subId]
    );
    if (subRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }

    const sub = subRows[0];
    const baseAmount = sub.billing_period === 'monthly'
      ? parseFloat(sub.amount_monthly)
      : parseFloat(sub.amount_annual);
    const total_amount = parseFloat((baseAmount * (1 - disc / 100)).toFixed(2));

    await query(
      `UPDATE public.subscriptions
       SET discount_percentage = $1, total_amount = $2, updated_at = NOW()
       WHERE id = $3`,
      [disc, total_amount, subId]
    );

    res.json({ ok: true, message: 'Descuento actualizado correctamente', data: { discount_percentage: disc, total_amount } });
  } catch (error) {
    logger.error('Error actualizando descuento:', error);
    next(error);
  }
});

// ── POST /admin/subscriptions/:subId/mark-paid ───────────────
router.post('/subscriptions/:subId/mark-paid', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { notes } = req.body;
    const { rows: subRows } = await query('SELECT * FROM public.subscriptions WHERE id=$1', [subId]);
    if (!subRows.length) {
      return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    }
    const sub = subRows[0];

    const nextBilling = new Date(sub.next_billing_at || new Date());
    if (sub.billing_period === 'monthly') {
      nextBilling.setMonth(nextBilling.getMonth() + 1);
    } else {
      nextBilling.setFullYear(nextBilling.getFullYear() + 1);
    }

    const invoiceNumber = `INV-${Date.now()}`;

    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, notes)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5)`,
      [subId, sub.next_billing_at, sub.total_amount, invoiceNumber, notes || null]
    );

    await query(
      `UPDATE public.subscriptions
       SET status='active', next_billing_at=$1, updated_at=NOW()
       WHERE id=$2`,
      [nextBilling.toISOString(), subId]
    );

    await query(
      'UPDATE public.businesses SET is_active=TRUE, updated_at=NOW() WHERE id=(SELECT business_id FROM public.subscriptions WHERE id=$1)',
      [subId]
    );

    res.json({ ok: true, message: 'Pago registrado', invoice_number: invoiceNumber, next_billing_at: nextBilling });
  } catch (error) {
    logger.error('Error registrando pago:', error);
    next(error);
  }
});

// ── POST /admin/subscriptions/:subId/suspend ─────────────────
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
  } catch (error) {
    logger.error('Error suspendiendo negocio:', error);
    next(error);
  }
});

// ── GET /admin/payments (versión simplificada) ────────────────
router.get('/payments', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        b.id AS business_id, b.name AS business_name, b.slug, b.is_active AS business_active,
        bt.name AS business_type,
        s.id AS sub_id, s.status AS sub_status, s.billing_period, s.billing_day,
        s.amount_monthly, s.amount_annual, s.total_amount, s.discount_percentage,
        s.next_billing_at, s.activated_at,
        bo.first_name || ' ' || bo.last_name AS owner_name, bo.email AS owner_email
      FROM public.businesses b
      JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      LEFT JOIN public.business_owners bo ON bo.user_id = bu.user_id
      ORDER BY s.next_billing_at ASC NULLS LAST, b.name
    `);
    res.json({ ok: true, data: rows });
  } catch (error) {
    logger.error('Error obteniendo pagos:', error);
    next(error);
  }
});

// ── GET /admin/billing-history ────────────────────────────────
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
  } catch (error) {
    logger.error('Error obteniendo historial de facturación:', error);
    next(error);
  }
});

export default router;