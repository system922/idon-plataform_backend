// ========== src/routes/idonNewsRoutes.js ==========
import express from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { query } from '../config/database.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';

const router = express.Router();

// Configurar Cloudinary
cloudinary.config({ 
  cloudinary_url: process.env.CLOUDINARY_URL 
});

// Configurar multer para memoria
const upload = multer({ 
  storage: multer.memoryStorage(), 
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// Tipos de novedades
const NEWS_TYPES = ['new_module', 'improvement', 'announcement', 'update', 'feature'];

/**
 * GET /api/admin/IdonNews
 * Obtiene todas las novedades (solo admin)
 */
router.get('/', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const result = await query(`
      SELECT 
        n.id,
        n.title,
        n.content,
        n.type,
        n.icon,
        n.image_url,
        n.is_active,
        n.is_highlight,
        n.priority,
        n.starts_at,
        n.ends_at,
        n.created_at,
        n.updated_at,
        u.first_name || ' ' || u.last_name AS created_by_name
      FROM public.idon_news n
      LEFT JOIN public.admin_users u ON n.created_by = u.id
      ORDER BY n.priority DESC, n.starts_at DESC
    `);
    
    res.json(successResponse(result.rows, 'Novedades obtenidas'));
  } catch (error) {
    console.error('Error al obtener novedades:', error);
    next(error);
  }
});

/**
 * GET /api/admin/IdonNews/active
 * Obtiene novedades activas para mostrar en el home (público)
 */
router.get('/active', async (req, res, next) => {
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
    
    res.json(successResponse(result.rows, 'Novedades activas'));
  } catch (error) {
    console.error('Error al obtener novedades activas:', error);
    next(error);
  }
});

/**
 * GET /api/admin/IdonNews/:id
 * Obtiene una novedad por ID
 */
router.get('/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT * FROM public.idon_news WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }
    
    res.json(successResponse(result.rows[0], 'Novedad obtenida'));
  } catch (error) {
    console.error('Error al obtener novedad:', error);
    next(error);
  }
});

/**
 * POST /api/admin/IdonNews
 * Crea una nueva novedad
 */
