// BACKEND/src/routes/businessStatus.js
// Registrar en app.js:
//   import businessStatusRoutes from './routes/businessStatus.js';
//   app.use('/api/business-status', authMiddleware, businessStatusRoutes);

import express from 'express';
import { query } from '../config/database.js';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

const router = express.Router();

// =====================================================
// Helper para decodificar token y obtener datos del usuario
// =====================================================
const getUserFromToken = (req) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return null;

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;

    const decoded = jwt.verify(token, env.jwt.secret || process.env.JWT_SECRET);
    return {
      userId: decoded.userId || decoded.id,
      businessId: decoded.businessId || decoded.business_id,
      email: decoded.email,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
      userType: decoded.userType || decoded.user_type,
      roleCode: decoded.roleCode || decoded.role,
      role: decoded.role,
      schemaName: decoded.schemaName,
      ...decoded
    };
  } catch (error) {
    console.error('Error decodificando token:', error);
    return null;
  }
};

// =====================================================
// FUNCIÓN PRINCIPAL: GET /api/business-status/my-status
// =====================================================
router.get('/my-status', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({
        ok: false,
        error: 'No autenticado'
      });
    }

    const userId = user.userId;
    const email = user.email;

    console.log('🔑 Usuario autenticado:', { 
      userId, 
      email,
      userType: user.userType,
      role: user.role,
      schemaName: user.schemaName
    });

    // ============================================================
    // PASO 1: VERIFICAR SI EL USUARIO ESTÁ EN public.users (OWNER)
    // ============================================================
    const { rows: publicUserRows } = await query(`
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.document_number,
        u.is_active,
        u.email_verified
      FROM public.users u
      WHERE u.id = $1 OR u.email = $2
      LIMIT 1
    `, [userId, email]);

    const isPublicUser = publicUserRows.length > 0;
    console.log(`📌 Usuario ${isPublicUser ? 'ESTÁ' : 'NO ESTÁ'} en public.users`);

    // ============================================================
    // PASO 2: SI ESTÁ EN public.users → BUSCAR SOLICITUD (OWNER)
    // ============================================================
    if (isPublicUser) {
      const publicUser = publicUserRows[0];
      
      // ✅ VALIDAR: Verificar si el owner está activo
      if (!publicUser.is_active) {
        return res.json({
          ok: true,
          data: {
            status: 'inactive',
            message: 'Tu cuenta de usuario está inactiva. Contacta al administrador.',
            step: 0,
            user_type: 'owner',
            has_business: false,
            is_active: false,
            is_pending: false,
            is_approved: false,
            is_rejected: false,
            is_provisioned: false,
            is_suspended: false,
            user_is_active: false
          }
        });
      }

      console.log('👤 Usuario es OWNER (public.users) - Activo:', publicUser.is_active);

      // Buscar su solicitud de registro
      const { rows: requestRows } = await query(`
        SELECT 
          brs.id AS request_id,
          brs.slug,
          brs.business_name,
          brs.status AS request_status,
          brs.requested_at,
          brs.reviewed_at,
          brs.provisioned_at,
          brs.rejection_reason,
          brs.provisioned_business_id,
          brs.owner_email,
          brs.owner_first_name,
          brs.owner_last_name,
          brs.owner_phone,
          brs.business_type_id,
          bt.name AS business_type_name
        FROM public.business_registration_requests brs
        LEFT JOIN public.business_types bt ON brs.business_type_id = bt.id
        WHERE brs.user_id = $1
        ORDER BY brs.created_at DESC
        LIMIT 1
      `, [userId]);

      // Si no tiene solicitud
      if (requestRows.length === 0) {
        return res.json({
          ok: true,
          data: {
            status: 'no_request',
            message: 'No tienes ninguna solicitud de registro.',
            step: 0,
            user_type: 'owner',
            has_business: false,
            is_active: false,
            is_pending: true,
            is_approved: false,
            is_rejected: false,
            is_provisioned: false,
            is_suspended: false,
            user_is_active: true
          }
        });
      }

      const request = requestRows[0];
      const provisionedBusinessId = request.provisioned_business_id;

      // Obtener negocio y suscripción si existe
      let businessData = null;
      let subscriptionData = null;

      if (provisionedBusinessId) {
        const { rows: businessRows } = await query(`
          SELECT 
            b.id,
            b.name,
            b.slug,
            b.is_active,
            b.is_verified,
            b.created_at,
            b.updated_at
          FROM public.businesses b
          WHERE b.id = $1
        `, [provisionedBusinessId]);

        if (businessRows.length > 0) {
          businessData = businessRows[0];

          const { rows: subRows } = await query(`
            SELECT 
              s.id AS subscription_id,
              s.status AS subscription_status,
              s.billing_period,
              s.total_amount,
              s.discount_percentage,
              s.next_billing_at,
              s.activated_at,
              s.suspended_at,
              s.amount_monthly,
              s.amount_annual,
              s.billing_day,
              s.created_at AS subscription_created_at,
              s.updated_at AS subscription_updated_at
            FROM public.subscriptions s
            WHERE s.business_id = $1
            ORDER BY s.created_at DESC
            LIMIT 1
          `, [provisionedBusinessId]);

          if (subRows.length > 0) {
            subscriptionData = subRows[0];
          }
        }
      }

      // Determinar estado final para OWNER
      let status = request.request_status;
      let step = 1;
      let stepDescription = '';

      if (request.request_status === 'pending') {
        status = 'pending';
        step = 1;
        stepDescription = 'Tu solicitud está siendo revisada por nuestro equipo. Te notificaremos cuando sea aprobada.';
      } else if (request.request_status === 'rejected') {
        status = 'rejected';
        step = 0;
        stepDescription = request.rejection_reason || 'Tu solicitud ha sido rechazada. Por favor contacta a soporte.';
      } else if (request.request_status === 'approved' && !subscriptionData) {
        status = 'approved';
        step = 2;
        stepDescription = '¡Tu negocio ha sido aprobado! El equipo de IDON se pondrá en contacto para coordinar tu suscripción.';
      } else if (request.request_status === 'approved' && subscriptionData) {
        if (subscriptionData.subscription_status === 'pending_activation') {
          status = 'provisioned';
          step = 3;
          stepDescription = 'Tu suscripción está pendiente de pago. Realiza el pago para activar tu negocio.';
        } else if (subscriptionData.subscription_status === 'active') {
          status = 'active';
          step = 4;
          stepDescription = '¡Tu negocio está activo! Disfruta de todas las funcionalidades de IDON.';
        } else if (subscriptionData.subscription_status === 'suspended') {
          status = 'suspended';
          step = 3;
          stepDescription = 'Tu suscripción ha sido suspendida. Realiza el pago pendiente para reactivarla.';
        } else {
          status = 'provisioned';
          step = 3;
          stepDescription = 'Tu suscripción está en proceso. Contacta a soporte si tienes dudas.';
        }
      } else if (request.request_status === 'provisioned') {
        if (!subscriptionData) {
          status = 'approved';
          step = 2;
          stepDescription = 'Tu negocio ha sido aprobado pero no tiene suscripción. Contacta a soporte.';
        } else if (subscriptionData.subscription_status === 'pending_activation') {
          status = 'provisioned';
          step = 3;
          stepDescription = 'Tu suscripción está pendiente de pago. Realiza el pago para activar tu negocio.';
        } else if (subscriptionData.subscription_status === 'active') {
          status = 'active';
          step = 4;
          stepDescription = '¡Tu negocio está activo! Disfruta de todas las funcionalidades de IDON.';
        } else if (subscriptionData.subscription_status === 'suspended') {
          status = 'suspended';
          step = 3;
          stepDescription = 'Tu suscripción ha sido suspendida. Realiza el pago pendiente para reactivarla.';
        } else {
          status = 'provisioned';
          step = 3;
          stepDescription = 'Tu suscripción está en proceso. Contacta a soporte si tienes dudas.';
        }
      } else {
        status = request.request_status;
        step = 1;
        stepDescription = 'Estado desconocido. Contacta a soporte.';
      }

      // ✅ Devolver respuesta para OWNER
      return res.json({
        ok: true,
        data: {
          status: status,
          step: step,
          message: stepDescription,
          user_type: 'owner',
          user_is_active: true,
          request_id: request.request_id,
          slug: request.slug,
          business_name: businessData?.name || request.business_name,
          business_type: request.business_type_name || null,
          request_status: request.request_status,
          rejection_reason: request.rejection_reason || null,
          requested_at: request.requested_at,
          reviewed_at: request.reviewed_at || null,
          provisioned_at: request.provisioned_at || null,
          owner: {
            email: request.owner_email,
            first_name: request.owner_first_name,
            last_name: request.owner_last_name,
            phone: request.owner_phone
          },
          business_id: businessData?.id || null,
          business_active: businessData?.is_active || false,
          is_verified: businessData?.is_verified || false,
          subscription_id: subscriptionData?.subscription_id || null,
          subscription_status: subscriptionData?.subscription_status || null,
          billing_period: subscriptionData?.billing_period || null,
          billing_day: subscriptionData?.billing_day || null,
          total_amount: parseFloat(subscriptionData?.total_amount || 0),
          discount_percentage: parseFloat(subscriptionData?.discount_percentage || 0),
          amount_monthly: parseFloat(subscriptionData?.amount_monthly || 0),
          amount_annual: parseFloat(subscriptionData?.amount_annual || 0),
          next_billing_at: subscriptionData?.next_billing_at || null,
          activated_at: subscriptionData?.activated_at || null,
          suspended_at: subscriptionData?.suspended_at || null,
          subscription_created_at: subscriptionData?.subscription_created_at || null,
          has_business: !!businessData,
          has_subscription: !!subscriptionData,
          is_active: status === 'active',
          is_suspended: status === 'suspended',
          is_pending: status === 'pending',
          is_approved: status === 'approved',
          is_provisioned: status === 'provisioned',
          is_rejected: status === 'rejected'
        }
      });
    }

    // ============================================================
    // PASO 3: SI NO ESTÁ EN public.users → BUSCAR EN business_users
    // ============================================================
    console.log('👤 Usuario NO está en public.users, buscando en business_users...');

    const { rows: businessUserRows } = await query(`
      SELECT 
        bu.business_id,
        bu.role_id,
        r.code AS role_code,
        r.name AS role_name,
        b.id AS business_id,
        b.name AS business_name,
        b.slug,
        b.is_active,
        b.is_verified,
        b.schema_name,
        s.status AS subscription_status,
        s.next_billing_at,
        s.total_amount,
        s.amount_monthly,
        s.amount_annual,
        s.billing_period
      FROM public.business_users bu
      JOIN public.businesses b ON bu.business_id = b.id
      LEFT JOIN public.roles r ON bu.role_id = r.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      WHERE bu.user_id = $1
      ORDER BY b.created_at DESC
      LIMIT 1
    `, [userId]);

    // Si no está en business_users, es un usuario sin acceso
    if (businessUserRows.length === 0) {
      return res.json({
        ok: true,
        data: {
          status: 'no_request',
          message: 'No tienes ningún negocio asociado.',
          step: 0,
          user_type: 'unknown',
          has_business: false,
          is_active: false,
          is_pending: true,
          is_approved: false,
          is_rejected: false,
          is_provisioned: false,
          is_suspended: false,
          user_is_active: false
        }
      });
    }

    // ============================================================
    // PASO 4: USUARIO ES COLABORADOR (schema_employee)
    // ============================================================
    const bizUser = businessUserRows[0];
    const schemaName = bizUser.schema_name;

    console.log('👤 Usuario es COLABORADOR (schema_employee):', {
      businessId: bizUser.business_id,
      businessName: bizUser.business_name,
      role: bizUser.role_code,
      isActive: bizUser.is_active,
      subscriptionStatus: bizUser.subscription_status,
      schemaName: schemaName
    });

    // ✅ VALIDAR: Verificar que el usuario exista en el esquema del negocio
    let schemaUser = null;
    let userIsActive = false;

    if (schemaName) {
      try {
        const { rows: schemaUserRows } = await query(`
          SELECT 
            u.id,
            u.email,
            u.first_name,
            u.last_name,
            u.is_active
          FROM "${schemaName}".users u
          WHERE u.id = $1 OR u.email = $2
          LIMIT 1
        `, [userId, email]);

        if (schemaUserRows.length === 0) {
          console.warn(`⚠️ Usuario ${userId} no encontrado en esquema ${schemaName}`);
          return res.json({
            ok: true,
            data: {
              status: 'user_not_found',
              message: 'Usuario no encontrado en el esquema del negocio.',
              step: 0,
              user_type: 'schema_employee',
              has_business: true,
              is_active: false,
              is_pending: false,
              is_approved: false,
              is_rejected: false,
              is_provisioned: false,
              is_suspended: false,
              user_is_active: false
            }
          });
        }

        schemaUser = schemaUserRows[0];
        userIsActive = schemaUser.is_active === true;

        console.log(`✅ Usuario encontrado en esquema ${schemaName}, activo: ${userIsActive}`);

        // ✅ VALIDAR: Verificar si el usuario colaborador está activo
        if (!userIsActive) {
          return res.json({
            ok: true,
            data: {
              status: 'inactive',
              message: 'Tu cuenta de usuario está inactiva en el negocio. Contacta al administrador.',
              step: 0,
              user_type: 'schema_employee',
              business_id: bizUser.business_id,
              business_name: bizUser.business_name,
              business_slug: bizUser.slug,
              schema_name: schemaName,
              role: {
                id: bizUser.role_id,
                code: bizUser.role_code,
                name: bizUser.role_name
              },
              has_business: true,
              has_subscription: !!bizUser.subscription_status,
              is_active: false,
              is_suspended: false,
              is_pending: false,
              is_provisioned: false,
              user_is_active: false
            }
          });
        }

      } catch (err) {
        console.error(`Error verificando usuario en esquema ${schemaName}:`, err.message);
        return res.json({
          ok: true,
          data: {
            status: 'error',
            message: 'Error verificando el estado del usuario en el negocio.',
            step: 0,
            user_type: 'schema_employee',
            has_business: true,
            is_active: false,
            is_pending: false,
            is_approved: false,
            is_rejected: false,
            is_provisioned: false,
            is_suspended: false,
            user_is_active: false
          }
        });
      }
    }

    // Verificar estado del negocio para COLABORADOR
    const isBusinessActive = bizUser.is_active === true;
    const isSubscriptionActive = bizUser.subscription_status === 'active';

    let status = 'pending';
    let step = 1;
    let stepDescription = '';

    if (isBusinessActive && isSubscriptionActive) {
      // ✅ NEGOCIO ACTIVO - Acceso permitido
      status = 'active';
      step = 4;
      stepDescription = '¡El negocio está activo! Disfruta de todas las funcionalidades.';
    } else if (isBusinessActive && bizUser.subscription_status === 'suspended') {
      status = 'suspended';
      step = 3;
      stepDescription = 'La suscripción del negocio está suspendida. Contacta al administrador.';
    } else if (isBusinessActive && bizUser.subscription_status === 'pending_activation') {
      status = 'provisioned';
      step = 3;
      stepDescription = 'La suscripción está pendiente de pago. Contacta al administrador.';
    } else if (!isBusinessActive) {
      status = 'pending';
      step = 1;
      stepDescription = 'El negocio no está activo. Contacta al administrador.';
    } else {
      status = 'pending';
      step = 1;
      stepDescription = 'El negocio está en proceso de activación.';
    }

    // ✅ Devolver respuesta para COLABORADOR
    return res.json({
      ok: true,
      data: {
        status: status,
        step: step,
        message: stepDescription,
        user_type: 'schema_employee',
        user_is_active: true,
        business_id: bizUser.business_id,
        business_name: bizUser.business_name,
        business_slug: bizUser.slug,
        business_active: bizUser.is_active,
        is_verified: bizUser.is_verified,
        schema_name: schemaName,
        role: {
          id: bizUser.role_id,
          code: bizUser.role_code,
          name: bizUser.role_name
        },
        subscription_status: bizUser.subscription_status,
        next_billing_at: bizUser.next_billing_at,
        total_amount: parseFloat(bizUser.total_amount || 0),
        amount_monthly: parseFloat(bizUser.amount_monthly || 0),
        amount_annual: parseFloat(bizUser.amount_annual || 0),
        billing_period: bizUser.billing_period || null,
        has_business: true,
        has_subscription: !!bizUser.subscription_status,
        is_active: status === 'active',
        is_suspended: status === 'suspended',
        is_pending: status === 'pending',
        is_provisioned: status === 'provisioned'
      }
    });

  } catch (error) {
    console.error('Error en /my-status:', error);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener el estado del negocio',
      detail: error.message
    });
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status
// =====================================================
router.get('/', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const userId = user.userId;

    const { rows: bizRows } = await query(`
      SELECT
        b.id         AS business_id,
        b.name       AS business_name,
        b.slug,
        b.is_active,
        bt.name      AS business_type,
        s.status     AS subscription_status,
        s.next_billing_at,
        s.total_amount,
        s.discount_percentage,
        bu.role_id,
        r.code       AS role_code
      FROM public.business_users bu
      JOIN public.businesses b  ON bu.business_id = b.id
      JOIN public.business_types bt ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.roles r ON bu.role_id = r.id
      WHERE bu.user_id = $1
      LIMIT 1
    `, [userId]);

    if (bizRows.length > 0) {
      const biz = bizRows[0];

      if (!biz.is_active || biz.subscription_status === 'suspended') {
        return res.json({
          ok: true,
          status: 'suspended',
          message: 'Tu negocio está suspendido por falta de pago. Contacta al administrador.',
          business: {
            id:    biz.business_id,
            name:  biz.business_name,
            slug:  biz.slug,
            type:  biz.business_type,
          },
          subscription: {
            totalAmount: parseFloat(biz.total_amount || 0),
            discountPercentage: parseFloat(biz.discount_percentage || 0)
          }
        });
      }

      return res.json({
        ok: true,
        status: 'approved',
        business: {
          id:                  biz.business_id,
          name:                biz.business_name,
          slug:                biz.slug,
          type:                biz.business_type,
          subscription_status: biz.subscription_status,
          next_billing_at:     biz.next_billing_at,
          role:                biz.role_code,
        },
        subscription: {
          totalAmount: parseFloat(biz.total_amount || 0),
          discountPercentage: parseFloat(biz.discount_percentage || 0)
        }
      });
    }

    const { rows: reqRows } = await query(`
      SELECT brr.status, brr.business_name, brr.rejection_reason, bt.name AS business_type
      FROM public.business_registration_requests brr
      LEFT JOIN public.business_types bt ON brr.business_type_id = bt.id
      WHERE brr.user_id = $1
      ORDER BY brr.requested_at DESC
      LIMIT 1
    `, [userId]);

    if (reqRows.length === 0) {
      return res.json({ ok: true, status: 'no_request' });
    }

    const req_ = reqRows[0];

    if (req_.status === 'rejected') {
      return res.json({
        ok: true,
        status: 'rejected',
        message: req_.rejection_reason || 'Tu solicitud fue rechazada.',
        business: { name: req_.business_name, type: req_.business_type },
      });
    }

    return res.json({
      ok: true,
      status: 'pending',
      business: { name: req_.business_name, type: req_.business_type },
    });

  } catch (error) {
    console.error('Error en /:', error);
    next(error);
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status/my-businesses
// =====================================================
router.get('/my-businesses', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const userId = user.userId;

    if (req.user?.userType === 'schema_employee') {
      const { businessId, schemaName } = req.user;
      const { rows } = await query(`
        SELECT b.id, b.name, b.slug,
               b.schema_name AS "schemaName",
               b.is_active   AS "isActive",
               bt.name       AS type,
               s.status      AS subscription_status,
               s.next_billing_at
        FROM public.businesses b
        JOIN public.business_types bt  ON b.business_type_id = bt.id
        LEFT JOIN public.subscriptions s ON s.business_id = b.id
        WHERE b.id = $1
      `, [businessId]);
      return res.json({ ok: true, businesses: rows });
    }

    const { rows } = await query(`
      SELECT
        b.id,
        b.name,
        b.slug,
        b.schema_name        AS "schemaName",
        b.is_active          AS "isActive",
        bt.name              AS type,
        s.status             AS subscription_status,
        s.next_billing_at,
        r.code               AS role
      FROM public.business_users bu
      JOIN public.businesses b       ON bu.business_id = b.id
      JOIN public.business_types bt  ON b.business_type_id = bt.id
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      LEFT JOIN public.roles r         ON bu.role_id = r.id
      WHERE bu.user_id = $1
      ORDER BY b.name ASC
    `, [userId]);

    res.json({ ok: true, businesses: rows });
  } catch (e) {
    console.error('Error en /my-businesses:', e);
    next(e);
  }
});

