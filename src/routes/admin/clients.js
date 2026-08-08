import express from 'express';
import { query, getClient } from '../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// GET /api/admin/clients
router.get('/clients', async (req, res, next) => {
  try {
    const { rows: owners } = await query(`
      SELECT
        bo.id AS owner_id, bo.first_name, bo.last_name, bo.email, bo.phone,
        bo.document_type, bo.document_number, bo.user_id,
        u.is_active, u.email_verified, u.created_at
      FROM public.business_owners bo
      JOIN public.users u ON bo.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    const { rows: businesses } = await query(`
      SELECT
        b.id, b.slug, b.name AS business_name, b.schema_name, b.is_active, b.is_verified,
        bt.name AS business_type_name, bt.code AS business_type_code,
        bu.user_id,
        s.id AS sub_id, s.status AS sub_status, s.billing_period,
        s.amount_monthly, s.amount_annual, s.total_amount, s.next_billing_at, s.activated_at,
        (
          SELECT json_agg(json_build_object(
            'id', m.id, 'code', m.code, 'name', m.name,
            'price_monthly', m.price_monthly, 'price_annual', m.price_annual, 'icon', m.icon
          ))
          FROM public.business_modules bm
          JOIN public.modules m ON bm.module_id = m.id
          WHERE bm.business_id = b.id AND bm.is_active = TRUE
        ) AS modules
      FROM public.businesses b
      JOIN public.business_types bt ON b.business_type_id = bt.id
      JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      ORDER BY b.created_at DESC
    `);

    const bizByUser = {};
    for (const biz of businesses) {
      if (!bizByUser[biz.user_id]) bizByUser[biz.user_id] = [];
      bizByUser[biz.user_id].push({
        id: biz.id, slug: biz.slug, business_name: biz.business_name,
        schema_name: biz.schema_name, is_active: biz.is_active, is_verified: biz.is_verified,
        business_type_name: biz.business_type_name, business_type_code: biz.business_type_code,
        modules: biz.modules || [],
        subscription: biz.sub_id ? {
          id: biz.sub_id, status: biz.sub_status, billing_period: biz.billing_period,
          amount_monthly: biz.amount_monthly, amount_annual: biz.amount_annual,
          total_amount: biz.total_amount, next_billing_at: biz.next_billing_at,
          activated_at: biz.activated_at,
        } : null,
      });
    }

    const data = owners.map(o => ({
      id: o.owner_id, user_id: o.user_id,
      first_name: o.first_name, last_name: o.last_name,
      full_name: `${o.first_name} ${o.last_name || ''}`.trim(),
      email: o.email, phone: o.phone,
      document_type: o.document_type, document_number: o.document_number,
      is_active: o.is_active, email_verified: o.email_verified, created_at: o.created_at,
      businesses: bizByUser[o.user_id] || [],
    }));

    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    logger.error('Error cargando clientes:', error);
    next(error);
  }
});

// PUT /api/admin/clients/:ownerId
router.put('/clients/:ownerId', async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    const { first_name, last_name, email, phone, document_type, document_number } = req.body;

    await query(
      `UPDATE public.business_owners
       SET first_name=$1, last_name=$2, email=$3, phone=$4,
           document_type=$5, document_number=$6, updated_at=NOW()
       WHERE id=$7`,
      [first_name, last_name, email, phone, document_type, document_number, ownerId]
    );

    const { rows } = await query('SELECT user_id FROM public.business_owners WHERE id=$1', [ownerId]);
    if (rows.length > 0) {
      await query(
        'UPDATE public.users SET email=$1, first_name=$2, last_name=$3, phone=$4, updated_at=NOW() WHERE id=$5',
        [email, first_name, last_name, phone, rows[0].user_id]
      );
    }

    res.json({ ok: true, message: 'Cliente actualizado correctamente' });
  } catch (error) {
    logger.error('Error actualizando cliente:', error);
    next(error);
  }
});

// PUT /api/admin/businesses/:businessId
router.put('/businesses/:businessId', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { name } = req.body;
    await query('UPDATE public.businesses SET name=$1, updated_at=NOW() WHERE id=$2', [name, businessId]);
    res.json({ ok: true, message: 'Negocio actualizado correctamente' });
  } catch (error) {
    logger.error('Error actualizando negocio:', error);
    next(error);
  }
});

// POST /api/admin/businesses/:businessId/subscribe
// POST /api/admin/businesses/:businessId/subscribe
router.post('/businesses/:businessId/subscribe', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { billing_period = 'monthly', billing_day = 1, discount_percentage = 0 } = req.body;

    const { rows: bizRows } = await query('SELECT id FROM public.businesses WHERE id=$1', [businessId]);
    if (!bizRows.length) return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });

    const { rows: existingSub } = await query(
      'SELECT id FROM public.subscriptions WHERE business_id=$1', [businessId]
    );
    if (existingSub.length > 0)
      return res.status(409).json({ ok: false, message: 'Este negocio ya tiene una suscripción' });

    // ✅ OBTENER MÓDULOS CON PRECIOS CORRECTOS
    const { rows: modRows } = await query(`
      SELECT 
        m.id,
        COALESCE(m.price_monthly, 0) as price_monthly, 
        COALESCE(m.price_annual, 0) as price_annual
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id=$1 AND bm.is_active=TRUE
    `, [businessId]);

    // ✅ Calcular subtotales base (SIN descuento)
    const amount_monthly_base = modRows.reduce((s, m) => s + parseFloat(m.price_monthly || 0), 0);
    const amount_annual_base  = modRows.reduce((s, m) => s + parseFloat(m.price_annual || 0), 0);

    // ✅ Asegurar que el descuento sea un número válido (0-100)
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);
    
    // ✅ Calcular montos CON descuento
    const amount_monthly = parseFloat((amount_monthly_base * (1 - disc / 100)).toFixed(2));
    const amount_annual  = parseFloat((amount_annual_base  * (1 - disc / 100)).toFixed(2));
    const total_amount   = billing_period === 'monthly' ? amount_monthly : amount_annual;

    const next_billing = new Date();
    if (billing_period === 'monthly') next_billing.setMonth(next_billing.getMonth() + 1);
    else next_billing.setFullYear(next_billing.getFullYear() + 1);

    const { rows: newSub } = await query(`
      INSERT INTO public.subscriptions
        (business_id, status, billing_period, billing_day,
         amount_monthly, amount_annual, total_amount, discount_percentage,
         next_billing_at, activated_at, created_at, updated_at)
      VALUES ($1, 'active', $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
      RETURNING *
    `, [businessId, billing_period, billing_day, amount_monthly, amount_annual, total_amount, disc, next_billing.toISOString()]);

    // ✅ INSERTAR EN subscription_line_items con los precios BASE (sin descuento)
    for (const mod of modRows) {
      const unitPrice = billing_period === 'monthly' ? mod.price_monthly : mod.price_annual;
      await query(`
        INSERT INTO public.subscription_line_items
          (subscription_id, module_id, quantity, unit_price, total_price)
        VALUES ($1, $2, 1, $3, $3)
        ON CONFLICT (subscription_id, module_id) DO UPDATE SET
          unit_price = $3,
          total_price = $3,
          updated_at = NOW()
      `, [newSub[0].id, mod.id, unitPrice]);
    }

    logger.info(`[SUBSCRIPTION] Creada para business=${businessId} period=${billing_period} total=$${total_amount} descuento=${disc}%`);
    res.status(201).json({ ok: true, message: 'Suscripción creada correctamente', data: newSub[0] });
  } catch (error) {
    logger.error('Error creando suscripción:', error);
    next(error);
  }
});

// PUT /api/admin/businesses/:businessId/subscription/:subId
router.put('/businesses/:businessId/subscription/:subId', async (req, res, next) => {
  try {
    const { subId, businessId } = req.params;
    const { billing_period, billing_day, discount_percentage, status } = req.body;

    // ✅ OBTENER MÓDULOS CON PRECIOS CORRECTOS
    const { rows: modRows } = await query(`
      SELECT 
        m.id,
        COALESCE(m.price_monthly, 0) as price_monthly, 
        COALESCE(m.price_annual, 0) as price_annual
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id=$1 AND bm.is_active=TRUE
    `, [businessId]);

    // ✅ Calcular subtotales base (SIN descuento)
    const base_monthly = modRows.reduce((s, m) => s + parseFloat(m.price_monthly || 0), 0);
    const base_annual  = modRows.reduce((s, m) => s + parseFloat(m.price_annual || 0), 0);

    // ✅ Asegurar que el descuento sea un número válido (0-100)
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);
    
    // ✅ Calcular montos CON descuento
    const amount_monthly = parseFloat((base_monthly * (1 - disc / 100)).toFixed(2));
    const amount_annual  = parseFloat((base_annual  * (1 - disc / 100)).toFixed(2));
    const total_amount   = billing_period === 'monthly' ? amount_monthly : amount_annual;

    const { rows } = await query(`
      UPDATE public.subscriptions
      SET billing_period=$1, billing_day=$2, discount_percentage=$3, status=$4,
          amount_monthly=$5, amount_annual=$6, total_amount=$7, updated_at=NOW()
      WHERE id=$8 AND business_id=$9 RETURNING *
    `, [billing_period, billing_day || 1, disc, status || 'active',
        amount_monthly, amount_annual, total_amount, subId, businessId]);

    if (!rows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });

    // ✅ ACTUALIZAR subscription_line_items con los precios BASE (sin descuento)
    await query('DELETE FROM public.subscription_line_items WHERE subscription_id = $1', [subId]);
    for (const mod of modRows) {
      const unitPrice = billing_period === 'monthly' ? mod.price_monthly : mod.price_annual;
      await query(`
        INSERT INTO public.subscription_line_items
          (subscription_id, module_id, quantity, unit_price, total_price)
        VALUES ($1, $2, 1, $3, $3)
      `, [subId, mod.id, unitPrice]);
    }
    
    logger.info(`[SUBSCRIPTION] Actualizada business=${businessId} period=${billing_period} total=$${total_amount} descuento=${disc}%`);
    res.json({ ok: true, message: 'Suscripción actualizada correctamente', data: rows[0] });
  } catch (error) {
    logger.error('Error actualizando suscripción:', error);
    next(error);
  }
});

// GET /api/admin/businesses/:businessId/subscription
router.get('/businesses/:businessId/subscription', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { rows } = await query(
      'SELECT * FROM public.subscriptions WHERE business_id=$1 LIMIT 1',
      [businessId]
    );
    res.json({ ok: true, data: rows[0] || null });
  } catch (error) { next(error); }
});

// PUT /api/admin/businesses/:businessId/subscription/:subId
router.put('/businesses/:businessId/subscription/:subId', async (req, res, next) => {
  try {
    const { subId, businessId } = req.params;
    const { billing_period, billing_day, discount_percentage, status } = req.body;

    const { rows: modRows } = await query(`
      SELECT m.price_monthly, m.price_annual
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id=$1 AND bm.is_active=TRUE
    `, [businessId]);

    const base_monthly = modRows.reduce((s, m) => s + parseFloat(m.price_monthly || 0), 0);
    const base_annual  = modRows.reduce((s, m) => s + parseFloat(m.price_annual  || 0), 0);
    const disc         = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);
    const amount_monthly = parseFloat((base_monthly * (1 - disc / 100)).toFixed(2));
    const amount_annual  = parseFloat((base_annual  * (1 - disc / 100)).toFixed(2));
    const total_amount   = billing_period === 'monthly' ? amount_monthly : amount_annual;

    const { rows } = await query(`
      UPDATE public.subscriptions
      SET billing_period=$1, billing_day=$2, discount_percentage=$3, status=$4,
          amount_monthly=$5, amount_annual=$6, total_amount=$7, updated_at=NOW()
      WHERE id=$8 AND business_id=$9 RETURNING *
    `, [billing_period, billing_day || 1, disc, status || 'active',
        amount_monthly, amount_annual, total_amount, subId, businessId]);

    if (!rows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    res.json({ ok: true, message: 'Suscripción actualizada correctamente', data: rows[0] });
  } catch (error) {
    logger.error('Error actualizando suscripción:', error);
    next(error);
  }
});

// GET /api/admin/businesses/:businessId/modules
router.get('/businesses/:businessId/modules', async (req, res, next) => {
  try {
    const { businessId } = req.params;

    const { rows: modRows } = await query(`
      SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual, m.icon, m.sort_order
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id=$1 AND bm.is_active=TRUE ORDER BY m.sort_order
    `, [businessId]);

    const { rows: featRows } = await query(`
      SELECT f.id, f.code, f.name, f.module_id, f.is_premium
      FROM public.business_features bf
      JOIN public.features f ON bf.feature_id=f.id
      WHERE bf.business_id=$1 AND bf.is_active=TRUE
    `, [businessId]);

    res.json({ ok: true, data: { moduleIds: modRows.map(m => m.id), featureIds: featRows.map(f => f.id) } });
  } catch (error) {
    logger.error('Error cargando módulos del negocio:', error);
    next(error);
  }
});

// PUT /api/admin/businesses/:businessId/modules
router.put('/businesses/:businessId/modules', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { moduleIds = [], featureIds = [] } = req.body;

    const { rows: bizRows } = await query('SELECT id FROM public.businesses WHERE id=$1', [businessId]);
    if (!bizRows.length) return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });

    const client = await getClient();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM public.business_modules WHERE business_id=$1', [businessId]);
      for (const moduleId of moduleIds) {
        await client.query(`
          INSERT INTO public.business_modules
            (business_id, module_id, is_active, activated_at, created_at, updated_at)
          VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
          ON CONFLICT (business_id, module_id) DO UPDATE SET is_active=TRUE, activated_at=NOW(), updated_at=NOW()
        `, [businessId, moduleId]);
      }
      await client.query('DELETE FROM public.business_features WHERE business_id=$1', [businessId]);
      for (const featureId of featureIds) {
        await client.query(`
          INSERT INTO public.business_features
            (business_id, feature_id, is_active, activated_at, created_at, updated_at)
          VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
          ON CONFLICT (business_id, feature_id) DO UPDATE SET is_active=TRUE, activated_at=NOW(), updated_at=NOW()
        `, [businessId, featureId]);
      }
      await client.query('COMMIT');
      logger.info(`[MODULES] Actualizados para business=${businessId} mods=${moduleIds.length} feats=${featureIds.length}`);
      logger.info(`[MODULES] featureIds guardados: ${JSON.stringify(featureIds)}`);
      // Verificar qué quedó en business_features
      const { rows: saved } = await client.query(
        `SELECT f.id, f.code FROM public.business_features bf JOIN public.features f ON bf.feature_id=f.id WHERE bf.business_id=$1`,
        [businessId]
      );
      logger.info(`[MODULES] Features activas tras guardar: ${saved.map(r => r.code).join(', ')}`);
      res.json({ ok: true, message: 'Módulos del negocio actualizados correctamente' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error guardando módulos del negocio:', error);
    next(error);
  }
});

export default router;
