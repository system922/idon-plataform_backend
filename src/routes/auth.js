// ========== backend/routes/auth.routes.js ==========
import express from 'express';
import * as authService from '../services/authService.js';
import bcrypt from 'bcrypt';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

const router = express.Router();

// ── POST /api/auth/refresh ────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    // ✅ PRIORIDAD: body (sessionStorage) > cookie (respaldo)
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
    
    console.log('📦 Refresh token en body:', req.body?.refreshToken ? '✅ Sí' : '❌ No');
    console.log('🍪 Refresh token en cookie:', req.cookies?.refreshToken ? '✅ Sí' : '❌ No');
    
    if (!refreshToken) {
      return res.status(401).json(errorResponse('Refresh token no encontrado', 401));
    }

    const result = await authService.refreshAccessToken(refreshToken, req);
    
    // ✅ Enviar nuevo refresh token en el body (para sessionStorage)
    // ✅ También en cookie (para compatibilidad)
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
    });

    res.json(successResponse({
      token: result.token,
      refreshToken: result.refreshToken // ✅ Enviar en body
    }, 'Token renovado'));

  } catch (error) {
    console.error('❌ Error en refresh:', error.message);
    if (error.message === 'Invalid refresh token' || 
        error.message === 'Refresh token no encontrado' ||
        error.message === 'Refresh token revocado' ||
        error.message === 'Refresh token expirado') {
      res.clearCookie('refreshToken');
      return res.status(401).json(errorResponse('Refresh token inválido', 401));
    }
    next(error);
  }
});

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    // ✅ Obtener refresh token del body o cookie
    const refreshToken = req.body?.refreshToken || req.cookies?.refreshToken;
    
    if (refreshToken) {
      await authService.invalidateRefreshToken(refreshToken);
    }
    
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    });

    res.json(successResponse(null, 'Logout exitoso'));

  } catch (error) {
    next(error);
  }
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json(errorResponse('Email and password are required', 400));
    }

    logger.info(`[LOGIN] Recibida petición para: ${email}`);

    const result = await authService.login(email, password);
    
    // ✅ Guardar refresh token en cookie HttpOnly (respaldo)
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
      });
    }

    logger.info(`[LOGIN] Login exitoso para: ${email}`);
    logger.info(`[LOGIN] requiresBusinessSelection: ${result.requiresBusinessSelection}`);
    logger.info(`[LOGIN] Negocios: ${result.businesses?.length || 0}`);
    
    // ✅ Enviar refresh token en el body (para sessionStorage)
    const responseData = {
      token: result.token,
      user: result.user,
      businesses: result.businesses || [],
      requiresBusinessSelection: result.requiresBusinessSelection || false,
      hasSuspendedBusinesses: result.hasSuspendedBusinesses || false,
      warnings: result.warnings || null,
      type: result.type || null,
      refreshToken: result.refreshToken // ✅ Enviar en body
    };

    res.json(successResponse(responseData, 'Login successful'));

  } catch (error) {
    logger.error(`[LOGIN] Error para ${email}:`, error.message);
    
    if (error.message === 'Invalid credentials' || error.message === 'User is inactive') {
      return res.status(401).json(errorResponse(error.message, 401));
    }
    if (error.statusCode === 403 || 
        error.message.includes('suspendido') || 
        error.message.includes('pagos pendientes')) {
      return res.status(403).json(errorResponse(error.message, 403));
    }
    next(error);
  }
});

// ── POST /api/auth/select-business ────────────────────────────
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

    logger.info(`[SELECT-BUSINESS] Usuario ${decoded.userId} seleccionando negocio ${businessId}`);

    const result = await authService.selectBusiness(decoded.userId, businessId);
    
    // ✅ Guardar refresh token en cookie HttpOnly (respaldo)
    if (result.refreshToken) {
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 días
      });
    }

    // ✅ Enviar refresh token en el body (para sessionStorage)
    const responseData = {
      token: result.token,
      user: result.user,
      refreshToken: result.refreshToken // ✅ Enviar en body
    };

    res.json(successResponse(responseData, 'Business selected'));

  } catch (error) {
    logger.error(`[SELECT-BUSINESS] Error:`, error.message);
    
    if (error.message.includes('not found') || error.message.includes('denied')) {
      return res.status(403).json(errorResponse(error.message, 403));
    }
    if (error.statusCode === 403 || error.message.includes('suspendido')) {
      return res.status(403).json(errorResponse(error.message, 403));
    }
    next(error);
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { 
    return res.status(401).json({ ok: false, message: 'Token inválido' }); 
  }

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
  } catch (e) { 
    next(e); 
  }
});

// ── GET /api/auth/businesses ──────────────────────────────────────────
router.get('/businesses', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { 
    return res.status(401).json({ ok: false, message: 'Token inválido' }); 
  }

  const userId = decoded.userId || decoded.id;

  try {
    const { rows } = await query(
      `SELECT 
        b.id, 
        b.name, 
        b.slug, 
        b.schema_name,
        bu.role
       FROM public.businesses b
       JOIN public.business_users bu ON bu.business_id = b.id
       WHERE bu.user_id = $1
       ORDER BY b.name`,
      [userId]
    );
    
    res.json({ ok: true, data: rows });
  } catch (e) {
    next(e);
  }
});

// ── PUT /api/auth/me ──────────────────────────────────────────
router.put('/me', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { 
    return res.status(401).json({ ok: false, message: 'Token inválido' }); 
  }

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
  } catch (e) { 
    next(e); 
  }
});

// ── PUT /api/auth/change-password ─────────────────────────────
router.put('/change-password', async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, message: 'Token requerido' });

  let decoded;
  try {
    decoded = authService.verifyToken(token);
  } catch { 
    return res.status(401).json({ ok: false, message: 'Token inválido' }); 
  }

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
  } catch (e) { 
    next(e); 
  }
});

// ── POST /api/auth/validate-jefe-caja ────────────────────────
router.post('/validate-jefe-caja', async (req, res) => {
  const { password, schema } = req.body;
  if (!password || !schema) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const sql = `
      SELECT u.first_name, u.last_name, u.password_hash
      FROM "${schema}".users u
      JOIN "${schema}".roles r ON u.role_id = r.id
      WHERE r.name = $1 AND u.is_active = true
      LIMIT 1
    `;
    const result = await query(sql, ['Jefe/a de Caja']);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No existe Jefe/a de Caja activo' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Clave incorrecta' });

    return res.json({
      ok: true,
      jefe: {
        nombre: `${user.first_name} ${user.last_name}`.trim()
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno' });
  }
});

export default router;