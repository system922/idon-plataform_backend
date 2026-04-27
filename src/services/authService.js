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

// ----------------------
// Login
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
    logger.info('[LOGIN] Usuario admin encontrado:', admin);

    if (!admin.is_active) {
      logger.warn('[LOGIN] Usuario admin inactivo');
      throw new Error('User is inactive');
    }

    const passwordMatch = await bcrypt.compare(password, admin.password_hash);
    logger.info(`[LOGIN] Password match: ${passwordMatch}`);
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

    logger.info('[LOGIN] Login exitoso como admin. Token generado.');
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
    // tipo business_owners / empleados / nuevos
    const ownerCheck = await query(
      `SELECT id FROM public.business_owners WHERE user_id = $1 LIMIT 1`,
      [user.id]
    );
    const isBusinessOwner = ownerCheck.rows.length > 0;

    const bizResult = await query(
      `SELECT b.id, b.slug, b.name, b.schema_name,
              bt.name AS business_type, bt.code AS business_type_code,
              bu.is_owner, r.code AS role_code
       FROM public.business_users bu
       JOIN public.businesses  b  ON bu.business_id = b.id
       LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
       LEFT JOIN public.roles    r  ON bu.role_id = r.id
       WHERE bu.user_id = $1 AND bu.is_active = TRUE AND b.is_active = TRUE
       ORDER BY b.name`,
      [user.id]
    );
    const businesses = bizResult.rows;

    const userType = isBusinessOwner ? 'owner' : (businesses.length > 0 ? 'employee' : 'business_user');
    logger.info(`[LOGIN] Usuario encontrado en public.users — userType: ${userType}, negocios: ${businesses.length}`);

    if (businesses.length === 1) {
      const biz = businesses[0];
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
        },
        env.jwt.secret,
        { expiresIn: env.jwt.expiresIn }
      );
      logger.info(`[LOGIN] Login exitoso — 1 negocio auto-seleccionado: ${biz.slug}`);
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
        },
        businesses,
        requiresBusinessSelection: false,
      };
    }

    if (businesses.length > 1) {
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
      logger.info(`[LOGIN] Login exitoso — ${businesses.length} negocios, requiere selección`);
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
        businesses,
        requiresBusinessSelection: true,
      };
    }

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
  const activeBusinesses = await query(
    `SELECT id, slug, name, schema_name FROM public.businesses WHERE is_active = TRUE ORDER BY name`
  );

  for (const biz of activeBusinesses.rows) {
    try {
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
        logger.warn(`[LOGIN] Usuario inactivo en schema ${biz.schema_name}`);
        throw new Error('User is inactive');
      }

      const passwordMatch = await bcrypt.compare(password, schemaUser.password_hash);
      if (!passwordMatch) {
        logger.warn(`[LOGIN] Credenciales inválidas para usuario en schema ${biz.schema_name}`);
        throw new Error('Invalid credentials');
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
// LoginBusiness para slug específico
// ----------------------
export const loginBusiness = async (email, password, businessSlug) => {
  const result = await query(
    `SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name, u.is_active,
            b.id as business_id, b.slug, r.code as role_code
     FROM public.users u
     JOIN public.business_users bu ON u.id = bu.user_id
     JOIN public.businesses b ON bu.business_id = b.id
     JOIN public.roles r ON bu.role_id = r.id
     WHERE u.email = $1 AND b.slug = $2 AND bu.is_active = true`,
    [email, businessSlug]
  );

  if (result.rows.length === 0) {
    throw new Error('Invalid credentials or business not found');
  }

  const user = result.rows[0];

  if (!user.is_active) {
    throw new Error('User is inactive');
  }

  const passwordMatch = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatch) {
    throw new Error('Invalid credentials');
  }

  await query(
    'UPDATE public.users SET last_login_at = NOW() WHERE id = $1',
    [user.id]
  );

  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      businessId: user.business_id,
      businessSlug: user.slug,
      roleCode: user.role_code,
    },
    env.jwt.secret,
    { expiresIn: env.jwt.expiresIn }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      businessId: user.business_id,
      businessSlug: user.slug,
      roleCode: user.role_code,
    },
  };
};

// ----------------------
// Seleccionar business tras login
// ----------------------
export const selectBusiness = async (userId, businessId) => {
  const result = await query(
    `SELECT b.id, b.slug, b.name, b.schema_name,
            bt.name AS business_type, bt.code AS business_type_code,
            bu.is_owner, r.code AS role_code,
            u.email, u.first_name, u.last_name
     FROM public.business_users bu
     JOIN public.businesses b    ON bu.business_id = b.id
     LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
     LEFT JOIN public.roles r    ON bu.role_id = r.id
     JOIN public.users u         ON bu.user_id = u.id
     WHERE bu.user_id = $1 AND b.id = $2
       AND bu.is_active = TRUE AND b.is_active = TRUE`,
    [userId, businessId]
  );

  if (result.rows.length === 0) {
    throw new Error('Business not found or access denied');
  }

  const row = result.rows[0];

  const token = jwt.sign(
    {
      userId,
      email:        row.email,
      firstName:    row.first_name,
      lastName:     row.last_name,
      userType:     'owner',
      businessId:   row.id,
      businessSlug: row.slug,
      schemaName:   row.schema_name,
      roleCode:     row.role_code || 'owner',
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