// ========== backend/services/authService.js ==========
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { sendPasswordResetEmail } from '../services/crmEmailService.js';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database.js';
import env from '../config/env.js';
import logger from '../utils/logger.js';

const SALT_ROUNDS = 10;

// ════════════════════════════════════════════════════════════════
// RECUPERACIÓN DE CONTRASEÑA
// ════════════════════════════════════════════════════════════════

// ─── Solicitar recuperación de contraseña ─────────────────────
export const requestPasswordReset = async (email) => {
  logger.info(`[PASSWORD-RESET] Solicitando recuperación para: ${email}`);

  // 1. Buscar usuario en todas las fuentes
  let user = null;
  let userSource = null;
  let schemaName = null;
  let businessName = null;

  // Buscar en admin_users
  const adminResult = await query(
    `SELECT id, email, first_name, last_name, 'admin' as user_type 
     FROM public.admin_users 
     WHERE email = $1 AND is_active = true`,
    [email]
  );
  if (adminResult.rows.length > 0) {
    user = adminResult.rows[0];
    userSource = 'admin_idon';
    businessName = 'IDON Admin';
  }

  // Buscar en public.users
  if (!user) {
    const userResult = await query(
      `SELECT u.id, u.email, u.first_name, u.last_name, 'user' as user_type,
              b.name as business_name,
              bo.id as owner_id
       FROM public.users u
       LEFT JOIN public.business_owners bo ON u.id = bo.user_id
       LEFT JOIN public.business_registration_requests brr ON bo.id = brr.business_owner_id
       LEFT JOIN public.businesses b ON brr.business_id = b.id
       WHERE u.email = $1 AND u.is_active = true
       LIMIT 1`,
      [email]
    );
    if (userResult.rows.length > 0) {
      user = userResult.rows[0];
      userSource = 'public';
      businessName = user.business_name || 'IDON';
    }
  }

  // Si no se encontró en admin_users ni en public.users,
  // buscar en schemas de negocios (empleados de esquemas)
  if (!user) {
    const businesses = await query(
      `SELECT b.id, b.schema_name, b.name 
       FROM public.businesses b 
       WHERE b.is_active = true`
    );

    for (const biz of businesses.rows) {
      try {
        const schemaUser = await query(
          `SELECT id, email, first_name, last_name 
           FROM "${biz.schema_name}".users 
           WHERE email = $1 AND is_active = true`,
          [email]
        );
        if (schemaUser.rows.length > 0) {
          user = schemaUser.rows[0];
          userSource = 'schema';
          schemaName = biz.schema_name;
          businessName = biz.name;
          break;
        }
      } catch (e) {
        continue;
      }
    }
  }

  if (!user) {
    logger.warn(`[PASSWORD-RESET] Usuario no encontrado: ${email}`);
    throw new Error('Usuario no encontrado');
  }

  // 2. Generar token de recuperación
  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

  // 3. Guardar token en la tabla password_resets
  await query(
    `INSERT INTO public.password_resets 
     (user_id, user_source, schema_name, token_hash, expires_at, email)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, userSource, schemaName, tokenHash, expiresAt, email]
  );

  // 4. Construir URL de recuperación
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;
  
  // 5. Enviar email con Resend
  try {
    await sendPasswordResetEmail(
      email,
      resetUrl,
      businessName || 'IDON'
    );
    logger.info(`[PASSWORD-RESET] Email enviado a: ${email}`);
  } catch (emailError) {
    logger.error(`[PASSWORD-RESET] Error enviando email:`, emailError);
    // No lanzamos error para no exponer que el usuario existe
  }

  logger.info(`[PASSWORD-RESET] Token generado para: ${email}`);
  
  return {
    message: 'Se ha enviado un enlace de recuperación a tu correo',
    // En desarrollo, devolver el token para pruebas
    ...(process.env.NODE_ENV === 'development' && { resetToken })
  };
};

// ─── Validar token de recuperación ─────────────────────────────
export const validateResetToken = async (token) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  const result = await query(
    `SELECT pr.*, 
            COALESCE(u.first_name, a.first_name, su.first_name) as first_name,
            COALESCE(u.email, a.email, pr.email) as email
     FROM public.password_resets pr
     LEFT JOIN public.users u ON pr.user_id = u.id AND pr.user_source = 'public'
     LEFT JOIN public.admin_users a ON pr.user_id = a.id AND pr.user_source = 'admin_idon'
     LEFT JOIN public.users su ON pr.user_id = su.id AND pr.user_source = 'schema'
     WHERE pr.token_hash = $1 AND pr.used = false AND pr.expires_at > NOW()`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw new Error('Token inválido o expirado');
  }

  return {
    valid: true,
    email: result.rows[0].email,
    firstName: result.rows[0].first_name
  };
};

// ─── Resetear contraseña ──────────────────────────────────────
export const resetPassword = async (token, newPassword) => {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  
  // Verificar token
  const tokenResult = await query(
    `SELECT pr.* 
     FROM public.password_resets pr
     WHERE pr.token_hash = $1 AND pr.used = false AND pr.expires_at > NOW()`,
    [tokenHash]
  );

  if (tokenResult.rows.length === 0) {
    throw new Error('Token inválido o expirado');
  }

  const resetData = tokenResult.rows[0];
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Actualizar contraseña según la fuente del usuario
  if (resetData.user_source === 'admin_idon') {
    await query(
      `UPDATE public.admin_users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, resetData.user_id]
    );
  } else if (resetData.user_source === 'public') {
    await query(
      `UPDATE public.users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, resetData.user_id]
    );
  } else if (resetData.user_source === 'schema' && resetData.schema_name) {
    await query(
      `UPDATE "${resetData.schema_name}".users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, resetData.user_id]
    );
  }

  // Marcar token como usado
  await query(
    `UPDATE public.password_resets SET used = true, used_at = NOW() WHERE id = $1`,
    [resetData.id]
  );

  // Invalidar todos los refresh tokens del usuario por seguridad
  await invalidateAllUserRefreshTokens(resetData.user_id, resetData.user_source);

  logger.info(`[PASSWORD-RESET] Contraseña actualizada para usuario: ${resetData.user_id}`);
  
  return { success: true };
};

