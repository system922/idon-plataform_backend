import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 10;

// ----------------------
// Register
// ----------------------
export const register = async (data) => {
  const { email, firstName, lastName, password, documentNumber } = data;

  // Check if user exists
  const existing = await query('SELECT id FROM public.users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('User already exists');
  }

  // Check if document exists
  if (documentNumber) {
    const docExists = await query('SELECT id FROM public.users WHERE document_number = $1', [documentNumber]);
    if (docExists.rows.length > 0) {
      throw new Error('Document number already registered');
    }
  }

  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const result = await query(
    `INSERT INTO public.users (id, email, first_name, last_name, password_hash, document_number, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, first_name, last_name`,
    [userId, email, firstName, lastName, passwordHash, documentNumber, true]
  );

  return result.rows[0];
};


// ═══════════════════════════════════════════════════════════
// Verificar estado de MÚLTIPLES negocios
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Verificar estado de MÚLTIPLES negocios (basado en subscriptions)
// ═══════════════════════════════════════════════════════════
export const checkMultipleBusinessStatus = async (businessIds) => {
  if (!businessIds || businessIds.length === 0) {
    return [];
  }

  try {
    const result = await query(
      `SELECT DISTINCT ON (s.business_id)
              s.id as subscription_id,
              s.business_id,
              s.status as subscription_status,
              s.suspended_at,
              s.next_billing_at,
              s.activated_at,
              s.billing_period,
              s.total_amount,
              b.id, b.slug, b.name, b.is_active, b.is_verified,
              (SELECT COUNT(*) FROM public.billing_history bh
               WHERE bh.subscription_id = s.id
                 AND bh.status = 'pending'
                 AND bh.billing_date <= NOW()) as pending_payments_count
       FROM public.subscriptions s
       RIGHT JOIN public.businesses b ON s.business_id = b.id
       WHERE b.id = ANY($1)
       ORDER BY s.business_id, s.created_at DESC`,
      [businessIds]
    );

    if (result.rows.length === 0) {
      // Si no tienen suscripción, retornar como inactivos
      return businessIds.map(id => ({
        id: id,
        status: 'no_subscription',
        subscriptionStatus: 'no_subscription',
        isActive: false,
        isVerified: false,
        hasPendingPayment: false,
        pendingPaymentsCount: 0
      }));
    }

    return result.rows.map(business => {
      const hasPendingPayment = parseInt(business.pending_payments_count || '0') > 0;
      const subStatus = business.subscription_status || 'no_subscription';
      
      let status = 'active';
      if (subStatus === 'suspended' || subStatus === 'inactive' || !business.is_active) {
        status = 'suspended';
      } else if (hasPendingPayment) {
        status = 'payment_pending';
      } else if (subStatus === 'pending_activation' || !business.is_verified) {
        status = 'pending';
      } else if (subStatus === 'no_subscription') {
        status = 'no_subscription';
      }

      return {
        id: business.id,
        slug: business.slug,
        name: business.name,
        status: status,
        subscriptionStatus: subStatus,
        subscriptionId: business.subscription_id,
        isActive: business.is_active,
        isVerified: business.is_verified,
        suspendedAt: business.suspended_at,
        hasPendingPayment: hasPendingPayment,
        pendingPaymentsCount: parseInt(business.pending_payments_count || '0'),
        activatedAt: business.activated_at,
        nextBillingAt: business.next_billing_at
      };
    });
  } catch (error) {
    logger.error('Error checking multiple business status:', error);
    return [];
  }
};

