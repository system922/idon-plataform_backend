import express from 'express';
import { provisionBusinessFromRequest } from '../services/provisioningService.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { query, getClient } from '../config/database.js';
import logger from '../utils/logger.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { notifyAprobacion, notifySuscripcion, notifyPagoRecibido, notifyRecordatorio, testSend } from '../utils/waNotifications.js';

const router = express.Router();

// ── Approve ──────────────────────────────────────────────────
router.post('/:requestId/approve', async (req, res, next) => {
  const { requestId } = req.params;
  const { adminId } = req.body;
  logger.info(`[ADMIN] Approve requestId=${requestId}, adminId=${adminId}`);

  try {
    // Obtener datos del solicitante antes de provisionar (para notificación WA)
    const { rows: reqRows } = await query(
      `SELECT owner_first_name, owner_last_name, owner_phone, owner_email, business_name, slug
       FROM public.business_registration_requests WHERE id=$1`,
      [requestId]
    );
    const reqData = reqRows[0] || {};

    logger.info(`[APPROVE] Iniciando provisión para request: ${requestId}`);
    const result = await provisionBusinessFromRequest(requestId, adminId);
    logger.info(`[APPROVE] Provisión exitosa para request: ${requestId}`, result);

    res.json(successResponse(result, 'Business approved and provisioned successfully'));

    notifyAprobacion(reqData.owner_phone, {
      firstName:    reqData.owner_first_name || '',
      lastName:     reqData.owner_last_name  || '',
      businessName: reqData.business_name    || '',
      businessSlug: reqData.slug             || '',
    });
  } catch (error) {
    // Log extendido
    logger.error(
      { err: error, code: error?.code, detail: error?.detail, hint: error?.hint },
      `[APPROVE] Error en provisión para request ${requestId}`
    );
    // Revisa si es not found
    if (error.message && error.message.includes('not found')) {
      return res.status(404).json(errorResponse(error.message, 404));
    }
    // Responde error 500, pero ya queda logueado
    res.status(500).json(errorResponse('Internal server error', 500, error.message));
  }
});

// ── Reject ───────────────────────────────────────────────────
router.post('/:requestId/reject', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { adminId, rejectionReason } = req.body;
    await query(
      `UPDATE public.business_registration_requests
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3
       WHERE id = $4`,
      ['rejected', adminId, rejectionReason, requestId]
    );
    res.json(successResponse(null, 'Registration request rejected'));
  } catch (error) {
    logger.error('Error rejecting registration:', error);
    next(error);
  }
});

// ── Pending only ─────────────────────────────────────────────
router.get('/pending', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT brr.id, brr.slug, brr.business_name,
              brr.owner_first_name, brr.owner_last_name, brr.owner_email,
              brr.owner_document_number, brr.owner_phone, brr.requested_at
       FROM public.business_registration_requests brr
       WHERE brr.status = 'pending'
       ORDER BY brr.requested_at ASC`
    );
    res.json(successResponse(result.rows, 'Pending registrations fetched'));
  } catch (error) {
    logger.error('Error fetching pending:', error);
    next(error);
  }
});

// ── Users list ───────────────────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, is_active, created_at, updated_at
       FROM public.users ORDER BY created_at DESC`
    );
    res.json(successResponse(result.rows, 'Usuarios listados correctamente'));
  } catch (error) {
    logger.error('Error listando usuarios:', error);
    res.status(500).json(errorResponse('Error listando usuarios', 500, error.message));
  }
});

// ── Stats ────────────────────────────────────────────────────
router.get('/stats', async (req, res, next) => {
  try {
    const [businesses, pending, modules, subscriptions, users] = await Promise.all([
      query('SELECT COUNT(*) FROM public.businesses WHERE is_active = TRUE'),
      query("SELECT COUNT(*) FROM public.business_registration_requests WHERE status = 'pending'"),
      query('SELECT COUNT(*) FROM public.modules'),
      query(`SELECT COALESCE(SUM(amount_monthly),0) as total FROM public.subscriptions
             WHERE status = 'active' AND date_trunc('month', created_at) = date_trunc('month', NOW())`),
      query('SELECT COUNT(*) FROM public.users'),
    ]);
    res.json(successResponse({
      activeBusinesses:  parseInt(businesses.rows[0].count, 10),
      pendingRequests:   parseInt(pending.rows[0].count, 10),
      totalModules:      parseInt(modules.rows[0].count, 10),
      monthlyRevenue:    parseFloat(subscriptions.rows[0].total),
      totalUsers:        parseInt(users.rows[0].count, 10),
    }, 'Stats fetched'));
  } catch (error) {
    logger.error('Error obteniendo stats:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas', details: error.message });
  }
});

