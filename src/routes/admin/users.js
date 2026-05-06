import express from 'express';
import { query } from '../../config/database.js';
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

export default router;
