import express from 'express';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';

const router = express.Router();

/**
 * GET /api/business-owners/find?type=cedula&number=1234567890
 * Busca un propietario por tipo y número de documento.
 * Usado en el registro para pre-cargar datos si ya existe.
 */
router.get('/find', async (req, res) => {
  const { type, number } = req.query;

  if (!type || !number) {
    return res.status(400).json(errorResponse('type y number son requeridos', 400));
  }

  try {
    const result = await query(
      `SELECT first_name, last_name, email, phone
       FROM public.business_owners
       WHERE document_type = $1 AND document_number = $2
       LIMIT 1`,
      [type, number]
    );

    if (result.rows.length === 0) {
      return res.json({ exists: false });
    }

    res.json({ exists: true, owner: result.rows[0] });
  } catch (err) {
    res.status(500).json(errorResponse('Error buscando propietario', 500, err.message));
  }
});

export default router;