// ── ALL Requests — única ruta, devuelve todos los campos ─────
router.get('/requests', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT
        brr.id,
        brr.slug,
        brr.business_name,
        bt.code          AS business_type_code,
        bt.name          AS business_type_name,
        brr.owner_first_name,
        brr.owner_last_name,
        brr.owner_first_name || ' ' || brr.owner_last_name AS contact_name,
        brr.owner_email,
        brr.owner_phone,
        brr.owner_document_number,
        brr.owner_document_type,
        brr.status,
        brr.rejection_reason,
        brr.requested_at,
        brr.reviewed_at,
        -- ID del negocio creado (solo si está aprobado)
        b.id             AS business_id,
        (
          SELECT string_agg(m.code, ',')
          FROM public.business_registration_request_modules brm
          JOIN public.modules m ON brm.module_id = m.id
          WHERE brm.request_id = brr.id
        ) AS requested_modules,
        (
          SELECT string_agg(f.code, ',')
          FROM public.business_registration_request_features brf
          JOIN public.features f ON brf.feature_id = f.id
          WHERE brf.request_id = brr.id
        ) AS requested_features
      FROM public.business_registration_requests brr
      LEFT JOIN public.business_types bt ON brr.business_type_id = bt.id
      LEFT JOIN public.businesses b ON b.slug = brr.slug
      ORDER BY brr.requested_at DESC
    `);

    const data = result.rows.map(row => ({
      id:                  row.id,
      slug:                row.slug,
      // Empresa
      business_name:       row.business_name,
      // Tipo de negocio — tanto código como nombre legible
      business_type_code:  row.business_type_code  || '',
      business_type_name:  row.business_type_name  || '',
      business_id:         row.business_id || null,
      // Propietario
      contact_name:        row.contact_name,
      owner_first_name:    row.owner_first_name,
      owner_last_name:     row.owner_last_name,
      owner_email:         row.owner_email,
      owner_phone:         row.owner_phone,
      owner_document_number: row.owner_document_number,
      owner_document_type:   row.owner_document_type,
      // Estado (en inglés — el frontend hace la traducción)
      status:              row.status,
      rejection_reason:    row.rejection_reason || null,
      // Fechas
      requested_at:        row.requested_at,
      reviewed_at:         row.reviewed_at || null,
      // Módulos y features como arrays
      requested_modules:   row.requested_modules
                             ? row.requested_modules.split(',').map(m => m.trim())
                             : [],
      requested_features:  row.requested_features
                             ? row.requested_features.split(',').map(f => f.trim())
                             : [],
    }));

    res.json({ data, total: data.length });
  } catch (error) {
    logger.error('Error obteniendo solicitudes:', error);
    next(error);
  }
});


// ── Módulos con sus features (para el modal del admin) ───────
router.get('/modules-with-features', async (req, res, next) => {
  try {
    // Todos los módulos activos
    const { rows: modules } = await query(
      `SELECT id, code, name, description, icon, price_monthly
       FROM public.modules
       WHERE is_active = TRUE
       ORDER BY sort_order, name`
    );

    // Todas las features activas con su módulo
    const { rows: features } = await query(
      `SELECT id, code, name, description, module_id, is_premium
       FROM public.features
       WHERE is_active = TRUE
       ORDER BY name`
    );

    // Agrupar features por módulo
    const data = modules.map(mod => ({
      ...mod,
      features: features.filter(f => f.module_id === mod.id),
    }));

    res.json({ data });
  } catch (error) {
    logger.error('Error cargando módulos con features:', error);
    next(error);
  }
});

// ── Guardar módulos/features seleccionados por el admin ──────
router.post('/requests/:requestId/save-modules', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { moduleIds = [], featureIds = [] } = req.body;

    // Verificar que la solicitud existe y está pendiente
    const { rows } = await query(
      `SELECT id, status FROM public.business_registration_requests WHERE id = $1`,
      [requestId]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, message: 'Solicitud no encontrada' });

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Limpiar selección anterior
      await client.query(
        `DELETE FROM public.business_registration_request_modules WHERE request_id = $1`,
        [requestId]
      );
      await client.query(
        `DELETE FROM public.business_registration_request_features WHERE request_id = $1`,
        [requestId]
      );

      // Insertar módulos seleccionados
      for (const moduleId of moduleIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_modules (id, request_id, module_id)
           VALUES (gen_random_uuid(), $1, $2)
           ON CONFLICT (request_id, module_id) DO NOTHING`,
          [requestId, moduleId]
        );
      }

      // Insertar features seleccionadas
      for (const featureId of featureIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_features (id, request_id, feature_id)
           VALUES (gen_random_uuid(), $1, $2)
           ON CONFLICT (request_id, feature_id) DO NOTHING`,
          [requestId, featureId]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, message: 'Selección guardada correctamente' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error guardando módulos:', error);
    next(error);
  }
});


// ── PATCH /admin/subscriptions/:subId/discount ───────────────
// Actualiza el descuento de una suscripción existente
router.patch('/subscriptions/:subId/discount', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { discount_percentage = 0 } = req.body;
    const disc = Math.min(Math.max(parseFloat(discount_percentage) || 0, 0), 100);

    // Recalcular total con el nuevo descuento
    const { rows: subRows } = await query(
      'SELECT billing_period, amount_monthly, amount_annual FROM public.subscriptions WHERE id = $1',
      [subId]
    );
    if (subRows.length === 0) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });

    const sub         = subRows[0];
    const baseAmount  = sub.billing_period === 'monthly'
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


// ── GET /admin/businesses/:businessId/modules ────────────────
// Lee módulos y features actuales del negocio (business_modules/features)
// Esto es la fuente de verdad para el sidebar del negocio
router.get('/businesses/:businessId/modules', async (req, res, next) => {
  try {
    const { businessId } = req.params;

    const { rows: modRows } = await query(`
      SELECT m.id, m.code, m.name, m.description,
             m.price_monthly, m.price_annual, m.icon, m.sort_order
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id = $1 AND bm.is_active = TRUE
      ORDER BY m.sort_order
    `, [businessId]);

    const { rows: featRows } = await query(`
      SELECT f.id, f.code, f.name, f.module_id, f.is_premium
      FROM public.business_features bf
      JOIN public.features f ON bf.feature_id = f.id
      WHERE bf.business_id = $1 AND bf.is_active = TRUE
    `, [businessId]);

    res.json({
      ok: true,
      data: {
        moduleIds:  modRows.map(m => m.id),
        featureIds: featRows.map(f => f.id),
      }
    });
  } catch (error) {
    logger.error('Error cargando módulos del negocio:', error);
    next(error);
  }
});

// ── PUT /admin/businesses/:businessId/modules ────────────────
// Guarda módulos y features en business_modules/features
// Usado desde Clientes.jsx y Requests.jsx (aprobadas)
// Es lo que alimenta el sidebar del negocio
router.put('/businesses/:businessId/modules', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { moduleIds = [], featureIds = [] } = req.body;

    // Verificar negocio existe
    const { rows: bizRows } = await query(
      'SELECT id FROM public.businesses WHERE id = $1',
      [businessId]
    );
    if (bizRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Reemplazar módulos
      await client.query(
        'DELETE FROM public.business_modules WHERE business_id = $1',
        [businessId]
      );
      for (const moduleId of moduleIds) {
        await client.query(`
          INSERT INTO public.business_modules
            (business_id, module_id, is_active, activated_at, created_at, updated_at)
          VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
          ON CONFLICT (business_id, module_id) DO UPDATE
            SET is_active = TRUE, activated_at = NOW(), updated_at = NOW()
        `, [businessId, moduleId]);
      }

      // Reemplazar features
      await client.query(
        'DELETE FROM public.business_features WHERE business_id = $1',
        [businessId]
      );
      for (const featureId of featureIds) {
        await client.query(`
          INSERT INTO public.business_features
            (business_id, feature_id, is_active, activated_at, created_at, updated_at)
          VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
          ON CONFLICT (business_id, feature_id) DO UPDATE
            SET is_active = TRUE, activated_at = NOW(), updated_at = NOW()
        `, [businessId, featureId]);
      }

      await client.query('COMMIT');
      logger.info(`[MODULES] Actualizados para business=${businessId} mods=${moduleIds.length} feats=${featureIds.length}`);
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

// ════════════════════════════════════════════════════════════
// PLATFORM SETTINGS (configuración global IDON)
// ════════════════════════════════════════════════════════════

/** GET /api/admin/platform-settings — devuelve todas las claves */
router.get('/platform-settings', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value, label FROM public.platform_settings ORDER BY key');
    // Devuelve objeto { key: value, ... } para facilitar el uso en frontend
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(successResponse(settings, 'OK'));
  } catch (error) {
    next(error);
  }
});

/** PUT /api/admin/platform-settings — guarda una o varias claves */
router.put('/platform-settings', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const updates = req.body; // { key: value, ... }
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json(errorResponse('Body debe ser un objeto { key: value }', 400));
    }
    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO public.platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value ?? '')]
      );
    }
    res.json(successResponse(null, 'Configuración guardada'));
  } catch (error) {
    next(error);
  }
});

export default router;

// ── GET /admin/clients ────────────────────────────────────────
// Devuelve usuarios (dueños) con sus negocios y suscripciones
router.get('/clients', async (req, res, next) => {
  try {
    // 1. Todos los business_owners con su user
    const { rows: owners } = await query(`
      SELECT
        bo.id            AS owner_id,
        bo.first_name,
        bo.last_name,
        bo.email,
        bo.phone,
        bo.document_type,
        bo.document_number,
        bo.user_id,
        u.is_active,
        u.email_verified,
        u.created_at
      FROM public.business_owners bo
      JOIN public.users u ON bo.user_id = u.id
      ORDER BY u.created_at DESC
    `);

    // 2. Todos los negocios aprobados con suscripción y módulos
    const { rows: businesses } = await query(`
      SELECT
        b.id,
        b.slug,
        b.name             AS business_name,
        b.schema_name,
        b.is_active,
        b.is_verified,
        bt.name            AS business_type_name,
        bt.code            AS business_type_code,
        bu.user_id,
        -- Suscripción
        s.id               AS sub_id,
        s.status           AS sub_status,
        s.billing_period,
        s.amount_monthly,
        s.amount_annual,
        s.total_amount,
        s.next_billing_at,
        s.activated_at,
        -- Módulos activos (agregado)
        (
          SELECT json_agg(json_build_object(
            'id', m.id, 'code', m.code, 'name', m.name,
            'price_monthly', m.price_monthly, 'price_annual', m.price_annual,
            'icon', m.icon
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

    // 3. Agrupar negocios por user_id
    const bizByUser = {};
    for (const biz of businesses) {
      if (!bizByUser[biz.user_id]) bizByUser[biz.user_id] = [];
      bizByUser[biz.user_id].push({
        id:                biz.id,
        slug:              biz.slug,
        business_name:     biz.business_name,
        schema_name:       biz.schema_name,
        is_active:         biz.is_active,
        is_verified:       biz.is_verified,
        business_type_name: biz.business_type_name,
        business_type_code: biz.business_type_code,
        modules:           biz.modules || [],
        subscription: biz.sub_id ? {
          id:            biz.sub_id,
          status:        biz.sub_status,
          billing_period: biz.billing_period,
          amount_monthly: biz.amount_monthly,
          amount_annual:  biz.amount_annual,
          total_amount:   biz.total_amount,
          next_billing_at: biz.next_billing_at,
          activated_at:   biz.activated_at,
        } : null,
      });
    }

    // 4. Combinar owners con sus negocios
    const data = owners.map(o => ({
      id:              o.owner_id,
      user_id:         o.user_id,
      first_name:      o.first_name,
      last_name:       o.last_name,
      full_name:       `${o.first_name} ${o.last_name || ''}`.trim(),
      email:           o.email,
      phone:           o.phone,
      document_type:   o.document_type,
      document_number: o.document_number,
      is_active:       o.is_active,
      email_verified:  o.email_verified,
      created_at:      o.created_at,
      businesses:      bizByUser[o.user_id] || [],
    }));

    res.json({ ok: true, data, total: data.length });
  } catch (error) {
    logger.error('Error cargando clientes:', error);
    next(error);
  }
});

// ── POST /admin/businesses/:businessId/subscribe ──────────────
// Crea una suscripción para un negocio
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
    if (bizRows.length === 0) return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });

    // Verificar que no tenga ya suscripción
    const { rows: existingSub } = await query(
      'SELECT id FROM public.subscriptions WHERE business_id = $1',
      [businessId]
    );
    if (existingSub.length > 0) return res.status(409).json({ ok: false, message: 'Este negocio ya tiene una suscripción' });

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

    // Notificación WA al dueño del negocio
    const { rows: ownerRows } = await query(`
      SELECT u.first_name, u.last_name, u.phone, b.name AS business_name
      FROM public.business_users bu
      JOIN public.users u ON bu.user_id = u.id
      JOIN public.businesses b ON b.id = bu.business_id
      WHERE bu.business_id=$1 AND bu.is_owner=TRUE LIMIT 1
    `, [businessId]).catch(() => ({ rows: [] }));
    const o = ownerRows[0];
    if (o) {
      const fmt = d => new Date(d).toLocaleDateString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric' });
      notifySuscripcion(o.phone, {
        firstName:       o.first_name || '',
        lastName:        o.last_name  || '',
        businessName:    o.business_name || '',
        plan:            billing_period === 'monthly' ? 'Mensual' : 'Anual',
        amount:          total_amount.toFixed(2),
        nextBillingDate: fmt(newSub[0].next_billing_at),
      });
    }

  } catch (error) {
    logger.error('Error creando suscripción:', error);
    next(error);
  }
});

