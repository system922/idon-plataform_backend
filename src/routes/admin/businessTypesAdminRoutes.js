// routes/admin/businessTypes.js
import express from 'express';
import { query } from '../../config/database.js';
import logger from '../../utils/logger.js';

const router = express.Router();

// GET /api/admin/business-types
router.get('/business-types', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT * FROM public.business_types ORDER BY name`
    );
    res.json({ ok: true, data: rows });
  } catch (error) {
    logger.error('❌ Error en GET /business-types:', error);
    next(error);
  }
});

// GET /api/admin/business-types/:id
router.get('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await query(
      `SELECT * FROM public.business_types WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Business type not found' });
    }
    res.json({ ok: true, data: rows[0] });
  } catch (error) {
    logger.error('❌ Error en GET /business-types/:id:', error);
    next(error);
  }
});

// POST /api/admin/business-types
router.post('/business-types', async (req, res, next) => {
  try {
    const { code, name, description, is_active = true } = req.body;
    
    if (!code?.trim() || !name?.trim()) {
      return res.status(400).json({ 
        ok: false, 
        message: 'Código y nombre son requeridos' 
      });
    }

    // Verificar duplicado
    const { rows: existing } = await query(
      `SELECT id FROM public.business_types WHERE code = $1`,
      [code.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ 
        ok: false, 
        message: `Ya existe un tipo de negocio con el código "${code}"` 
      });
    }

    const { rows } = await query(
      `INSERT INTO public.business_types (code, name, description, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [code.trim(), name.trim(), description || null, is_active]
    );
    
    res.status(201).json({ ok: true, data: rows[0] });
  } catch (error) {
    logger.error('❌ Error en POST /business-types:', error);
    next(error);
  }
});

// PUT /api/admin/business-types/:id
router.put('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { code, name, description, is_active } = req.body;
    
    if (!code?.trim() || !name?.trim()) {
      return res.status(400).json({ 
        ok: false, 
        message: 'Código y nombre son requeridos' 
      });
    }

    // Verificar si existe
    const { rows: existing } = await query(
      `SELECT id FROM public.business_types WHERE id = $1`,
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        message: 'Business type not found' 
      });
    }

    // Verificar duplicado de código
    const { rows: duplicate } = await query(
      `SELECT id FROM public.business_types WHERE code = $1 AND id != $2`,
      [code.trim(), id]
    );
    if (duplicate.length > 0) {
      return res.status(409).json({ 
        ok: false, 
        message: `Ya existe otro tipo de negocio con el código "${code}"` 
      });
    }

    const { rows } = await query(
      `UPDATE public.business_types 
       SET code = $1, name = $2, description = $3, is_active = $4, updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [code.trim(), name.trim(), description || null, is_active, id]
    );
    
    res.json({ ok: true, data: rows[0] });
  } catch (error) {
    logger.error('❌ Error en PUT /business-types/:id:', error);
    next(error);
  }
});

// DELETE /api/admin/business-types/:id
router.delete('/business-types/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verificar si existe
    const { rows: existing } = await query(
      `SELECT id FROM public.business_types WHERE id = $1`,
      [id]
    );
    if (existing.length === 0) {
      return res.status(404).json({ 
        ok: false, 
        message: 'Business type not found' 
      });
    }

    // Verificar si está siendo usado
    const { rows: inUse } = await query(
      `SELECT id FROM public.businesses WHERE business_type_id = $1 LIMIT 1`,
      [id]
    );
    if (inUse.length > 0) {
      return res.status(409).json({ 
        ok: false, 
        message: 'No se puede eliminar el tipo porque está siendo usado por uno o más negocios' 
      });
    }

    await query(`DELETE FROM public.business_types WHERE id = $1`, [id]);
    res.json({ ok: true, message: 'Business type deleted successfully' });
  } catch (error) {
    logger.error('❌ Error en DELETE /business-types/:id:', error);
    next(error);
  }
});

export default router;