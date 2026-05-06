import express from 'express';
import { query } from '../../config/database.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const router = express.Router();

// ── Configuración global de la plataforma ─────────────────────────────────────
// GET /api/admin/platform-settings
router.get('/platform-settings', async (req, res, next) => {
  try {
    const { rows } = await query('SELECT key, value, label FROM public.platform_settings ORDER BY key');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(successResponse(settings, 'OK'));
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/platform-settings
router.put('/platform-settings', async (req, res, next) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object')
      return res.status(400).json(errorResponse('Body debe ser un objeto { key: value }', 400));
    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO public.platform_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value ?? '')]
      );
    }
    res.json(successResponse(null, 'Configuración guardada'));
  } catch (error) {
    next(error);
  }
});

export default router;
