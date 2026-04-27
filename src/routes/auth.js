import express from 'express';
import * as authService from '../services/authService.js';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { notifyRegistro } from '../utils/waNotifications.js';
import logger from '../utils/logger.js';

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, firstName, lastName, password, documentNumber } = req.body;

    if (!email || !password) {
      return res.status(400).json(errorResponse('Email and password are required', 400));
    }

    const user = await authService.register({
      email,
      firstName,
      lastName,
      password,
      documentNumber,
    });

    res.json(successResponse(user, 'User registered successfully', 201));
  } catch (error) {
    next(error);
  }
});

router.post('/register-business', async (req, res, next) => {
  try {
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
    } = req.body;

    if (!businessName || !businessType || !businessSlug || !ownerEmail || !ownerDocumentNumber || !password) {
      return res.status(400).json(
        errorResponse('Missing required fields: businessName, businessType, businessSlug, ownerEmail, ownerDocumentNumber, password', 400)
      );
    }

    const result = await authService.registerBusiness({
      businessName,
      businessType,
      businessSlug,
      ownerFirstName,
      ownerLastName,
      ownerEmail,
      ownerPhone,
      ownerDocumentNumber,
      password,
    });

    res.status(201).json(successResponse(result, 'Business registration request created', 201));

    console.log(`\n========================================`);
    console.log(`[REGISTRO] Nuevo negocio: ${businessName}`);
    console.log(`[REGISTRO] ownerPhone recibido: "${ownerPhone}"`);
    console.log(`========================================\n`);

    notifyRegistro(ownerPhone, {
      firstName:    ownerFirstName || '',
      lastName:     ownerLastName  || '',
      email:        ownerEmail,
      businessName,
      businessSlug,
    });

  } catch (error) {
    if (error.message.includes('already')) {
      return res.status(409).json(errorResponse(error.message, 409));
    }
    if (error.message === 'Invalid business type') {
      return res.status(400).json(errorResponse(error.message, 400));
    }
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(errorResponse('Email and password are required', 400));
    }

    const result = await authService.login(email, password);
    res.json(successResponse(result, 'Login successful'));
  } catch (error) {
    if (error.message === 'Invalid credentials' || error.message === 'User is inactive') {
      return res.status(401).json(errorResponse(error.message, 401));
    }
    next(error);
  }
});

router.post('/login-business', async (req, res, next) => {
  try {
    const { email, password, businessSlug } = req.body;

    if (!email || !password || !businessSlug) {
      return res.status(400).json(errorResponse('Email, password, and businessSlug are required', 400));
    }

    const result = await authService.loginBusiness(email, password, businessSlug);
    res.json(successResponse(result, 'Business login successful'));
  } catch (error) {
    if (error.message.includes('Invalid credentials')) {
      return res.status(401).json(errorResponse(error.message, 401));
    }
    next(error);
  }
});

/**
 * POST /api/auth/select-business
 * After a multi-business login, exchange a plain token for one with a specific businessId.
 * Body: { businessId }
 * Headers: Authorization: Bearer <token>
 */