// ----------------------
// Register
// ----------------------
export const register = async (data) => {
  const { email, firstName, lastName, password, documentNumber } = data;

  const existing = await query('SELECT id FROM public.users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    throw new Error('User already exists');
  }

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
      return businessIds.map(id => ({
        id: id,
        status: 'active',
        subscriptionStatus: 'no_subscription',
        isActive: true,
        isVerified: true,
        hasPendingPayment: false,
        pendingPaymentsCount: 0
      }));
    }

    return result.rows.map(business => {
      const hasPendingPayment = parseInt(business.pending_payments_count || '0') > 0;
      const subStatus = business.subscription_status || 'no_subscription';
      
      let status = 'active';
      if (subStatus === 'suspended' || subStatus === 'inactive') {
        status = 'suspended';
      } else if (hasPendingPayment) {
        status = 'payment_pending';
      } else if (subStatus === 'pending_activation' && !business.is_verified) {
        status = 'pending';
      }

      return {
        id: business.id,
        slug: business.slug,
        name: business.name,
        status: status,
        subscriptionStatus: subStatus,
        subscriptionId: business.subscription_id,
        isActive: business.is_active !== false,
        isVerified: business.is_verified !== false,
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
// Verificar estado de UN negocio
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
        status: 'active', 
        message: 'Business has no subscription, treating as active',
        isActive: true
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
// Login - COMPLETO CON VERIFICACIÓN DE MÚLTIPLES NEGOCIOS
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

    const refreshToken = await generateRefreshToken(admin.id, 'public');

    return {
      token,
      refreshToken, 
      user: {
        id: admin.id,
        email: admin.email,
        firstName: admin.first_name,
        lastName: admin.last_name,
        userType: 'admin_idon',
        role: admin.role,
        requiresBusinessSelection: false,
      },
      businesses: [], // ✅ Admin no tiene negocios
      requiresBusinessSelection: false,
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

    const ownerCheck = await query(
      `SELECT id FROM public.business_owners WHERE user_id = $1 LIMIT 1`,
      [user.id]
    );
    const isBusinessOwner = ownerCheck.rows.length > 0;

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

    const businessIds = allBusinesses.map(b => b.id);
    const businessStatuses = await checkMultipleBusinessStatus(businessIds);

    const activeBusinesses = [];
    const suspendedBusinesses = [];

    for (const biz of allBusinesses) {
      const status = businessStatuses.find(s => s.id === biz.id);
      
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

    // Caso 1: Tiene negocios activos
    if (activeBusinesses.length > 0) {
      logger.info(`[LOGIN] Usuario tiene ${activeBusinesses.length} negocios activos, ${suspendedBusinesses.length} suspendidos`);

      // ✅ Si tiene exactamente 1 negocio activo
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

        const refreshToken = await generateRefreshToken(user.id, 'public');

        // ✅ Mapear negocios para la respuesta
        const mappedBusinesses = activeBusinesses.map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          schema_name: b.schema_name,
          business_type: b.business_type || 'Negocio',
          business_type_code: b.business_type_code,
          is_owner: b.is_owner,
          role_code: b.role_code || (isBusinessOwner ? 'owner' : 'employee'),
          subscription_status: b.subscription_status || 'active',
          businessStatus: b.businessStatus || 'active'
        }));

        return {
          token,
          refreshToken,
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
            subscriptionStatus: biz.subscriptionStatus || 'active',
            requiresBusinessSelection: false,
          },
          businesses: mappedBusinesses,
          allBusinesses: allBusinesses,
          suspendedBusinesses: suspendedBusinesses,
          requiresBusinessSelection: false,
          hasSuspendedBusinesses: suspendedBusinesses.length > 0
        };
      }

      // ✅ Tiene múltiples negocios activos - REQUIERE SELECCIÓN
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

      const refreshToken = await generateRefreshToken(user.id, 'public');

      // ✅ Mapear negocios para la respuesta
      const mappedBusinesses = activeBusinesses.map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        schema_name: b.schema_name,
        business_type: b.business_type || 'Negocio',
        business_type_code: b.business_type_code,
        is_owner: b.is_owner,
        role_code: b.role_code || (isBusinessOwner ? 'owner' : 'employee'),
        subscription_status: b.subscription_status || 'active',
        businessStatus: b.businessStatus || 'active'
      }));

      logger.info(`[LOGIN] Múltiples negocios activos: ${mappedBusinesses.length}`);
      logger.info(`[LOGIN] mappedBusinesses: ${JSON.stringify(mappedBusinesses.map(b => ({ id: b.id, name: b.name })))}`);

      return {
        token,
        refreshToken, 
        type: userType,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType,
          requiresBusinessSelection: true, // ✅ IMPORTANTE
        },
        businesses: mappedBusinesses, // ✅ LISTA COMPLETA DE NEGOCIOS
        allBusinesses: allBusinesses,
        suspendedBusinesses: suspendedBusinesses,
        requiresBusinessSelection: true,
        hasSuspendedBusinesses: suspendedBusinesses.length > 0,
        warnings: {
          hasSuspended: suspendedBusinesses.length > 0,
          suspendedCount: suspendedBusinesses.length
        }
      };
    }

    // Caso 2: No tiene negocios activos (todos suspendidos)
    if (suspendedBusinesses.length > 0) {
      const allSuspended = suspendedBusinesses.every(b => b.businessStatus === 'suspended');
      const allPaymentPending = suspendedBusinesses.every(b => b.businessStatus === 'payment_pending');
      
      logger.info(`[LOGIN] suspendedBusinesses details: ${JSON.stringify(suspendedBusinesses.map(b => ({ 
        id: b.id, 
        name: b.name, 
        businessStatus: b.businessStatus,
        subscriptionStatus: b.subscriptionStatus
      })))}`);
      
      if (allSuspended) {
        const biz = suspendedBusinesses[0];
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'suspended',
            subscriptionStatus: biz.subscriptionStatus || 'suspended'
          },
          env.jwt.secret,
          { expiresIn: env.jwt.expiresIn }
        );

        logger.info(`[LOGIN] Login exitoso pero negocio suspendido: ${biz.name}`);

        const refreshToken = await generateRefreshToken(user.id, 'public');

        return {
          token,
          refreshToken, 
          type: 'owner',
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'suspended',
            subscriptionStatus: biz.subscriptionStatus || 'suspended',
            requiresBusinessSelection: false,
          },
          businesses: [],
          allBusinesses: allBusinesses,
          suspendedBusinesses: suspendedBusinesses,
          requiresBusinessSelection: false,
          hasSuspendedBusinesses: true,
          businessStatus: 'suspended'
        };
      } else if (allPaymentPending) {
        const biz = suspendedBusinesses[0];
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'payment_pending',
            subscriptionStatus: biz.subscriptionStatus || 'payment_pending'
          },
          env.jwt.secret,
          { expiresIn: env.jwt.expiresIn }
        );

        const refreshToken = await generateRefreshToken(user.id, 'public');

        return {
          token,
          refreshToken,
          type: 'owner',
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'payment_pending',
            subscriptionStatus: biz.subscription_status || 'payment_pending',
            requiresBusinessSelection: false,
          },
          businesses: [],
          allBusinesses: allBusinesses,
          suspendedBusinesses: suspendedBusinesses,
          requiresBusinessSelection: false,
          hasSuspendedBusinesses: true,
          businessStatus: 'payment_pending'
        };
      } else {
        const biz = suspendedBusinesses[0];
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'suspended',
            subscriptionStatus: biz.subscription_status || 'suspended'
          },
          env.jwt.secret,
          { expiresIn: env.jwt.expiresIn }
        );

        const refreshToken = await generateRefreshToken(user.id, 'public');

        return {
          token,
          refreshToken, 
          type: 'owner',
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            userType: 'owner',
            businessId: biz.id,
            businessSlug: biz.slug,
            schemaName: biz.schema_name,
            roleCode: biz.role_code || 'owner',
            businessStatus: 'suspended',
            subscriptionStatus: biz.subscription_status || 'suspended',
            requiresBusinessSelection: false,
          },
          businesses: [],
          allBusinesses: allBusinesses,
          suspendedBusinesses: suspendedBusinesses,
          requiresBusinessSelection: false,
          hasSuspendedBusinesses: true,
          businessStatus: 'suspended'
        };
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

    const refreshToken = await generateRefreshToken(user.id, 'public');

    return {
      token,
      refreshToken, 
      type: 'business_user',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        userType: 'business_user',
        requiresBusinessSelection: false,
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
      if (biz.subscription_status === 'suspended' || 
          biz.subscription_status === 'inactive') {
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
        const error = new Error(`El negocio "${biz.name}" tiene pagos pendientes. Por favor realiza el pago.`);
        error.statusCode = 403;
        throw error;
      }

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

      const refreshToken = await generateRefreshToken(
        schemaUser.id, 
        'schema', 
        biz.schema_name
      );

      // ✅ Mapear negocios para la respuesta
      const mappedBusinesses = [{
        id: biz.id,
        name: biz.name,
        slug: biz.slug,
        schema_name: biz.schema_name,
        business_type: biz.business_type || 'Negocio',
        business_type_code: biz.business_type_code,
        is_owner: false,
        role_code: roleCode,
        subscription_status: biz.subscription_status || 'active',
        businessStatus: 'active'
      }];

      return {
        token,
        refreshToken, 
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
          subscriptionStatus: biz.subscription_status || 'active',
          requiresBusinessSelection: false,
        },
        businesses: mappedBusinesses,
        requiresBusinessSelection: false,
      };
    } catch (err) {
      if (err.message === 'Invalid credentials' || err.message === 'User is inactive') throw err;
      if (err.statusCode === 403) throw err;
      logger.debug(`[LOGIN] Schema ${biz.schema_name} error: ${err.message}`);
    }
  }

  logger.warn('[LOGIN] Usuario no encontrado en ninguna fuente');
  throw new Error('Usuario no registrado');
};

