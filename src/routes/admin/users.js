import express from 'express';
import { query, getClient } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const router = express.Router();

// GET /api/admin/users
router.get('/users', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, email, first_name, last_name, phone, is_active, email_verified, created_at, updated_at
       FROM public.users ORDER BY created_at DESC`
    );
    res.json(successResponse(result.rows, 'Usuarios listados correctamente'));
  } catch (error) {
    logger.error('Error listando usuarios:', error);
    res.status(500).json(errorResponse('Error listando usuarios', 500, error.message));
  }
});

// GET /api/admin/users/:id
router.get('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT id, email, first_name, last_name, phone, is_active, email_verified, created_at, updated_at
       FROM public.users WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse('Usuario no encontrado', 404));
    }
    res.json(successResponse(result.rows[0], 'Usuario encontrado'));
  } catch (error) {
    logger.error('Error obteniendo usuario:', error);
    res.status(500).json(errorResponse('Error obteniendo usuario', 500, error.message));
  }
});

// PUT /api/admin/users/:id
router.put('/users/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone } = req.body;

    // Verificar si el email ya existe en otro usuario
    const existing = await query(
      `SELECT id FROM public.users WHERE email = $1 AND id != $2`,
      [email, id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json(errorResponse('El email ya está en uso por otro usuario', 409));
    }

    const result = await query(
      `UPDATE public.users 
       SET first_name = $1, last_name = $2, email = $3, phone = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING id, email, first_name, last_name, phone, is_active, email_verified, created_at, updated_at`,
      [first_name, last_name, email, phone, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse('Usuario no encontrado', 404));
    }

    logger.info(`[ADMIN] Usuario ${id} actualizado por admin`);
    res.json(successResponse(result.rows[0], 'Usuario actualizado correctamente'));
  } catch (error) {
    logger.error('Error actualizando usuario:', error);
    res.status(500).json(errorResponse('Error actualizando usuario', 500, error.message));
  }
});

// PATCH /api/admin/users/:id/toggle-active
router.patch('/users/:id/toggle-active', async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await query(
      `SELECT is_active FROM public.users WHERE id = $1`,
      [id]
    );
    if (user.rows.length === 0) {
      return res.status(404).json(errorResponse('Usuario no encontrado', 404));
    }

    const newStatus = !user.rows[0].is_active;
    const result = await query(
      `UPDATE public.users 
       SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, is_active`,
      [newStatus, id]
    );

    logger.info(`[ADMIN] Usuario ${id} ${newStatus ? 'activado' : 'desactivado'} por admin`);
    res.json(successResponse(result.rows[0], `Usuario ${newStatus ? 'activado' : 'desactivado'} correctamente`));
  } catch (error) {
    logger.error('Error cambiando estado de usuario:', error);
    res.status(500).json(errorResponse('Error cambiando estado de usuario', 500, error.message));
  }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res, next) => {
  const client = await getClient();
  try {
    const { id } = req.params;

    await client.query('BEGIN');

    // Verificar si el usuario existe
    const userCheck = await client.query(
      `SELECT id, email FROM public.users WHERE id = $1`,
      [id]
    );
    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json(errorResponse('Usuario no encontrado', 404));
    }

    // Verificar si es el último usuario administrador (opcional)
    // Puedes agregar lógica para prevenir eliminar al último admin

    // Eliminar relaciones en business_owners si existe
    await client.query(
      `DELETE FROM public.business_owners WHERE user_id = $1`,
      [id]
    );

    // Eliminar relaciones en business_users
    await client.query(
      `DELETE FROM public.business_users WHERE user_id = $1`,
      [id]
    );

    // Eliminar el usuario
    await client.query(
      `DELETE FROM public.users WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');

    logger.info(`[ADMIN] Usuario ${id} (${userCheck.rows[0].email}) eliminado por admin`);
    res.json(successResponse(null, 'Usuario eliminado correctamente'));
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error eliminando usuario:', error);
    res.status(500).json(errorResponse('Error eliminando usuario', 500, error.message));
  } finally {
    client.release();
  }
});

export default router;