router.post('/select-business', async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json(errorResponse('Token required', 401));

    let decoded;
    try {
      decoded = authService.verifyToken(token);
    } catch {
      return res.status(401).json(errorResponse('Invalid token', 401));
    }

    const { businessId } = req.body;
    if (!businessId) return res.status(400).json(errorResponse('businessId is required', 400));

    const result = await authService.selectBusiness(decoded.userId, businessId);
    res.json(successResponse(result, 'Business selected'));
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('denied')) {
      return res.status(403).json(errorResponse(error.message, 403));
    }
    next(error);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json(errorResponse('Token is required', 400));
    }

    const result = authService.refreshToken(token);
    res.json(successResponse(result, 'Token refreshed'));
  } catch (error) {
    if (error.message === 'Invalid token') {
      return res.status(401).json(errorResponse(error.message, 401));
    }
    next(error);
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { return res.status(401).json({ ok: false, message: 'Token inválido' }); }

  const userId    = decoded.userId || decoded.id;
  const userType  = decoded.userType;
  const schema    = decoded.schemaName;

  try {
    let profile = null;
    if (userType === 'admin_idon') {
      const { rows } = await query(
        `SELECT id, email, first_name, last_name, role FROM public.admin_users WHERE id=$1`, [userId]
      );
      profile = rows[0];
    } else if (userType === 'schema_employee' && schema) {
      const { rows } = await query(
        `SELECT u.id, u.email, u.first_name, u.last_name, r.name AS role_name
         FROM "${schema}".users u
         LEFT JOIN "${schema}".roles r ON u.role_id = r.id
         WHERE u.id=$1`, [userId]
      );
      profile = rows[0];
    } else {
      const { rows } = await query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.phone
         FROM public.users u WHERE u.id=$1`, [userId]
      );
      profile = rows[0];
    }
    if (!profile) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    res.json({ ok: true, data: profile });
  } catch (e) { next(e); }
});

// ── PUT /api/auth/me ──────────────────────────────────────────
router.put('/me', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { return res.status(401).json({ ok: false, message: 'Token inválido' }); }

  const userId   = decoded.userId || decoded.id;
  const userType = decoded.userType;
  const schema   = decoded.schemaName;
  const { firstName, lastName, phone } = req.body;
  if (!firstName || !lastName) return res.status(400).json({ ok: false, message: 'Nombre y apellido requeridos' });

  try {
    let updated = null;
    if (userType === 'admin_idon') {
      const { rows } = await query(
        `UPDATE public.admin_users SET first_name=$1, last_name=$2, updated_at=NOW() WHERE id=$3
         RETURNING id, email, first_name, last_name`,
        [firstName, lastName, userId]
      );
      updated = rows[0];
    } else if (userType === 'schema_employee' && schema) {
      const { rows } = await query(
        `UPDATE "${schema}".users SET first_name=$1, last_name=$2, updated_at=NOW() WHERE id=$3
         RETURNING id, email, first_name, last_name`,
        [firstName, lastName, userId]
      );
      updated = rows[0];
    } else {
      const { rows } = await query(
        `UPDATE public.users SET first_name=$1, last_name=$2, phone=$3 WHERE id=$4
         RETURNING id, email, first_name, last_name, phone`,
        [firstName, lastName, phone || null, userId]
      );
      updated = rows[0];
    }
    if (!updated) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });
    res.json({ ok: true, data: updated });
  } catch (e) { next(e); }
});

// ── PUT /api/auth/change-password ─────────────────────────────
router.put('/change-password', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { return res.status(401).json({ ok: false, message: 'Token inválido' }); }

  const userId   = decoded.userId || decoded.id;
  const userType = decoded.userType;
  const schema   = decoded.schemaName;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ ok: false, message: 'Contraseña actual y nueva requeridas' });
  if (newPassword.length < 6)
    return res.status(400).json({ ok: false, message: 'La nueva contraseña debe tener al menos 6 caracteres' });

  try {
    let hashRow = null;
    if (userType === 'admin_idon') {
      const { rows } = await query(`SELECT password_hash FROM public.admin_users WHERE id=$1`, [userId]);
      hashRow = rows[0];
    } else if (userType === 'schema_employee' && schema) {
      const { rows } = await query(`SELECT password_hash FROM "${schema}".users WHERE id=$1`, [userId]);
      hashRow = rows[0];
    } else {
      const { rows } = await query(`SELECT password_hash FROM public.users WHERE id=$1`, [userId]);
      hashRow = rows[0];
    }
    if (!hashRow) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });

    const match = await bcrypt.compare(currentPassword, hashRow.password_hash);
    if (!match) return res.status(401).json({ ok: false, message: 'Contraseña actual incorrecta' });

    const newHash = await bcrypt.hash(newPassword, 10);
    if (userType === 'admin_idon') {
      await query(`UPDATE public.admin_users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, [newHash, userId]);
    } else if (userType === 'schema_employee' && schema) {
      await query(`UPDATE "${schema}".users SET password_hash=$1, updated_at=NOW() WHERE id=$2`, [newHash, userId]);
    } else {
      await query(`UPDATE public.users SET password_hash=$1 WHERE id=$2`, [newHash, userId]);
    }
    res.json({ ok: true, message: 'Contraseña actualizada correctamente' });
  } catch (e) { next(e); }
});

router.post('/validate-jefe-caja', async (req, res) => {
  const { password, schema } = req.body;
  if (!password || !schema) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    // 1. Busca usuario activo con rol "Jefe/a de Caja" en el schema correspondiente
    const sql = `
      SELECT u.password_hash FROM "${schema}".users u
      JOIN "${schema}".roles r ON u.role_id = r.id
      WHERE r.name = $1 AND u.is_active = true
      LIMIT 1
    `;
    const result = await query(sql, ['Jefe/a de Caja']);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No existe Jefe/a de Caja activo' });
    }

    // 2. Compara password con bcrypt
    const ok = await bcrypt.compare(password, result.rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: 'Clave incorrecta' });

    return res.json({ ok: true });
  } catch (err) {
    console.error('Error validando Jefe/a de Caja:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