// ----------------------
// Seleccionar business tras login
// ----------------------
export const selectBusiness = async (userId, businessId) => {
  const statusCheck = await checkBusinessStatus(businessId);
  if (statusCheck.status === 'suspended') {
    const error = new Error('Este negocio está suspendido. Contacta a soporte.');
    error.statusCode = 403;
    throw error;
  }
  if (statusCheck.status === 'payment_pending') {
    const error = new Error('Este negocio tiene pagos pendientes. Por favor realiza el pago.');
    error.statusCode = 403;
    throw error;
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

  if (row.subscription_status === 'suspended' || 
    row.subscription_status === 'inactive') {
    const error = new Error('Este negocio está suspendido.');
    error.statusCode = 403;
    throw error;
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

  const refreshToken = await generateRefreshToken(userId, 'public');

  return {
    token,
    refreshToken, 
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
      businessStatus: 'active',
      requiresBusinessSelection: false,
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

  const existingEmail = await query('SELECT id FROM public.users WHERE email = $1', [ownerEmail]);
  if (existingEmail.rows.length > 0) {
    throw new Error('Email already registered');
  }

  const existingSlug = await query('SELECT id FROM public.business_registration_requests WHERE slug = $1', [businessSlug]);
  if (existingSlug.rows.length > 0) {
    throw new Error('Business slug already registered');
  }

  const existingDoc = await query(
    'SELECT id FROM public.business_registration_requests WHERE owner_document_number = $1',
    [ownerDocumentNumber]
  );
  if (existingDoc.rows.length > 0) {
    throw new Error('Document already registered');
  }

  const typeResult = await query('SELECT id FROM public.business_types WHERE code = $1', [businessType]);
  if (typeResult.rows.length === 0) {
    throw new Error('Invalid business type');
  }
  const businessTypeId = typeResult.rows[0].id;

  const userId = uuidv4();
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  await query(
    `INSERT INTO public.users (id, email, first_name, last_name, phone, document_number, password_hash, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, ownerEmail, ownerFirstName, ownerLastName, ownerPhone, ownerDocumentNumber, passwordHash, true]
  );

  const requestResult = await query(
    `INSERT INTO public.business_registration_requests 
     (slug, business_name, business_type_id, owner_first_name, owner_last_name, owner_email, owner_phone, owner_document_number, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     RETURNING id, slug, business_name, status, requested_at`,
    [businessSlug, businessName, businessTypeId, ownerFirstName, ownerLastName, ownerEmail, ownerPhone, ownerDocumentNumber]
  );

  const request = requestResult.rows[0];

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

// ================================================================
// ========== FUNCIONES DE REFRESH TOKEN ==========================
// ================================================================

export const generateRefreshToken = async (userId, userSource, schemaName = null) => {
  try {
    const refreshToken = jwt.sign(
      { 
        userId, 
        userSource,
        schemaName,
        type: 'refresh' 
      },
      env.jwt.secret,
      { expiresIn: '7d' }
    );

    await query(
      `INSERT INTO public.refresh_tokens 
       (user_id, user_source, schema_name, token, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
       ON CONFLICT (user_id, user_source) 
       DO UPDATE SET 
         token = $4, 
         expires_at = NOW() + INTERVAL '7 days', 
         revoked = FALSE, 
         revoked_at = NULL`,
      [userId, userSource, schemaName, refreshToken]
    );

    return refreshToken;
  } catch (error) {
    logger.error('Error generating refresh token:', error);
    throw new Error('Error generating refresh token');
  }
};

export const verifyRefreshToken = async (refreshToken) => {
  try {
    const result = await query(
      `SELECT user_id, user_source, schema_name, expires_at, revoked
       FROM public.refresh_tokens 
       WHERE token = $1`,
      [refreshToken]
    );

    if (result.rows.length === 0) {
      throw new Error('Refresh token no encontrado');
    }

    const tokenData = result.rows[0];

    if (tokenData.revoked) {
      throw new Error('Refresh token revocado');
    }

    if (new Date(tokenData.expires_at) < new Date()) {
      throw new Error('Refresh token expirado');
    }

    return tokenData;
  } catch (error) {
    logger.error('Error verifying refresh token:', error);
    throw new Error('Refresh token inválido');
  }
};

export const invalidateRefreshToken = async (refreshToken) => {
  try {
    await query(
      `UPDATE public.refresh_tokens 
       SET revoked = TRUE, revoked_at = NOW()
       WHERE token = $1`,
      [refreshToken]
    );
  } catch (error) {
    logger.error('Error invalidating refresh token:', error);
  }
};

export const invalidateAllUserRefreshTokens = async (userId, userSource) => {
  try {
    await query(
      `UPDATE public.refresh_tokens 
       SET revoked = TRUE, revoked_at = NOW()
       WHERE user_id = $1 AND user_source = $2 AND revoked = FALSE`,
      [userId, userSource]
    );
  } catch (error) {
    logger.error('Error invalidating user refresh tokens:', error);
  }
};

export const refreshAccessToken = async (refreshToken, req) => {
  try {
    const tokenData = await verifyRefreshToken(refreshToken);

    let user = null;
    let newToken = null;

    if (tokenData.user_source === 'public') {
      const result = await query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.user_type, u.role, u.business_id,
                b.name as business_name, b.slug as business_slug, b.schema_name
         FROM public.users u
         LEFT JOIN public.businesses b ON u.business_id = b.id
         WHERE u.id = $1 AND u.is_active = true`,
        [tokenData.user_id]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Usuario no encontrado o inactivo');
      }
      
      user = result.rows[0];
      
      newToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: user.user_type || 'schema_owner',
          role: user.role,
          businessId: user.business_id,
          businessSlug: user.business_slug,
          schemaName: user.schema_name,
          userSource: 'public'
        },
        env.jwt.secret,
        { expiresIn: '8h' }
      );

    } else if (tokenData.user_source === 'schema') {
      if (!tokenData.schema_name) {
        throw new Error('Schema name requerido para usuario de schema');
      }

      const result = await query(
        `SELECT id, email, first_name, last_name, is_active
         FROM "${tokenData.schema_name}".users
         WHERE id = $1 AND is_active = true`,
        [tokenData.user_id]
      );
      
      if (result.rows.length === 0) {
        throw new Error('Usuario de schema no encontrado o inactivo');
      }
      
      user = result.rows[0];

      const businessResult = await query(
        `SELECT b.id, b.slug, b.name, b.schema_name
         FROM public.businesses b
         WHERE b.schema_name = $1 AND b.is_active = true`,
        [tokenData.schema_name]
      );

      const business = businessResult.rows[0] || null;

      newToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          userType: 'schema_employee',
          businessId: business?.id,
          businessSlug: business?.slug,
          schemaName: tokenData.schema_name,
          userSource: 'schema'
        },
        env.jwt.secret,
        { expiresIn: '8h' }
      );

    } else {
      throw new Error('Fuente de usuario no soportada');
    }

    const newRefreshToken = await generateRefreshToken(
      tokenData.user_id,
      tokenData.user_source,
      tokenData.schema_name
    );

    await invalidateRefreshToken(refreshToken);

    return {
      token: newToken,
      refreshToken: newRefreshToken
    };

  } catch (error) {
    logger.error('Refresh access token error:', error);
    throw new Error('Invalid refresh token');
  }
};