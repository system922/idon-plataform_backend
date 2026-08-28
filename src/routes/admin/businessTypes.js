// routes/admin/businessTypes.js

import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';
import { successResponse } from '../../utils/response.js';

const router = express.Router();

// ============================================================
// GET /api/admin/business-types
// Obtener todos los tipos de negocio
// ============================================================
router.get('/business-types', async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT *
      FROM public.business_types
      ORDER BY name
    `);

    res.json(
      successResponse(rows, 'Business types fetched')
    );
  } catch (error) {
    logger.error('Error obteniendo tipos de negocio:', error);
    next(error);
  }
});

// ============================================================
// GET /api/admin/business-types/:id
// Obtener un tipo de negocio por ID
// ============================================================
router.get('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await query(
      `
        SELECT *
        FROM public.business_types
        WHERE id = $1
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Business type not found'
      });
    }

    res.json(
      successResponse(rows[0], 'Business type fetched')
    );
  } catch (error) {
    logger.error(
      `Error obteniendo tipo de negocio ${req.params.id}:`,
      error
    );

    next(error);
  }
});

// ============================================================
// POST /api/admin/business-types
// Crear tipo de negocio
// ============================================================
router.post('/business-types', async (req, res, next) => {
  try {
    const {
      code,
      name,
      description,
      is_active = true
    } = req.body;

    // Validaciones
    if (!code?.trim() || !name?.trim()) {
      return res.status(400).json({
        ok: false,
        message: 'Código y nombre son requeridos'
      });
    }

    const cleanCode = code.trim();
    const cleanName = name.trim();
    const cleanDescription = description?.trim() || null;

    // Verificar código duplicado
    const { rows: existing } = await query(
      `
        SELECT id
        FROM public.business_types
        WHERE code = $1
      `,
      [cleanCode]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        ok: false,
        message: `Ya existe un tipo de negocio con el código "${cleanCode}"`
      });
    }

    // Crear
    const { rows } = await query(
      `
        INSERT INTO public.business_types (
          code,
          name,
          description,
          is_active
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [
        cleanCode,
        cleanName,
        cleanDescription,
        is_active
      ]
    );

    res.status(201).json(
      successResponse(rows[0], 'Business type created')
    );
  } catch (error) {
    logger.error('Error creando tipo de negocio:', error);
    next(error);
  }
});

// ============================================================
// PUT /api/admin/business-types/:id
// Actualizar tipo de negocio
// ============================================================
router.put('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const {
      code,
      name,
      description,
      is_active
    } = req.body;

    // Validaciones
    if (!code?.trim() || !name?.trim()) {
      return res.status(400).json({
        ok: false,
        message: 'Código y nombre son requeridos'
      });
    }

    const cleanCode = code.trim();
    const cleanName = name.trim();
    const cleanDescription = description?.trim() || null;

    // Verificar existencia
    const { rows: existing } = await query(
      `
        SELECT id
        FROM public.business_types
        WHERE id = $1
      `,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Business type not found'
      });
    }

    // Verificar código duplicado
    const { rows: duplicate } = await query(
      `
        SELECT id
        FROM public.business_types
        WHERE code = $1
          AND id != $2
      `,
      [
        cleanCode,
        id
      ]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        ok: false,
        message: `Ya existe otro tipo de negocio con el código "${cleanCode}"`
      });
    }

    // Actualizar
    const { rows } = await query(
      `
        UPDATE public.business_types
        SET
          code = $1,
          name = $2,
          description = $3,
          is_active = $4,
          updated_at = NOW()
        WHERE id = $5
        RETURNING *
      `,
      [
        cleanCode,
        cleanName,
        cleanDescription,
        is_active,
        id
      ]
    );

    res.json(
      successResponse(rows[0], 'Business type updated')
    );
  } catch (error) {
    logger.error(
      `Error actualizando tipo de negocio ${req.params.id}:`,
      error
    );

    next(error);
  }
});

// ============================================================
// DELETE /api/admin/business-types/:id
// Eliminar tipo de negocio
// ============================================================
router.delete('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verificar existencia
    const { rows: existing } = await query(
      `
        SELECT id
        FROM public.business_types
        WHERE id = $1
      `,
      [id]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        ok: false,
        message: 'Business type not found'
      });
    }

    // Verificar si está siendo utilizado
    const { rows: inUse } = await query(
      `
        SELECT id
        FROM public.businesses
        WHERE business_type_id = $1
        LIMIT 1
      `,
      [id]
    );

    if (inUse.length > 0) {
      return res.status(409).json({
        ok: false,
        message:
          'No se puede eliminar el tipo porque está siendo usado por uno o más negocios'
      });
    }

    // Eliminar
    await query(
      `
        DELETE FROM public.business_types
        WHERE id = $1
      `,
      [id]
    );

    res.json({
      ok: true,
      message: 'Business type deleted successfully'
    });
  } catch (error) {
    logger.error(
      `Error eliminando tipo de negocio ${req.params.id}:`,
      error
    );

    next(error);
  }
});

export default router;
