// ========== backend/routes/blogRoutes.js ==========
import express from 'express';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';

const router = express.Router();

/**
 * GET /api/blog/news
 * Obtiene novedades activas para mostrar en el blog (público, sin autenticación)
 */
router.get('/news', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.type,
        n.icon,
        n.image_url,
        n.is_highlight,
        n.created_at,
        n.priority
      FROM public.idon_news n
      WHERE n.is_active = true
        AND (n.ends_at IS NULL OR n.ends_at > NOW())
        AND n.starts_at <= NOW()
      ORDER BY n.priority DESC, n.created_at DESC
      LIMIT 20
    `);
    
    res.json(successResponse(result.rows, 'Novedades para el blog'));
  } catch (error) {
    console.error('Error al obtener novedades para blog:', error);
    res.status(500).json(errorResponse('Error al obtener novedades', 500));
  }
});

export default router;