// =====================================================
// ENDPOINT ORIGINAL: GET /api/business-status/navigation
// =====================================================
router.get('/navigation', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const userId = user.userId;

    const MODULE_DEFAULTS = {
      core: '/app/core', pos: '/app/pos', inventory: '/app/inventory',
      reports: '/app/reports', payments: '/app/payments', accounting: '/app/accounting',
      orders: '/app/orders', kitchen: '/app/kitchen', delivery: '/app/delivery',
      tables: '/app/tables', reservations: '/app/reservations', loyalty: '/app/loyalty',
      suppliers: '/app/suppliers', purchases: '/app/purchases', appointments: '/app/appointments',
      employees: '/app/employees', crm: '/app/crm', routes: '/app/routes',
      tracking: '/app/tracking', queue: '/app/queue', ecommerce: '/app/ecommerce',
      notifications: '/app/notifications', einvoicing: '/app/einvoicing',
    };

    const buildModulePages = (mod, featureRows) => {
      if (featureRows.length > 0) {
        const basePath = MODULE_DEFAULTS[mod.code] || `/app/${mod.code}`;
        return [
          { id: mod.id + '-main', code: mod.code, name: 'General', path: basePath, icon: mod.icon, isMain: true },
          ...featureRows.map(f => ({ id: f.id, code: f.code, name: f.name, path: `${basePath}/${f.code}`, icon: null, isFeature: true })),
        ];
      }
      if (MODULE_DEFAULTS[mod.code]) {
        return [{ id: mod.id + '-default', code: mod.code, name: mod.name, path: MODULE_DEFAULTS[mod.code], icon: mod.icon }];
      }
      return [];
    };

    // ── Empleados de esquema (nivel 3) ──────────────────────────────────────
    if (req.user?.userType === 'schema_employee') {
      const { businessId, schemaName } = req.user;

      let roleId = null, roleName = 'employee', rolePermissions = null;
      try {
        const { rows: tenantUser } = await query(`
          SELECT u.role_id, r.name AS role_name, r.permissions
          FROM "${schemaName}".users u
          LEFT JOIN "${schemaName}".roles r ON u.role_id = r.id
          WHERE u.id = $1
          LIMIT 1
        `, [userId]);
        if (tenantUser.length > 0) {
          roleId   = tenantUser[0].role_id;
          roleName = tenantUser[0].role_name || 'employee';
          rolePermissions = tenantUser[0].permissions;
        }
      } catch (e) {}

      let permsByModule = null;
      if (Array.isArray(rolePermissions) && rolePermissions.length > 0) {
        permsByModule = {};
        for (const p of rolePermissions) {
          permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
        }
      } else if (typeof rolePermissions === 'string') {
        try {
          const parsed = JSON.parse(rolePermissions);
          if (Array.isArray(parsed) && parsed.length > 0) {
            permsByModule = {};
            for (const p of parsed) {
              permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
            }
          }
        } catch {}
      }

      const { rows: allModules } = await query(`
        SELECT m.id, m.code, m.name, m.icon, m.sort_order
        FROM public.business_modules bm
        JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order ASC
      `, [businessId]);

      const allowedModules = permsByModule
        ? allModules.filter(m => permsByModule.hasOwnProperty(m.id))
        : allModules;

      const menuModules = [];
      for (const mod of allowedModules) {
        const { rows: bizFeatures } = await query(`
          SELECT f.id, f.code, f.name
          FROM public.business_features bf
          JOIN public.features f ON bf.feature_id = f.id
          WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
          ORDER BY f.name ASC
        `, [businessId, mod.id]);

        const allowedFeatures = (permsByModule && permsByModule[mod.id])
          ? bizFeatures.filter(f => permsByModule[mod.id].has(f.id))
          : bizFeatures;

        const pages = buildModulePages(mod, allowedFeatures);
        if (pages.length > 0) {
          menuModules.push({
            id: mod.id, code: mod.code, name: mod.name, icon: mod.icon,
            features: allowedFeatures.map(f => f.code),
            pages,
          });
        }
      }

      return res.json({
        ok: true,
        data: {
          role: { id: roleId, code: 'employee', name: roleName },
          modules: menuModules,
        },
      });
    }

    // ── Dueño / empleado público (nivel 1 y 2) ──────────────────────────────
    const headerBusinessId = req.headers['x-business-id'] || null;
    console.log('[NAV] userId:', userId, '| x-business-id header:', headerBusinessId);

    let userBiz;
    if (headerBusinessId) {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1 AND bu.business_id = $2
        LIMIT 1
      `, [userId, headerBusinessId]);
      userBiz = rows;
    } else {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1
        LIMIT 1
      `, [userId]);
      userBiz = rows;
    }

    console.log('[NAV] business_id usado:', userBiz[0]?.business_id);

    if (userBiz.length === 0) {
      return res.json({ ok: true, data: { role: null, modules: [] } });
    }

    const { business_id, role_id, role_code, role_name } = userBiz[0];

    const { rows: modules } = await query(`
      SELECT m.id, m.code, m.name, m.icon, m.sort_order
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id = $1 AND bm.is_active = true
      ORDER BY m.sort_order ASC
    `, [business_id]);

    console.log('[NAV] Módulos activos:', modules.map(m => m.code));

    const menuModules = [];
    for (const mod of modules) {
      const { rows: featureRows } = await query(`
        SELECT f.id, f.code, f.name, f.description
        FROM public.business_features bf
        JOIN public.features f ON bf.feature_id = f.id
        WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
        ORDER BY f.name ASC
      `, [business_id, mod.id]);

      console.log(`[NAV] Módulo ${mod.code} → features: [${featureRows.map(f => f.code).join(', ')}]`);

      const pages = buildModulePages(mod, featureRows);
      if (pages.length > 0) {
        menuModules.push({
          id: mod.id, code: mod.code, name: mod.name,
          icon: mod.icon, features: featureRows.map(f => f.code), pages,
        });
      }
    }

    res.json({
      ok: true,
      data: {
        role: { id: role_id, code: role_code, name: role_name },
        modules: menuModules,
      },
    });
  } catch (e) {
    console.error('Error en /navigation:', e);
    next(e);
  }
});

export default router;