// ── PUT /admin/clients/:ownerId ───────────────────────────────
// Actualiza datos del business_owner y su user
router.put('/clients/:ownerId', async (req, res, next) => {
  try {
    const { ownerId } = req.params;
    const { first_name, last_name, email, phone, document_type, document_number } = req.body;

    await query(`
      UPDATE public.business_owners
      SET first_name=$1, last_name=$2, email=$3, phone=$4,
          document_type=$5, document_number=$6, updated_at=NOW()
      WHERE id=$7
    `, [first_name, last_name, email, phone, document_type, document_number, ownerId]);

    // Actualizar email en users también
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

// ── PUT /admin/businesses/:businessId ────────────────────────
// Actualiza nombre del negocio
router.put('/businesses/:businessId', async (req, res, next) => {
  try {
    const { businessId } = req.params;
    const { name } = req.body;
    await query(
      'UPDATE public.businesses SET name=$1, updated_at=NOW() WHERE id=$2',
      [name, businessId]
    );
    res.json({ ok: true, message: 'Negocio actualizado correctamente' });
  } catch (error) {
    logger.error('Error actualizando negocio:', error);
    next(error);
  }
});

// ── PUT /admin/requests/:requestId/business-modules ──────────
// Para solicitudes YA APROBADAS: guarda módulos/features directamente
// en business_modules y business_features del negocio creado
router.put('/requests/:requestId/business-modules', async (req, res, next) => {
  try {
    const { requestId } = req.params;
    const { moduleIds = [], featureIds = [] } = req.body;

    // Buscar el negocio creado a partir de esta solicitud (mismo slug)
    const { rows: reqRows } = await query(
      `SELECT brr.slug, b.id AS business_id
       FROM public.business_registration_requests brr
       JOIN public.businesses b ON b.slug = brr.slug
       WHERE brr.id = $1`,
      [requestId]
    );

    if (reqRows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado para esta solicitud' });
    }

    const businessId = reqRows[0].business_id;
    const { getClient } = await import('../config/database.js');
    const client = await getClient();

    try {
      await client.query('BEGIN');

      // Limpiar módulos existentes que NO están en la nueva selección
      await client.query(
        `DELETE FROM public.business_modules WHERE business_id = $1`,
        [businessId]
      );
      await client.query(
        `DELETE FROM public.business_features WHERE business_id = $1`,
        [businessId]
      );

      // Insertar módulos seleccionados
      for (const moduleId of moduleIds) {
        await client.query(
          `INSERT INTO public.business_modules
             (business_id, module_id, is_active, activated_at, created_at, updated_at)
           VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
           ON CONFLICT (business_id, module_id) DO UPDATE SET is_active=TRUE, activated_at=NOW()`,
          [businessId, moduleId]
        );
      }

      // Insertar features seleccionadas
      for (const featureId of featureIds) {
        await client.query(
          `INSERT INTO public.business_features
             (business_id, feature_id, is_active, activated_at, created_at, updated_at)
           VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
           ON CONFLICT (business_id, feature_id) DO UPDATE SET is_active=TRUE, activated_at=NOW()`,
          [businessId, featureId]
        );
      }

      // También actualizar las tablas de la solicitud
      await client.query(
        `DELETE FROM public.business_registration_request_modules WHERE request_id = $1`,
        [requestId]
      );
      await client.query(
        `DELETE FROM public.business_registration_request_features WHERE request_id = $1`,
        [requestId]
      );
      for (const moduleId of moduleIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_modules (request_id, module_id)
           VALUES ($1, $2) ON CONFLICT (request_id, module_id) DO NOTHING`,
          [requestId, moduleId]
        );
      }
      for (const featureId of featureIds) {
        await client.query(
          `INSERT INTO public.business_registration_request_features (request_id, feature_id)
           VALUES ($1, $2) ON CONFLICT (request_id, feature_id) DO NOTHING`,
          [requestId, featureId]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, message: 'Módulos y funcionalidades actualizados en el negocio' });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Error actualizando módulos del negocio:', error);
    next(error);
  }
});

// ════════════════════════════════════════════════════════════
// MÓDULOS
// ════════════════════════════════════════════════════════════
router.get('/modules', async (req, res, next) => {
  try {
    const { rows } = await query(`SELECT * FROM public.modules ORDER BY sort_order, name`);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

router.post('/modules', async (req, res, next) => {
  try {
    const { code, name, description, price_monthly, price_annual, icon, sort_order, is_active } = req.body;
    const { rows } = await query(
      `INSERT INTO public.modules (code,name,description,price_monthly,price_annual,icon,sort_order,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [code, name, description||null, price_monthly||0, price_annual||0, icon||null, sort_order||0, is_active!==false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.put('/modules/:id', async (req, res, next) => {
  try {
    const { name, description, price_monthly, price_annual, icon, sort_order, is_active } = req.body;
    const { rows } = await query(
      `UPDATE public.modules SET name=$1,description=$2,price_monthly=$3,price_annual=$4,
       icon=$5,sort_order=$6,is_active=$7,updated_at=NOW() WHERE id=$8 RETURNING *`,
      [name, description||null, price_monthly||0, price_annual||0, icon||null, sort_order||0, is_active!==false, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/modules/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM public.modules WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// FEATURES
// ════════════════════════════════════════════════════════════
router.get('/features', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT f.*, m.name AS module_name FROM public.features f
       LEFT JOIN public.modules m ON f.module_id = m.id ORDER BY m.sort_order, f.name`
    );
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

router.post('/features', async (req, res, next) => {
  try {
    const { code, name, description, module_id, is_premium, is_active } = req.body;
    const { rows } = await query(
      `INSERT INTO public.features (code,name,description,module_id,is_premium,is_active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [code, name, description||null, module_id, is_premium||false, is_active!==false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.put('/features/:id', async (req, res, next) => {
  try {
    const { name, description, module_id, is_premium, is_active } = req.body;
    const { rows } = await query(
      `UPDATE public.features SET name=$1,description=$2,module_id=$3,is_premium=$4,
       is_active=$5,updated_at=NOW() WHERE id=$6 RETURNING *`,
      [name, description||null, module_id, is_premium||false, is_active!==false, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/features/:id', async (req, res, next) => {
  try {
    await query('DELETE FROM public.features WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// ROLES
// ════════════════════════════════════════════════════════════
router.get('/roles', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM public.roles ORDER BY name');
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

router.post('/roles', async (req, res, next) => {
  try {
    const { code, name, description, is_system } = req.body;
    const { rows } = await query(
      `INSERT INTO public.roles (code,name,description,is_system) VALUES ($1,$2,$3,$4) RETURNING *`,
      [code, name, description||null, is_system||false]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.put('/roles/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { rows } = await query(
      'UPDATE public.roles SET name=$1,description=$2,updated_at=NOW() WHERE id=$3 RETURNING *',
      [name, description||null, req.params.id]
    );
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.delete('/roles/:id', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT is_system FROM public.roles WHERE id=$1', [req.params.id]);
    if (rows[0]?.is_system) return res.status(400).json({ ok: false, message: 'No se puede eliminar un rol del sistema' });
    await query('DELETE FROM public.roles WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// TENANT ROLES — Roles dentro del esquema de un negocio
// ════════════════════════════════════════════════════════════

// Listado ligero de negocios aprovisionados (para el selector)
router.get('/businesses', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT b.id, b.name, b.slug, b.schema_name, bt.name AS type
      FROM public.businesses b
      JOIN public.business_types bt ON b.business_type_id = bt.id
      WHERE b.is_active = true AND b.schema_name IS NOT NULL
      ORDER BY b.name ASC
    `);
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

// GET /tenant-roles?businessId=X  — roles + módulos activos del negocio
router.get('/tenant-roles', async (req, res, next) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ ok: false, message: 'businessId requerido' });
  try {
    const { rows: biz } = await query(
      'SELECT schema_name FROM public.businesses WHERE id=$1 AND is_active=true',
      [businessId]
    );
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado o sin esquema' });
    const schema = biz[0].schema_name;

    const [{ rows: roles }, { rows: mods }, { rows: feats }] = await Promise.all([
      query(`SELECT id, name, description, permissions, created_at FROM "${schema}".roles ORDER BY id ASC`),
      query(`
        SELECT m.id, m.code, m.name, m.icon
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order ASC
      `, [businessId]),
      query(`
        SELECT f.id, f.code, f.name, f.module_id, f.is_premium
        FROM public.business_features bf
        JOIN public.features f ON bf.feature_id = f.id
        WHERE bf.business_id = $1 AND bf.is_active = true
        ORDER BY f.name ASC
      `, [businessId]),
    ]);

    const modules = mods.map(m => ({ ...m, features: feats.filter(f => f.module_id === m.id) }));
    const parseP  = p => typeof p === 'string' ? JSON.parse(p) : (p ?? []);
    res.json({ ok: true, roles: roles.map(r => ({ ...r, permissions: parseP(r.permissions) })), modules });
  } catch (e) { next(e); }
});

// POST /tenant-roles — crear rol en esquema del negocio
router.post('/tenant-roles', async (req, res, next) => {
  const { businessId, name, description, permissions } = req.body;
  if (!businessId || !name) return res.status(400).json({ ok: false, message: 'businessId y name requeridos' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(
      `INSERT INTO "${schema}".roles (name, description, permissions) VALUES ($1,$2,$3) RETURNING *`,
      [name, description || null, JSON.stringify(permissions || [])]
    );
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// PUT /tenant-roles/:id — actualizar rol
router.put('/tenant-roles/:id', async (req, res, next) => {
  const { businessId, name, description, permissions } = req.body;
  if (!businessId || !name) return res.status(400).json({ ok: false, message: 'businessId y name requeridos' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(
      `UPDATE "${schema}".roles SET name=$1, description=$2, permissions=$3 WHERE id=$4 RETURNING *`,
      [name, description || null, JSON.stringify(permissions || []), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Rol no encontrado' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

// DELETE /tenant-roles/:id?businessId=X — eliminar rol
router.delete('/tenant-roles/:id', async (req, res, next) => {
  const { businessId } = req.query;
  if (!businessId) return res.status(400).json({ ok: false, message: 'businessId requerido' });
  try {
    const { rows: biz } = await query('SELECT schema_name FROM public.businesses WHERE id=$1', [businessId]);
    if (!biz.length || !biz[0].schema_name)
      return res.status(404).json({ ok: false, message: 'Negocio no encontrado' });
    const schema = biz[0].schema_name;
    const { rows } = await query(`DELETE FROM "${schema}".roles WHERE id=$1 RETURNING id`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Rol no encontrado' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// PAGOS — Negocios con suscripción y estado de pago
// ════════════════════════════════════════════════════════════
router.get('/payments', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        b.id AS business_id, b.name AS business_name, b.slug, b.is_active AS business_active,
        bt.name AS business_type,
        s.id AS sub_id, s.status AS sub_status, s.billing_period, s.billing_day,
        s.amount_monthly, s.amount_annual, s.total_amount, s.discount_percentage,
        s.next_billing_at, s.activated_at,
        -- Último pago registrado
        (SELECT bh.billing_date FROM public.billing_history bh
         WHERE bh.subscription_id = s.id AND bh.status = 'paid'
         ORDER BY bh.billing_date DESC LIMIT 1) AS last_paid_at,
        -- Dueño
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

// Marcar pago como realizado
router.post('/subscriptions/:subId/mark-paid', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { notes } = req.body;
    const { rows: subRows } = await query('SELECT * FROM public.subscriptions WHERE id=$1', [subId]);
    if (!subRows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    const sub = subRows[0];

    // Calcular próxima fecha de facturación
    const nextBilling = new Date(sub.next_billing_at || new Date());
    if (sub.billing_period === 'monthly') nextBilling.setMonth(nextBilling.getMonth() + 1);
    else nextBilling.setFullYear(nextBilling.getFullYear() + 1);

    // Generar número de factura
    const invoiceNumber = `INV-${Date.now()}`;

    await query(
      `INSERT INTO public.billing_history
         (subscription_id, billing_date, due_date, amount, status, invoice_number, notes)
       VALUES ($1, NOW(), $2, $3, 'paid', $4, $5)`,
      [subId, sub.next_billing_at, sub.total_amount, invoiceNumber, notes||null]
    );

    // Actualizar suscripción
    await query(
      `UPDATE public.subscriptions
       SET status='active', next_billing_at=$1, updated_at=NOW()
       WHERE id=$2`,
      [nextBilling.toISOString(), subId]
    );

    // Reactivar negocio si estaba suspendido
    await query(
      'UPDATE public.businesses SET is_active=TRUE, updated_at=NOW() WHERE id=(SELECT business_id FROM public.subscriptions WHERE id=$1)',
      [subId]
    );

    res.json({ ok: true, message: 'Pago registrado', invoice_number: invoiceNumber, next_billing_at: nextBilling });

    // Notificación WA al dueño
    const { rows: pOwner } = await query(`
      SELECT u.first_name, u.last_name, u.phone, b.name AS business_name
      FROM public.business_users bu
      JOIN public.users u ON bu.user_id = u.id
      JOIN public.businesses b ON b.id = bu.business_id
      WHERE bu.business_id=(SELECT business_id FROM public.subscriptions WHERE id=$1)
        AND bu.is_owner=TRUE LIMIT 1
    `, [subId]).catch(() => ({ rows: [] }));
    const po = pOwner[0];
    if (po) {
      const fmt = d => new Date(d).toLocaleDateString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric' });
      notifyPagoRecibido(po.phone, {
        firstName:       po.first_name    || '',
        lastName:        po.last_name     || '',
        businessName:    po.business_name || '',
        invoiceNumber,
        amount:          parseFloat(sub.total_amount).toFixed(2),
        paymentDate:     fmt(new Date()),
        nextBillingDate: fmt(nextBilling),
      });
    }
  } catch (e) { next(e); }
});

// Suspender negocio por falta de pago
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

// ════════════════════════════════════════════════════════════
// ANALYTICS
// ════════════════════════════════════════════════════════════
router.get('/analytics', async (req, res, next) => {
  try {
    const [
      businesses, pendingReqs, activesSubs, suspendedSubs,
      totalRevenue, monthRevenue, users, modules,
      recentBusinesses, upcomingPayments
    ] = await Promise.all([
      query('SELECT COUNT(*) FROM public.businesses'),
      query("SELECT COUNT(*) FROM public.business_registration_requests WHERE status='pending'"),
      query("SELECT COUNT(*) FROM public.subscriptions WHERE status='active'"),
      query("SELECT COUNT(*) FROM public.subscriptions WHERE status='suspended'"),
      query('SELECT COALESCE(SUM(amount),0) AS total FROM public.billing_history WHERE status=\'paid\''),
      query(`SELECT COALESCE(SUM(amount),0) AS total FROM public.billing_history
             WHERE status='paid' AND date_trunc('month',billing_date)=date_trunc('month',NOW())`),
      query('SELECT COUNT(*) FROM public.users'),
      query('SELECT COUNT(*) FROM public.modules WHERE is_active=TRUE'),
      query(`SELECT b.name, bt.name AS type, b.created_at FROM public.businesses b
             JOIN public.business_types bt ON b.business_type_id=bt.id
             ORDER BY b.created_at DESC LIMIT 5`),
      query(`SELECT b.name AS business_name, s.next_billing_at, s.total_amount, s.status
             FROM public.subscriptions s JOIN public.businesses b ON s.business_id=b.id
             WHERE s.status='active' AND s.next_billing_at IS NOT NULL
             ORDER BY s.next_billing_at ASC LIMIT 10`),
    ]);

    // Ingresos por mes (últimos 6 meses)
    const { rows: monthlyData } = await query(`
      SELECT date_trunc('month', billing_date) AS month,
             SUM(amount) AS total, COUNT(*) AS count
      FROM public.billing_history WHERE status='paid'
        AND billing_date >= NOW() - INTERVAL '6 months'
      GROUP BY 1 ORDER BY 1
    `);

    // Distribución por tipo de negocio
    const { rows: typesDist } = await query(`
      SELECT bt.name, COUNT(*) AS count
      FROM public.businesses b JOIN public.business_types bt ON b.business_type_id=bt.id
      GROUP BY bt.name ORDER BY count DESC
    `);

    res.json({ ok: true, data: {
      totals: {
        businesses:     parseInt(businesses.rows[0].count),
        pendingRequests: parseInt(pendingReqs.rows[0].count),
        activesSubs:    parseInt(activesSubs.rows[0].count),
        suspendedSubs:  parseInt(suspendedSubs.rows[0].count),
        totalRevenue:   parseFloat(totalRevenue.rows[0].total),
        monthRevenue:   parseFloat(monthRevenue.rows[0].total),
        users:          parseInt(users.rows[0].count),
        modules:        parseInt(modules.rows[0].count),
      },
      monthlyRevenue:   monthlyData,
      businessTypes:    typesDist,
      recentBusinesses: recentBusinesses.rows,
      upcomingPayments: upcomingPayments.rows,
    }});
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// SETTINGS (fiscal_config)
// ════════════════════════════════════════════════════════════
router.get('/settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM public.fiscal_config WHERE is_active=TRUE LIMIT 1');
    res.json({ ok: true, data: rows[0] || null });
  } catch (e) { next(e); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const { iva_rate, iva_rate_reduced, iva_effective_from, sri_environment,
            retention_ir_goods, retention_ir_services, retention_iva,
            currency_code, currency_symbol } = req.body;
    const { rows: existing } = await query('SELECT id FROM public.fiscal_config WHERE is_active=TRUE LIMIT 1');
    if (existing.length) {
      await query(
        `UPDATE public.fiscal_config SET
           iva_rate=$1, iva_rate_reduced=$2, iva_effective_from=$3, sri_environment=$4,
           retention_ir_goods=$5, retention_ir_services=$6, retention_iva=$7,
           currency_code=$8, currency_symbol=$9, updated_at=NOW()
         WHERE id=$10`,
        [iva_rate, iva_rate_reduced||0, iva_effective_from, sri_environment||'produccion',
         retention_ir_goods||1, retention_ir_services||2, retention_iva||30,
         currency_code||'USD', currency_symbol||'$', existing[0].id]
      );
    }
    res.json({ ok: true, message: 'Configuración actualizada' });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// NOTIFICATIONS — Pagos vencidos + solicitudes pendientes
// ════════════════════════════════════════════════════════════
router.get('/notifications/system', async (req, res, next) => {
  try {
    const notifications = [];
    const now = new Date();

    // Pagos vencidos (next_billing_at < hoy y status=active)
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

    // Próximos pagos (en los próximos 7 días)
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

    // Solicitudes pendientes
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

    // Negocios suspendidos
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
        message: `El negocio fue suspendido por falta de pago`,
        business_id: r.id, date: r.suspended_at,
      });
    });

    // Ordenar: high primero, luego por fecha
    notifications.sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] - p[b.priority]) || new Date(a.date) - new Date(b.date);
    });

    res.json({ ok: true, data: notifications, total: notifications.length });
  } catch (e) { next(e); }
});

// ════════════════════════════════════════════════════════════
// PLANTILLAS WHATSAPP
// ════════════════════════════════════════════════════════════

router.get('/whatsapp-templates', async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT type, label, description, body, variables, is_active, updated_at FROM public.whatsapp_templates ORDER BY type'
    );
    res.json({ ok: true, data: rows });
  } catch (e) { next(e); }
});

router.put('/whatsapp-templates/:type', async (req, res, next) => {
  try {
    const { type } = req.params;
    const { body, is_active } = req.body;
    if (!body || !body.trim()) return res.status(400).json({ ok: false, message: 'El cuerpo de la plantilla es requerido' });
    const { rows } = await query(
      `UPDATE public.whatsapp_templates
       SET body=$1, is_active=$2, updated_at=NOW()
       WHERE type=$3 RETURNING *`,
      [body.trim(), is_active !== false, type]
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Plantilla no encontrada' });
    res.json({ ok: true, data: rows[0] });
  } catch (e) { next(e); }
});

router.post('/whatsapp-templates/test', async (req, res, next) => {
  try {
    const { type, phone, vars = {} } = req.body;
    if (!type || !phone) return res.status(400).json({ ok: false, message: 'type y phone son requeridos' });
    await testSend(type, phone, vars);
    res.json({ ok: true, message: `Mensaje de prueba tipo "${type}" enviado a ${phone}` });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// Enviar recordatorio manual a un negocio específico
router.post('/whatsapp-templates/recordatorio/:subId', async (req, res, next) => {
  try {
    const { subId } = req.params;
    const { rows } = await query(`
      SELECT u.first_name, u.last_name, u.phone, b.name AS business_name,
             s.total_amount, s.next_billing_at
      FROM public.subscriptions s
      JOIN public.businesses b ON b.id = s.business_id
      JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner=TRUE
      JOIN public.users u ON u.id = bu.user_id
      WHERE s.id=$1 LIMIT 1
    `, [subId]);
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Suscripción no encontrada' });
    const r = rows[0];
    const now = new Date();
    const due = new Date(r.next_billing_at);
    const daysLeft = Math.ceil((due - now) / 86400000);
    const fmt = d => new Date(d).toLocaleDateString('es-EC', { day:'2-digit', month:'2-digit', year:'numeric' });
    notifyRecordatorio(r.phone, {
      firstName:    r.first_name    || '',
      lastName:     r.last_name     || '',
      businessName: r.business_name || '',
      daysLeft:     daysLeft > 0 ? daysLeft : 0,
      amount:       parseFloat(r.total_amount).toFixed(2),
      dueDate:      fmt(due),
    });
    res.json({ ok: true, message: `Recordatorio enviado a ${r.phone}` });
  } catch (e) { next(e); }
});

// Historial de facturación por suscripción
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
