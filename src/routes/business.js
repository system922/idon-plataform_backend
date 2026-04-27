/**
 * business.js
 * Rutas de contexto de negocio para el frontend (módulos, features, etc.)
 */
import express from 'express';
import { query } from '../config/database.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/business/:businessId/modules-and-features
 * Devuelve los módulos y features activos del negocio.
 * Usado por el frontend para guardar en localStorage (activeModules, activeFeatures).
 */
router.get('/:businessId/modules-and-features', authMiddleware, async (req, res) => {
  try {
    const { businessId } = req.params;

    const modulesRes = await query(
      `SELECT m.code
         FROM public.business_modules bm
         JOIN public.modules m ON bm.module_id = m.id
        WHERE bm.business_id = $1 AND bm.is_active = true
        ORDER BY m.sort_order`,
      [businessId]
    );

    const featuresRes = await query(
      `SELECT f.code
         FROM public.business_features bf
         JOIN public.features f ON bf.feature_id = f.id
         JOIN public.modules m ON f.module_id = m.id
         JOIN public.business_modules bm ON bm.module_id = m.id AND bm.business_id = bf.business_id
        WHERE bf.business_id = $1 AND bf.is_active = true AND bm.is_active = true`,
      [businessId]
    );

    res.json({
      module_codes:  modulesRes.rows.map(r => r.code),
      feature_codes: featuresRes.rows.map(r => r.code),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