// ═══════════════════════════════════════════════════════════
// Verificar estado de UN negocio (basado en subscriptions)
// ═══════════════════════════════════════════════════════════
export const checkBusinessStatus = async (businessId) => {
  try {
    const result = await query(
      `SELECT s.id, s.business_id, s.status, s.suspended_at, s.next_billing_at, 
              s.activated_at, s.billing_period, s.total_amount,
              s.amount_monthly, s.amount_annual, s.discount_percentage,
              b.is_active, b.is_verified, b.slug, b.name
       FROM public.subscriptions s
       JOIN public.businesses b ON s.business_id = b.id
       WHERE s.business_id = $1
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [businessId]
    );

    if (result.rows.length === 0) {
      return { 
        status: 'no_subscription', 
        message: 'Business has no subscription',
        isActive: false
      };
    }

    const sub = result.rows[0];
    const subscriptionStatus = sub.status || 'pending_activation';
    
    if (subscriptionStatus === 'suspended') {
      return {
        status: 'suspended',
        message: 'Business is suspended',
        suspendedAt: sub.suspended_at,
        businessId: sub.business_id,
        subscriptionStatus: subscriptionStatus
      };
    }

    if (subscriptionStatus === 'inactive' || !sub.is_active) {
      return {
        status: 'suspended',
        message: 'Business is inactive',
        businessId: sub.business_id,
        subscriptionStatus: subscriptionStatus
      };
    }

    const paymentResult = await query(
      `SELECT COUNT(*) as pending_count
       FROM public.billing_history bh
       WHERE bh.subscription_id = $1
         AND bh.status = 'pending'
         AND bh.billing_date <= NOW()`,
      [sub.id]
    );

    const hasPendingPayment = parseInt(paymentResult.rows[0].pending_count) > 0;

    if (hasPendingPayment) {
      return {
        status: 'payment_pending',
        message: 'Business has pending payments',
        businessId: sub.business_id,
        subscriptionStatus: subscriptionStatus,
        pendingPayments: parseInt(paymentResult.rows[0].pending_count)
      };
    }

    if (subscriptionStatus === 'pending_activation' || !sub.is_verified) {
      return {
        status: 'pending',
        message: 'Business pending activation',
        businessId: sub.business_id,
        subscriptionStatus: subscriptionStatus
      };
    }

    return {
      status: 'active',
      message: 'Business is active',
      businessId: sub.business_id,
      subscriptionStatus: subscriptionStatus,
      activatedAt: sub.activated_at,
      nextBillingAt: sub.next_billing_at
    };
  } catch (error) {
    logger.error('Error checking business status:', error);
    return {
      status: 'error',
      message: 'Error checking business status'
    };
  }
};

// ----------------------
// Login - COMPLETO CON VERIFICACIÓN DE MÚLTIPLES NEGOCIOS (USANDO SUBSCRIPTIONS)
// ----------------------
export const login = async (email, password) => {
  logger.info(`[LOGIN] Intentando login para: ${email}`);
  
  // 1. Admin
  const adminResult = await query(
    `SELECT id, email, password_hash, first_name, last_name, role, is_active
     FROM public.admin_users
     WHERE email = $1`,
    [email]
  );
  if (adminResult.rows.length > 0) {
    const admin = adminResult.rows[0];
    logger.info('[LOGIN] Usuario admin encontrado');

    if (!admin.is_active) {
      logger.warn('[LOGIN] Usuario admin inactivo');
      throw new Error('User is inactive');
    }

    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatch) {
      logger.warn('[LOGIN] Credenciales inválidas para admin');
      throw new Error('Invalid credentials');
    }

    await query(
      'UPDATE public.admin_users SET last_login_at = NOW() WHERE id = $1',
      [admin.id]
    );

    const token = jwt.sign(
      {
        userId: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        userType: 'admin_idon',
        role: admin.role,
        roleCode: 'admin',
      },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );

    logger.info('[LOGIN] Login exitoso como admin.');
    return {
      token,
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        userType: 'admin_idon',
        role: admin.role,
      },
    };
  }

  // 2. User en public.users
  const userResult = await query(
    `SELECT id, email, password_hash, first_name, last_name, is_active
     FROM public.users
     WHERE email = $1`,
    [email]
  );

  if (userResult.rows.length > 0) {
    const user = userResult.rows[0];
    if (!user.is_active) {
      logger.warn('[LOGIN] Usuario inactivo en public.users');
      throw new Error('User is inactive');
    }
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      logger.warn('[LOGIN] Credenciales inválidas para usuario en public.users');
      throw new Error('Invalid credentials');
    }
    await query('UPDATE public.users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Verificar si es business_owner
    const ownerCheck = await query(
      `SELECT id FROM public.business_owners WHERE user_id = $1 LIMIT 1`,
      [user.id]
    );
    const isBusinessOwner = ownerCheck.rows.length > 0;

    // Obtener TODOS los negocios del usuario CON SU SUSCRIPCIÓN
    const bizResult = await query(
      `SELECT DISTINCT ON (b.id)
              b.id, b.slug, b.name, b.schema_name, b.is_active, b.is_verified,
              bt.name AS business_type, bt.code AS business_type_code,
              bu.is_owner, r.code AS role_code,
              COALESCE(s.status, 'no_subscription') as subscription_status,
              s.suspended_at, s.next_billing_at, s.activated_at,
              s.id as subscription_id
       FROM public.business_users bu
       JOIN public.businesses b ON bu.business_id = b.id
       LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
       LEFT JOIN public.roles r ON bu.role_id = r.id
       LEFT JOIN public.subscriptions s ON b.id = s.business_id
       WHERE bu.user_id = $1 AND bu.is_active = TRUE
       ORDER BY b.id, s.created_at DESC`,
      [user.id]
    );
    const allBusinesses = bizResult.rows;

    const userType = isBusinessOwner ? 'owner' : (allBusinesses.length > 0 ? 'employee' : 'business_user');
    logger.info(`[LOGIN] Usuario encontrado en public.users — userType: ${userType}, negocios: ${allBusinesses.length}`);

    // Verificar estado de TODOS los negocios
    const businessIds = allBusinesses.map(b => b.id);
    const businessStatuses = await checkMultipleBusinessStatus(businessIds);

    // Filtrar negocios activos (los que sí pueden acceder)
    const activeBusinesses = [];
    const suspendedBusinesses = [];

    for (const biz of allBusinesses) {
      const status = businessStatuses.find(s => s.id === biz.id);
      
      // Si el negocio está activo y no suspendido, permitir acceso
      if (status && (status.status === 'active' || status.status === 'pending')) {
        activeBusinesses.push({
          ...biz,
          businessStatus: status.status,
          subscriptionStatus: status.subscriptionStatus,
          hasPendingPayment: status.hasPendingPayment
        });
      } else if (status) {
        suspendedBusinesses.push({
          ...biz,
          businessStatus: status.status,
          subscriptionStatus: status.subscriptionStatus,
          suspensionReason: status.suspensionReason || status.message,
          suspendedAt: status.suspendedAt,
          hasPendingPayment: status.hasPendingPayment
        });
      }
    }

    logger.info(`[LOGIN] Negocios activos: ${activeBusinesses.length}, suspendidos: ${suspendedBusinesses.length}`);

    // Caso 1: Tiene negocios activos (puede loguearse)
    if (activeBusinesses.length > 0) {
      logger.info(`[LOGIN] Usuario tiene ${activeBusinesses.length} negocios activos, ${suspendedBusinesses.length} suspendidos`);

      // Si tiene exactamente 1 negocio activo, auto-seleccionarlo
      if (activeBusinesses.length === 1) {
        const biz = activeBusinesses[0];
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType,
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || (isBusinessOwner ? 'owner' : 'employee'),
            businessStatus: biz.businessStatus || 'active',
            subscriptionStatus: biz.subscriptionStatus || 'active'
          },
          env.jwt.secret,
          { expiresIn: env.jwt.expiresIn }
        );

        return {
          token,
          type: userType,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType,
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || (isBusinessOwner ? 'owner' : 'employee'),
            businessStatus: biz.businessStatus || 'active',
            subscriptionStatus: biz.subscriptionStatus || 'active'
          },
          businesses: activeBusinesses,
          allBusinesses: allBusinesses,
          suspendedBusinesses: suspendedBusinesses,
          requiresBusinessSelection: false,
          hasSuspendedBusinesses: suspendedBusinesses.length > 0
        };
      }

      // Tiene múltiples negocios activos - requiere selección
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType,
        },
        env.jwt.secret,
        { expiresIn: env.jwt.expiresIn }
      );

      return {
        token,
        type: userType,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType,
        },
        businesses: activeBusinesses,  // Solo negocios activos
        allBusinesses: allBusinesses,  // Todos los negocios
        suspendedBusinesses: suspendedBusinesses,
        requiresBusinessSelection: true,
        hasSuspendedBusinesses: suspendedBusinesses.length > 0,
        warnings: {
          hasSuspended: suspendedBusinesses.length > 0,
          suspendedCount: suspendedBusinesses.length
        }
      };
    }

    // Caso 2: No tiene negocios activos (todos suspendidos o con pagos pendientes)
    if (suspendedBusinesses.length > 0) {
      // Verificar si son por suspensión o por pagos pendientes
      const allSuspended = suspendedBusinesses.every(b => b.businessStatus === 'suspended');
      const allPaymentPending = suspendedBusinesses.every(b => b.businessStatus === 'payment_pending');
      const allNoSubscription = suspendedBusinesses.every(b => b.businessStatus === 'no_subscription');
      
      if (allSuspended) {
        throw new Error('Todos tus negocios están suspendidos. Contacta a soporte.');
      } else if (allPaymentPending) {
        throw new Error('Tienes pagos pendientes en todos tus negocios. Por favor realiza el pago.');
      } else if (allNoSubscription) {
        throw new Error('Ninguno de tus negocios tiene una suscripción activa. Contacta a soporte.');
      } else {
        throw new Error('Tienes negocios suspendidos o con pagos pendientes. Contacta a soporte.');
      }
    }

    // Caso 3: No tiene ningún negocio
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: 'business_user',
      },
      env.jwt.secret,
      { expiresIn: env.jwt.expiresIn }
    );
    logger.info('[LOGIN] Login exitoso como usuario sin negocio activo.');
    return {
      token,
      type: 'business_user',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: 'business_user',
      },
      businesses: [],
      requiresBusinessSelection: false,
    };
  }

  // 3. SCHEMA TENANT EMPLOYEE
  logger.info('[LOGIN] No encontrado en public.users — buscando en schemas de negocios...');
  const activeBusinessesQuery = await query(
    `SELECT b.id, b.slug, b.name, b.schema_name, b.is_active,
            COALESCE(s.status, 'no_subscription') as subscription_status,
            s.suspended_at
     FROM public.businesses b
     LEFT JOIN public.subscriptions s ON b.id = s.business_id
     WHERE b.is_active = TRUE
     ORDER BY b.name`
  );

  for (const biz of activeBusinessesQuery.rows) {
    try {
      // Verificar si el negocio está suspendido por subscription
      if (biz.subscription_status === 'suspended' || 
          biz.subscription_status === 'inactive' ||
          biz.subscription_status === 'no_subscription') {
        logger.warn(`[LOGIN] Business ${biz.name} is ${biz.subscription_status}, skipping`);
        continue;
      }

      const schemaUserResult = await query(
        `SELECT id, email, password_hash, first_name, last_name, is_active, role_id
         FROM "${biz.schema_name}".users
         WHERE email = $1
         LIMIT 1`,
        [email]
      );

      if (schemaUserResult.rows.length === 0) continue;
      const schemaUser = schemaUserResult.rows[0];

      if (!schemaUser.is_active) {
        throw new Error('User is inactive');
      }

      const passwordMatch = await bcrypt.compare(password, schemaUser.password_hash);
      if (!passwordMatch) {
        throw new Error('Invalid credentials');
      }

      // Obtener subscription_id para verificar pagos pendientes
      const subIdResult = await query(
        `SELECT id FROM public.subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [biz.id]
      );

      let hasPendingPayment = false;
      if (subIdResult.rows.length > 0) {
        const paymentResult = await query(
          `SELECT COUNT(*) as pending_count
           FROM public.billing_history bh
           WHERE bh.subscription_id = $1
             AND bh.status = 'pending'
             AND bh.billing_date <= NOW()`,
          [subIdResult.rows[0].id]
        );
        hasPendingPayment = parseInt(paymentResult.rows[0].pending_count) > 0;
      }

      if (hasPendingPayment) {
        throw new Error(`El negocio "${biz.name}" tiene pagos pendientes. Por favor realiza el pago.`);
      }

      // Leer rol y permisos
      let roleCode = 'employee';
      let roleName = '';
      let permissions = [];
      try {
        const roleResult = await query(
          `SELECT r.name AS role_name, r.permissions
           FROM "${biz.schema_name}".roles r
           WHERE r.id = $1
           LIMIT 1`,
          [schemaUser.role_id]
        );
        if (roleResult.rows.length > 0) {
          roleCode = roleResult.rows[0].role_name || 'employee';
          roleName = roleResult.rows[0].role_name || '';
          permissions = roleResult.rows[0].permissions || [];
        }
      } catch (e) {
        logger.warn(`[LOGIN] No se pudo consultar el rol en schema ${biz.schema_name}: ${e.message}`);
      }

      // ========= BLOQUE DE LOGS DE MÓDULOS Y FUNCIONALIDADES ==========
      let perms = [];
      try {
        perms = typeof permissions === 'string' ? JSON.parse(permissions) : (permissions || []);
      } catch (e) {
        logger.warn('[LOGIN] Error al parsear JSONB de permissions:', e);
        perms = [];
      }
      console.log('\n========== ACCESO DEL USUARIO: Módulos y Funcionalidades ==========');
      console.log(`[LOGIN] Permisos JSONB asignados al rol: ${JSON.stringify(perms, null, 2)}`);

      const modRes = await query(
        `SELECT m.id, m.code, m.name
         FROM public.business_modules bm
         JOIN public.modules m ON bm.module_id = m.id
         WHERE bm.business_id = $1 AND bm.is_active = true`,
        [biz.id]
      );
      const allModules = modRes.rows;

      for (const pmod of perms) {
        const mod = allModules.find(m => m.id === pmod.modulo || m.code === pmod.modulo);
        console.log(`-- MÓDULO: ${mod ? mod.name : pmod.modulo} (${pmod.modulo})`);
        if (pmod.features && pmod.features.length) {
          const featRes = await query(
            `SELECT id, code, name FROM public.features WHERE module_id = $1`,
            [mod ? mod.id : pmod.modulo]
          );
          for (const f of pmod.features) {
            const feat = featRes.rows.find(fr => fr.id === f || fr.code === f);
            console.log(`     - Feature: ${feat ? feat.name : f} (${f})`);
          }
        }
      }
      console.log('========== FIN DEL ACCESO DEL USUARIO ==========\n');
      // ===============================================================

      const token = jwt.sign(
        {
          userId: schemaUser.id,
          email: schemaUser.email,
          firstName: schemaUser.first_name,
          lastName: schemaUser.last_name,
          userType: 'schema_employee',
          businessId: biz.id,
          businessSlug: biz.slug,
          schemaName: biz.schema_name,
          roleCode,
          businessStatus: 'active',
          subscriptionStatus: biz.subscription_status || 'active'
        },
        env.jwt.secret,
        { expiresIn: env.jwt.expiresIn }
      );

      logger.info(`[LOGIN] Login exitoso como empleado del schema ${biz.schema_name}`);

      return {
        token,
        type: 'schema_employee',
        user: {
          id: schemaUser.id,
          email: schemaUser.email,
          firstName: schemaUser.first_name,
          lastName: schemaUser.last_name,
          userType: 'schema_employee',
          businessId: biz.id,
          businessSlug: biz.slug,
          schemaName: biz.schema_name,
          roleCode,
          roleName,
          permissions,
          businessStatus: 'active',
          subscriptionStatus: biz.subscription_status || 'active'
        },
        businesses: [biz],
        requiresBusinessSelection: false,
      };
    } catch (err) {
      if (err.message === 'Invalid credentials' || err.message === 'User is inactive') throw err;
      logger.debug(`[LOGIN] Schema ${biz.schema_name} error: ${err.message}`);
    }
  }

  logger.warn('[LOGIN] Usuario no encontrado en ninguna fuente');
  throw new Error('Invalid credentials');
};