router.post('/', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const {
      title,
      content,
      type,
      icon,
      image_url,
      is_active,
      is_highlight,
      priority,
      starts_at,
      ends_at
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json(errorResponse('El título es requerido', 400));
    }
    
    if (!content || !content.trim()) {
      return res.status(400).json(errorResponse('El contenido es requerido', 400));
    }
    
    if (!type) {
      return res.status(400).json(errorResponse('El tipo es requerido', 400));
    }

    const validTypes = ['new_module', 'improvement', 'announcement', 'update', 'feature'];
    if (!validTypes.includes(type)) {
      return res.status(400).json(errorResponse('Tipo de novedad inválido', 400));
    }

    const userId = req.user.id;

    const result = await query(`
      INSERT INTO public.idon_news (
        title, content, type, icon, image_url,
        is_active, is_highlight, priority,
        starts_at, ends_at, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      title.trim(), 
      content.trim(), 
      type, 
      icon || null, 
      image_url || null,
      is_active !== false, 
      is_highlight || false, 
      priority || 0,
      starts_at || new Date(), 
      ends_at || null,
      userId
    ]);

    res.json(successResponse(result.rows[0], 'Novedad creada exitosamente'));
  } catch (error) {
    console.error('Error al crear novedad:', error);
    next(error);
  }
});

/**
 * PUT /api/admin/IdonNews/:id
 * Actualiza una novedad existente
 */
router.put('/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      content,
      type,
      icon,
      image_url,
      is_active,
      is_highlight,
      priority,
      starts_at,
      ends_at
    } = req.body;

    const checkResult = await query(
      'SELECT id FROM public.idon_news WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }

    if (title !== undefined && !title.trim()) {
      return res.status(400).json(errorResponse('El título no puede estar vacío', 400));
    }
    
    if (content !== undefined && !content.trim()) {
      return res.status(400).json(errorResponse('El contenido no puede estar vacío', 400));
    }

    const result = await query(`
      UPDATE public.idon_news SET
        title = COALESCE($1, title),
        content = COALESCE($2, content),
        type = COALESCE($3, type),
        icon = COALESCE($4, icon),
        image_url = COALESCE($5, image_url),
        is_active = COALESCE($6, is_active),
        is_highlight = COALESCE($7, is_highlight),
        priority = COALESCE($8, priority),
        starts_at = COALESCE($9, starts_at),
        ends_at = $10
      WHERE id = $11
      RETURNING *
    `, [
      title ? title.trim() : null, 
      content ? content.trim() : null, 
      type, 
      icon, 
      image_url,
      is_active, 
      is_highlight, 
      priority,
      starts_at, 
      ends_at, 
      id
    ]);

    res.json(successResponse(result.rows[0], 'Novedad actualizada exitosamente'));
  } catch (error) {
    console.error('Error al actualizar novedad:', error);
    next(error);
  }
});

/**
 * PATCH /api/admin/IdonNews/:id/toggle
 * Alterna el estado activo/inactivo de una novedad
 */
router.patch('/:id/toggle', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const checkResult = await query(
      'SELECT is_active FROM public.idon_news WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }

    const current = checkResult.rows[0];
    const newStatus = !current.is_active;

    const result = await query(`
      UPDATE public.idon_news
      SET is_active = $1
      WHERE id = $2
      RETURNING *
    `, [newStatus, id]);

    res.json(successResponse(
      result.rows[0], 
      newStatus ? 'Novedad activada' : 'Novedad desactivada'
    ));
  } catch (error) {
    console.error('Error al alternar estado de novedad:', error);
    next(error);
  }
});

/**
 * DELETE /api/admin/IdonNews/:id
 * Elimina una novedad
 */
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    const result = await query(
      'DELETE FROM public.idon_news WHERE id = $1 RETURNING id',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }

    res.json(successResponse(null, 'Novedad eliminada exitosamente'));
  } catch (error) {
    console.error('Error al eliminar novedad:', error);
    next(error);
  }
});

/**
 * POST /api/admin/IdonNews/:id/image
 * Sube una imagen para una novedad a Cloudinary
 */
router.post('/:id/image', authMiddleware, adminMiddleware, upload.single('image'), async (req, res, next) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json(errorResponse('No se envió ninguna imagen', 400));
    }

    // Verificar que la novedad existe
    const checkResult = await query(
      'SELECT id FROM public.idon_news WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }

    // Subir a Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { 
          folder: 'idon/news',
          public_id: `news_${id}_${Date.now()}`,
          overwrite: true,
          resource_type: 'image'
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        }
      );
      stream.end(req.file.buffer);
    });

    // Actualizar la URL en la base de datos
    await query(
      'UPDATE public.idon_news SET image_url = $1 WHERE id = $2',
      [result.secure_url, id]
    );

    res.json(successResponse({ image_url: result.secure_url }, 'Imagen subida correctamente'));
  } catch (error) {
    console.error('Error al subir imagen:', error);
    next(error);
  }
});

/**
 * DELETE /api/admin/IdonNews/:id/image
 * Elimina la imagen de una novedad
 */
router.delete('/:id/image', authMiddleware, adminMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verificar que la novedad existe
    const checkResult = await query(
      'SELECT image_url FROM public.idon_news WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json(errorResponse('Novedad no encontrada', 404));
    }

    const current = checkResult.rows[0];
    
    // Si tiene imagen en Cloudinary, eliminarla
    if (current.image_url) {
      try {
        const publicId = current.image_url.split('/').slice(-2).join('/').split('.')[0];
        await cloudinary.uploader.destroy(`idon/news/${publicId}`);
      } catch (cloudinaryError) {
        console.warn('Error al eliminar imagen de Cloudinary:', cloudinaryError);
      }
    }

    // Limpiar la URL en la base de datos
    await query(
      'UPDATE public.idon_news SET image_url = NULL WHERE id = $1',
      [id]
    );

    res.json(successResponse(null, 'Imagen eliminada correctamente'));
  } catch (error) {
    console.error('Error al eliminar imagen:', error);
    next(error);
  }
});

export default router;