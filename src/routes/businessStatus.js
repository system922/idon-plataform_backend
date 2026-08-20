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
// Helper para decodificar token
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
    // CASO 1: USUARIO EN public.users → ES OWNER
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

      // ✅ Verificar si es business_owner
      const { rows: ownerRows } = await query(`
        SELECT 
          bo.id,
          bo.user_id,
          bo.email,
          bo.first_name,
          bo.last_name,
          bo.document_number
        FROM public.business_owners bo
        WHERE bo.user_id = $1 OR bo.email = $2
        LIMIT 1
      `, [userId, email]);

      const isBusinessOwner = ownerRows.length > 0;
      console.log(`📌 Usuario ${isBusinessOwner ? 'ES' : 'NO ES'} business_owner`);

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
        WHERE brs.user_id = $1 OR brs.owner_email = $2
        ORDER BY brs.created_at DESC
        LIMIT 1
      `, [userId, email]);

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
            user_is_active: true,
            is_business_owner: isBusinessOwner
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
            b.schema_name,
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
          is_business_owner: isBusinessOwner,
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
          schema_name: businessData?.schema_name || null,
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
    // CASO 2: USUARIO NO ESTÁ EN public.users → BUSCAR EN ESQUEMA (COLABORADOR)
    // ============================================================
    console.log('👤 Usuario NO está en public.users, buscando en el esquema...');

    // ✅ Obtener el schemaName del token
    const schemaName = user.schemaName;
    
    if (!schemaName) {
      return res.json({
        ok: true,
        data: {
          status: 'no_request',
          message: 'No se encontró el esquema del negocio.',
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

    // ✅ Buscar usuario en el esquema
    // IMPORTANTE: NO usar r.code porque no existe en la tabla roles del esquema
    const { rows: schemaUserRows } = await query(`
      SELECT 
        u.id,
        u.email,
        u.first_name,
        u.last_name,
        u.is_active,
        u.role_id,
        r.name AS role_name
      FROM "${schemaName}".users u
      LEFT JOIN "${schemaName}".roles r ON u.role_id = r.id
      WHERE u.id = $1 OR u.email = $2
      LIMIT 1
    `, [userId, email]);

    if (schemaUserRows.length === 0) {
      console.warn(`⚠️ Usuario ${userId} no encontrado en esquema ${schemaName}`);
      return res.json({
        ok: true,
        data: {
          status: 'user_not_found',
          message: 'Usuario no encontrado en el negocio.',
          step: 0,
          user_type: 'schema_employee',
          has_business: false,
          is_active: false,
          is_pending: false,
          is_approved: false,
          is_rejected: false,
          is_provisioned: false,
          is_suspended: false,
          user_is_active: false,
          schema_name: schemaName
        }
      });
    }

    const schemaUser = schemaUserRows[0];
    const userIsActive = schemaUser.is_active === true;

    console.log(`✅ Usuario encontrado en esquema ${schemaName}`, {
      id: schemaUser.id,
      email: schemaUser.email,
      is_active: schemaUser.is_active,
      role: schemaUser.role_name
    });

    // ✅ VALIDAR: Verificar si el usuario colaborador está activo
    if (!userIsActive) {
      return res.json({
        ok: true,
        data: {
          status: 'inactive',
          message: 'Tu cuenta de usuario está inactiva en el negocio. Contacta al administrador.',
          step: 0,
          user_type: 'schema_employee',
          has_business: false,
          is_active: false,
          is_pending: false,
          is_approved: false,
          is_rejected: false,
          is_provisioned: false,
          is_suspended: false,
          user_is_active: false,
          schema_name: schemaName,
          role: {
            id: schemaUser.role_id,
            name: schemaUser.role_name || 'Sin rol'
          }
        }
      });
    }

    // ✅ Buscar el negocio asociado al esquema
    const { rows: businessRows } = await query(`
      SELECT 
        b.id,
        b.name,
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
      FROM public.businesses b
      LEFT JOIN public.subscriptions s ON s.business_id = b.id
      WHERE b.schema_name = $1
      LIMIT 1
    `, [schemaName]);

    if (businessRows.length === 0) {
      console.warn(`⚠️ No se encontró negocio para el esquema ${schemaName}`);
      return res.json({
        ok: true,
        data: {
          status: 'no_business',
          message: 'No se encontró el negocio asociado.',
          step: 0,
          user_type: 'schema_employee',
          has_business: false,
          is_active: false,
          is_pending: false,
          is_approved: false,
          is_rejected: false,
          is_provisioned: false,
          is_suspended: false,
          user_is_active: true,
          schema_name: schemaName,
          role: {
            id: schemaUser.role_id,
            name: schemaUser.role_name || 'Sin rol'
          }
        }
      });
    }

    const business = businessRows[0];

    console.log('🏢 Negocio encontrado:', {
      id: business.id,
      name: business.name,
      is_active: business.is_active,
      subscription_status: business.subscription_status
    });

    // ✅ Validar estado del negocio para COLABORADOR
    const isBusinessActive = business.is_active === true;
    const isSubscriptionActive = business.subscription_status === 'active';

    let status = 'pending';
    let step = 1;
    let stepDescription = '';

    if (isBusinessActive && isSubscriptionActive) {
      // ✅ NEGOCIO ACTIVO - Acceso permitido
      status = 'active';
      step = 4;
      stepDescription = '¡El negocio está activo! Disfruta de todas las funcionalidades.';
    } else if (isBusinessActive && business.subscription_status === 'suspended') {
      status = 'suspended';
      step = 3;
      stepDescription = 'La suscripción del negocio está suspendida. Contacta al administrador.';
    } else if (isBusinessActive && business.subscription_status === 'pending_activation') {
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
        business_id: business.id,
        business_name: business.name,
        business_slug: business.slug,
        business_active: business.is_active,
        is_verified: business.is_verified,
        schema_name: business.schema_name,
        role: {
          id: schemaUser.role_id,
          name: schemaUser.role_name || 'Sin rol'
        },
        subscription_status: business.subscription_status,
        next_billing_at: business.next_billing_at,
        total_amount: parseFloat(business.total_amount || 0),
        amount_monthly: parseFloat(business.amount_monthly || 0),
        amount_annual: parseFloat(business.amount_annual || 0),
        billing_period: business.billing_period || null,
        has_business: true,
        has_subscription: !!business.subscription_status,
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
    const schemaName = user.schemaName;

    // Si tiene schemaName, buscar directamente en el esquema
    if (schemaName) {
      const { rows: schemaUserRows } = await query(`
        SELECT u.id, u.email, u.first_name, u.last_name, u.is_active
        FROM "${schemaName}".users u
        WHERE u.id = $1 OR u.email = $2
        LIMIT 1
      `, [userId, user.email]);

      if (schemaUserRows.length > 0) {
        const schemaUser = schemaUserRows[0];
        
        const { rows: businessRows } = await query(`
          SELECT b.id, b.name, b.slug, b.is_active, b.schema_name,
                 s.status AS subscription_status
          FROM public.businesses b
          LEFT JOIN public.subscriptions s ON s.business_id = b.id
          WHERE b.schema_name = $1
          LIMIT 1
        `, [schemaName]);

        if (businessRows.length > 0) {
          const biz = businessRows[0];
          return res.json({
            ok: true,
            status: biz.is_active && biz.subscription_status === 'active' ? 'approved' : 'suspended',
            business: {
              id: biz.id,
              name: biz.name,
              slug: biz.slug,
              type: 'Negocio',
              subscription_status: biz.subscription_status,
              role: schemaUser.role_id ? 'employee' : 'user'
            }
          });
        }
      }
    }

    // Si no tiene schemaName o no se encontró, buscar en business_users
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

    if (req.user?.userType === 'schema_employee' || user.schemaName) {
      const schemaName = user.schemaName;
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
        WHERE b.schema_name = $1
      `, [schemaName]);
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
// ENDPOINT: GET /api/business-status/navigation
// =====================================================
router.get('/navigation', async (req, res, next) => {
  try {
    const user = getUserFromToken(req);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'No autenticado' });
    }

    const userId = user.userId;

    // ─── FUNCIÓN PARA CONSTRUIR PÁGINAS (SOLO FEATURES) ───
    const buildModulePages = (mod, featureRows) => {
      const basePath = `/app/${mod.code}`;
      
      // Si tiene features, mostrar SOLO las features
      if (featureRows.length > 0) {
        return featureRows.map(f => ({ 
          id: f.id, 
          code: f.code, 
          name: f.name, 
          path: `${basePath}/${f.code}`, 
          icon: null, 
          isFeature: true 
        }));
      }
      
      // ❌ SI NO TIENE FEATURES, NO DEVOLVER NADA
      return [];
    };

    // ── Empleados de esquema (nivel 3) ──────────────────────────────────────
    if (req.user?.userType === 'schema_employee' || user.schemaName) {
      const schemaName = user.schemaName;

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
        WHERE bm.business_id = (SELECT id FROM public.businesses WHERE schema_name = $1) 
        AND bm.is_active = true
        ORDER BY m.sort_order ASC
      `, [schemaName]);

      const allowedModules = permsByModule
        ? allModules.filter(m => permsByModule.hasOwnProperty(m.id))
        : allModules;

      const menuModules = [];
      for (const mod of allowedModules) {
        const { rows: bizFeatures } = await query(`
          SELECT f.id, f.code, f.name
          FROM public.business_features bf
          JOIN public.features f ON bf.feature_id = f.id
          WHERE bf.business_id = (SELECT id FROM public.businesses WHERE schema_name = $1) 
          AND f.module_id = $2 AND bf.is_active = true
          ORDER BY f.name ASC
        `, [schemaName, mod.id]);

        const allowedFeatures = (permsByModule && permsByModule[mod.id])
          ? bizFeatures.filter(f => permsByModule[mod.id].has(f.id))
          : bizFeatures;

        const pages = buildModulePages(mod, allowedFeatures);
        // ✅ SOLO agregar módulo si tiene páginas (features)
        if (pages.length > 0) {
          menuModules.push({
            id: mod.id, 
            code: mod.code, 
            name: mod.name, 
            icon: mod.icon,
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
    let userRolePermissions = null;

    if (headerBusinessId) {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name, r.permissions
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1 AND bu.business_id = $2
        LIMIT 1
      `, [userId, headerBusinessId]);
      userBiz = rows;
      if (rows.length > 0) {
        userRolePermissions = rows[0].permissions;
      }
    } else {
      const { rows } = await query(`
        SELECT bu.business_id, r.id AS role_id, r.code AS role_code, r.name AS role_name, r.permissions
        FROM public.business_users bu
        JOIN public.roles r ON bu.role_id = r.id
        WHERE bu.user_id = $1
        LIMIT 1
      `, [userId]);
      userBiz = rows;
      if (rows.length > 0) {
        userRolePermissions = rows[0].permissions;
      }
    }

    console.log('[NAV] business_id usado:', userBiz[0]?.business_id);

    if (userBiz.length === 0) {
      return res.json({ ok: true, data: { role: null, modules: [] } });
    }

    const { business_id, role_id, role_code, role_name } = userBiz[0];

    // ─── SI ES MANAGER O ADMIN, ACCESO TOTAL ──────────────────────────────
    const isManagerOrAdmin = role_code === 'manager' || role_code === 'admin' || role_code === 'owner';

    // ─── OBTENER PERMISOS DEL ROL (solo si no es manager/admin) ──────────
    let permsByModule = null;
    if (!isManagerOrAdmin) {
      if (Array.isArray(userRolePermissions) && userRolePermissions.length > 0) {
        permsByModule = {};
        for (const p of userRolePermissions) {
          permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
        }
      } else if (typeof userRolePermissions === 'string') {
        try {
          const parsed = JSON.parse(userRolePermissions);
          if (Array.isArray(parsed) && parsed.length > 0) {
            permsByModule = {};
            for (const p of parsed) {
              permsByModule[p.modulo] = new Set(Array.isArray(p.features) ? p.features : []);
            }
          }
        } catch {}
      }
    }

    // ─── OBTENER MÓDULOS ACTIVOS ──────────────────────────────────────────
    const { rows: modules } = await query(`
      SELECT m.id, m.code, m.name, m.icon, m.sort_order
      FROM public.business_modules bm
      JOIN public.modules m ON bm.module_id = m.id
      WHERE bm.business_id = $1 AND bm.is_active = true
      ORDER BY m.sort_order ASC
    `, [business_id]);

    console.log('[NAV] Módulos activos:', modules.map(m => m.code));

    // ─── FILTRAR MÓDULOS POR PERMISOS ──────────────────────────────────────
    let allowedModules = modules;
    if (!isManagerOrAdmin && permsByModule) {
      allowedModules = modules.filter(m => permsByModule.hasOwnProperty(m.id));
      console.log('[NAV] Módulos permitidos por permisos:', allowedModules.map(m => m.code));
    }

    const menuModules = [];
    for (const mod of allowedModules) {
      const { rows: featureRows } = await query(`
        SELECT f.id, f.code, f.name, f.description
        FROM public.business_features bf
        JOIN public.features f ON bf.feature_id = f.id
        WHERE bf.business_id = $1 AND f.module_id = $2 AND bf.is_active = true
        ORDER BY f.name ASC
      `, [business_id, mod.id]);

      console.log(`[NAV] Módulo ${mod.code} → features: [${featureRows.map(f => f.code).join(', ')}]`);

      // ─── FILTRAR FEATURES POR PERMISOS ──────────────────────────────────
      let allowedFeatures = featureRows;
      if (!isManagerOrAdmin && permsByModule && permsByModule[mod.id]) {
        allowedFeatures = featureRows.filter(f => permsByModule[mod.id].has(f.id));
        console.log(`[NAV] Features permitidas para ${mod.code}: [${allowedFeatures.map(f => f.code).join(', ')}]`);
      }

      const pages = buildModulePages(mod, allowedFeatures);
      // ✅ SOLO agregar módulo si tiene páginas (features)
      if (pages.length > 0) {
        menuModules.push({
          id: mod.id, 
          code: mod.code, 
          name: mod.name,
          icon: mod.icon, 
          features: allowedFeatures.map(f => f.code), 
          pages,
        });
      }
    }

    console.log('[NAV] Módulos finales:', menuModules.map(m => m.code));

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