// ----------------------
// Seleccionar business tras login
// ----------------------
export const selectBusiness = async (userId, businessId) => {
  // 🔥 NUEVO: Verificar estado del negocio antes de seleccionar
  const statusCheck = await checkBusinessStatus(businessId);
  if (statusCheck.status === 'suspended') {
    throw new Error('Este negocio está suspendido. Contacta a soporte.');
  }
  if (statusCheck.status === 'payment_pending') {
    throw new Error('Este negocio tiene pagos pendientes. Por favor realiza el pago.');
  }

  const result = await query(
    `SELECT b.id, b.slug, b.name, b.schema_name, b.is_active,
            COALESCE(s.status, 'no_subscription') as subscription_status,
            bt.name AS business_type, bt.code AS business_type_code,
            bu.is_owner, r.code AS role_code,
            u.email, u.first_name, u.last_name
    FROM public.business_users bu
    JOIN public.businesses b ON bu.business_id = b.id
    LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
    LEFT JOIN public.roles r ON bu.role_id = r.id
    LEFT JOIN public.subscriptions s ON b.id = s.business_id
    JOIN public.users u ON bu.user_id = u.id
    WHERE bu.user_id = $1 AND b.id = $2
      AND bu.is_active = TRUE AND b.is_active = TRUE
    ORDER BY s.created_at DESC
    LIMIT 1`,
    [userId, businessId]
  );

  if (result.rows.length === 0) {
    throw new Error('Business not found or access denied');
  }

  const row = result.rows[0];

  // 🔥 NUEVO: Doble verificación de estado
  if (row.subscription_status === 'suspended' || 
    row.subscription_status === 'inactive' || 
    row.subscription_status === 'no_subscription' ||
    !row.is_active) {
    throw new Error('Este negocio está suspendido.');
  }

  const token = jwt.sign(
    {
      userId,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      userType: 'owner',
      businessId: row.id,
      businessSlug: row.slug,
      schemaName: row.schema_name,
      roleCode: row.role_code || 'owner',
      businessStatus: 'active',
      subscriptionStatus: row.subscription_status || 'active'
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  return {
    token,
    type: 'owner',
    user: {
      id:           userId,
      email:        row.email,
      firstName:    row.first_name,
      lastName:     row.last_name,
      userType:     'owner',
      businessId:   row.id,
      businessSlug: row.slug,
      schemaName:   row.schema_name,
      roleCode:     row.role_code || 'owner',
      businessStatus: row.status || 'active'
    },
  };
};

// ----------------------
// Token helpers
// ----------------------
export const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, env.jwt.secret);
    return decoded;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const refreshToken = (token) => {
  const decoded = verifyToken(token);
  const newToken = jwt.sign(
    {
      userId: decoded.userId,
      email: decoded.email,
      firstName: decoded.firstName,
      lastName: decoded.lastName,
      ...(decoded.businessId && { businessId: decoded.businessId }),
      ...(decoded.businessSlug && { businessSlug: decoded.businessSlug }),
      ...(decoded.roleCode && { roleCode: decoded.roleCode }),
      ...(decoded.businessStatus && { businessStatus: decoded.businessStatus }),
      ...(decoded.subscriptionStatus && { subscriptionStatus: decoded.subscriptionStatus }),
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  return { token: newToken };
};

// ----------------------
// Registro de negocio
// ----------------------
export const registerBusiness = async (data) => {
  const {
    businessName,
    businessType,
    businessSlug,
    ownerFirstName,
    ownerLastName,
    ownerEmail,
    ownerPhone,
    ownerDocumentNumber,
    password,
  } = data;

  // Validate email
  const existingEmail = await query('SELECT id FROM public.users WHERE email = $1', [ownerEmail]);
  if (existingEmail.rows.length > 0) {
    throw new Error('Email already registered');
  }

  // Validate slug doesn't exist
  const existingSlug = await query('SELECT id FROM public.business_registration_requests WHERE slug = $1', [businessSlug]);
  if (existingSlug.rows.length > 0) {
    throw new Error('Business slug already registered');
  }

  // Validate document
  const existingDoc = await query(
    'SELECT id FROM public.business_registration_requests WHERE owner_document_number = $1',
    [ownerDocumentNumber]
  );
  if (existingDoc.rows.length > 0) {
    throw new Error('Document already registered');
  }

  // Get business type ID
  const typeResult = await query('SELECT id FROM public.business_types WHERE code = $1', [businessType]);
  if (typeResult.rows.length === 0) {
    throw new Error('Invalid business type');
  }
  const businessTypeId = typeResult.rows[0].id;

  // Create user
  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  await query(
    `INSERT INTO public.users (id, email, first_name, last_name, phone, document_number, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, ownerEmail, ownerFirstName, ownerLastName, ownerPhone, ownerDocumentNumber, passwordHash, true]
  );

  // Create registration request
  const requestResult = await query(
    `INSERT INTO public.business_registration_requests 
     (slug, business_name, business_type_id, owner_first_name, owner_last_name, owner_email, owner_phone, owner_document_number, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING id, slug, business_name, status, requested_at`,
    [businessSlug, businessName, businessTypeId, ownerFirstName, ownerLastName, ownerEmail, ownerPhone, ownerDocumentNumber]
  );

  const request = requestResult.rows[0];

  // Generate token for the newly created user
  const token = jwt.sign(
    {
      userId: userId,
      email: ownerEmail,
      firstName: ownerFirstName,
      lastName: ownerLastName,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  return {
    token,
    user: {
      id: userId,
      email: ownerEmail,
      firstName: ownerFirstName,
      lastName: ownerLastName,
    },
    registration: {
      id: request.id,
      businessName: request.business_name,
      businessSlug: request.slug,
      status: request.status,
      requestedAt: request.requested_at,
      message: 'Registration request created. Please wait for admin approval.',
    },
  };
};