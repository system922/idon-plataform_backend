import express from 'express';
import { query } from '../../config/database.js';
import { successResponse, errorResponse } from '../../utils/response.js';

const router = express.Router();

// ============================================================
// GESTIÓN DE PLANTILLAS POR TIPO DE NEGOCIO
// ============================================================

/**
 * GET /api/admin/templates
 * Obtener todas las plantillas con sus módulos y features
 */
router.get('/templates', async (req, res, next) => {
  try {
    const templatesRes = await query(`
      SELECT t.id, t.name, t.description, t.business_type_id, bt.name as business_type_name,
             t.is_active, t.is_default, t.created_at, t.updated_at
      FROM public.templates t
      LEFT JOIN public.business_types bt ON t.business_type_id = bt.id
      ORDER BY t.created_at DESC
    `);

    const templates = [];
    
    for (const template of templatesRes.rows) {
      // Obtener módulos de la plantilla
      const modulesRes = await query(`
        SELECT tm.id, tm.module_id, m.code, m.name, m.description, 
               m.price_monthly, m.price_annual, m.sort_order,
               tm.is_required
        FROM public.template_modules tm
        JOIN public.modules m ON tm.module_id = m.id
        WHERE tm.template_id = $1
        ORDER BY m.sort_order
      `, [template.id]);
      
      // Obtener features de cada módulo
      const modules = [];
      for (const module of modulesRes.rows) {
        const featuresRes = await query(`
          SELECT tf.id, tf.feature_id, f.code, f.name, f.description, f.is_premium,
                 tf.is_required
          FROM public.template_features tf
          JOIN public.features f ON tf.feature_id = f.id
          WHERE tf.template_id = $1 AND tf.module_id = $2
          ORDER BY f.sort_order
        `, [template.id, module.module_id]);
        
        modules.push({
          ...module,
          features: featuresRes.rows
        });
      }
      
      templates.push({
        ...template,
        modules
      });
    }
    
    res.json(successResponse(templates, 'Plantillas obtenidas'));
  } catch (error) {
    console.error('Error al obtener plantillas:', error);
    next(error);
  }
});

/**
 * GET /api/admin/templates/:id
 * Obtener una plantilla específica
 */
router.get('/templates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const templateRes = await query(`
      SELECT t.*, bt.name as business_type_name
      FROM public.templates t
      LEFT JOIN public.business_types bt ON t.business_type_id = bt.id
      WHERE t.id = $1
    `, [id]);
    
    if (templateRes.rows.length === 0) {
      return res.status(404).json(errorResponse('Plantilla no encontrada', 404));
    }
    
    const template = templateRes.rows[0];
    
    // Obtener módulos de la plantilla
    const modulesRes = await query(`
      SELECT tm.id, tm.module_id, m.code, m.name, m.description, 
             m.price_monthly, m.price_annual, m.sort_order,
             tm.is_required
      FROM public.template_modules tm
      JOIN public.modules m ON tm.module_id = m.id
      WHERE tm.template_id = $1
      ORDER BY m.sort_order
    `, [id]);
    
    const modules = [];
    for (const module of modulesRes.rows) {
      const featuresRes = await query(`
        SELECT tf.id, tf.feature_id, f.code, f.name, f.description, f.is_premium,
               tf.is_required
        FROM public.template_features tf
        JOIN public.features f ON tf.feature_id = f.id
        WHERE tf.template_id = $1 AND tf.module_id = $2
        ORDER BY f.sort_order
      `, [id, module.module_id]);
      
      modules.push({
        ...module,
        features: featuresRes.rows
      });
    }
    
    res.json(successResponse({ ...template, modules }, 'Plantilla obtenida'));
  } catch (error) {
    console.error('Error al obtener plantilla:', error);
    next(error);
  }
});

/**
 * POST /api/admin/templates
 * Crear una nueva plantilla
 */
router.post('/templates', async (req, res, next) => {
  try {
    const { name, description, business_type_id, is_default, modules } = req.body;
    
    if (!name || !business_type_id) {
      return res.status(400).json(errorResponse('Nombre y tipo de negocio son requeridos', 400));
    }
    
    // Iniciar transacción
    await query('BEGIN');
    
    // Si es plantilla por defecto, desactivar otras del mismo tipo
    if (is_default) {
      await query(`
        UPDATE public.templates SET is_default = false 
        WHERE business_type_id = $1
      `, [business_type_id]);
    }
    
    // Crear plantilla
    const templateRes = await query(`
      INSERT INTO public.templates (name, description, business_type_id, is_default, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id
    `, [name, description || '', business_type_id, is_default || false]);
    
    const templateId = templateRes.rows[0].id;
    
    // Agregar módulos a la plantilla
    if (modules && modules.length > 0) {
      for (const module of modules) {
        await query(`
          INSERT INTO public.template_modules (template_id, module_id, is_required)
          VALUES ($1, $2, $3)
        `, [templateId, module.module_id, module.is_required || false]);
        
        // Agregar features del módulo
        if (module.features && module.features.length > 0) {
          for (const feature of module.features) {
            await query(`
              INSERT INTO public.template_features (template_id, module_id, feature_id, is_required)
              VALUES ($1, $2, $3, $4)
            `, [templateId, module.module_id, feature.feature_id, feature.is_required || false]);
          }
        }
      }
    }
    
    await query('COMMIT');
    
    res.json(successResponse({ id: templateId }, 'Plantilla creada exitosamente'));
  } catch (error) {
    await query('ROLLBACK');
    console.error('Error al crear plantilla:', error);
    next(error);
  }
});

/**
 * PUT /api/admin/templates/:id
 * Actualizar una plantilla
 */
router.put('/templates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, business_type_id, is_default, modules } = req.body;
    
    // Verificar si existe
    const existingRes = await query('SELECT id FROM public.templates WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json(errorResponse('Plantilla no encontrada', 404));
    }
    
    await query('BEGIN');
    
    // Si es plantilla por defecto, desactivar otras del mismo tipo
    if (is_default) {
      await query(`
        UPDATE public.templates SET is_default = false 
        WHERE business_type_id = $1 AND id != $2
      `, [business_type_id, id]);
    }
    
    // Actualizar plantilla
    await query(`
      UPDATE public.templates 
      SET name = $1, description = $2, business_type_id = $3, is_default = $4, updated_at = NOW()
      WHERE id = $5
    `, [name, description || '', business_type_id, is_default || false, id]);
    
    // Eliminar módulos y features existentes
    await query('DELETE FROM public.template_features WHERE template_id = $1', [id]);
    await query('DELETE FROM public.template_modules WHERE template_id = $1', [id]);
    
    // Agregar nuevos módulos
    if (modules && modules.length > 0) {
      for (const module of modules) {
        await query(`
          INSERT INTO public.template_modules (template_id, module_id, is_required)
          VALUES ($1, $2, $3)
        `, [id, module.module_id, module.is_required || false]);
        
        if (module.features && module.features.length > 0) {
          for (const feature of module.features) {
            await query(`
              INSERT INTO public.template_features (template_id, module_id, feature_id, is_required)
              VALUES ($1, $2, $3, $4)
            `, [id, module.module_id, feature.feature_id, feature.is_required || false]);
          }
        }
      }
    }
    
    await query('COMMIT');
    
    res.json(successResponse(null, 'Plantilla actualizada exitosamente'));
  } catch (error) {
    await query('ROLLBACK');
    console.error('Error al actualizar plantilla:', error);
    next(error);
  }
});

/**
 * DELETE /api/admin/templates/:id
 * Eliminar una plantilla
 */
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const existingRes = await query('SELECT id FROM public.templates WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json(errorResponse('Plantilla no encontrada', 404));
    }
    
    await query('BEGIN');
    await query('DELETE FROM public.template_features WHERE template_id = $1', [id]);
    await query('DELETE FROM public.template_modules WHERE template_id = $1', [id]);
    await query('DELETE FROM public.templates WHERE id = $1', [id]);
    await query('COMMIT');
    
    res.json(successResponse(null, 'Plantilla eliminada exitosamente'));
  } catch (error) {
    await query('ROLLBACK');
    console.error('Error al eliminar plantilla:', error);
    next(error);
  }
});

/**
 * GET /api/admin/templates/by-business-type/:businessTypeId
 * Obtener plantilla por tipo de negocio (para mostrar al cliente)
 */
router.get('/templates/by-business-type/:businessTypeId', async (req, res, next) => {
  try {
    const { businessTypeId } = req.params;
    
    // Obtener plantilla activa para este tipo de negocio
    const templateRes = await query(`
      SELECT t.id, t.name, t.description, t.business_type_id
      FROM public.templates t
      WHERE t.business_type_id = $1 AND t.is_active = true
      ORDER BY t.is_default DESC
      LIMIT 1
    `, [businessTypeId]);
    
    if (templateRes.rows.length === 0) {
      return res.json(successResponse(null, 'No hay plantilla para este tipo de negocio'));
    }
    
    const template = templateRes.rows[0];
    
    // Obtener módulos sugeridos
    const modulesRes = await query(`
      SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual,
             tm.is_required
      FROM public.template_modules tm
      JOIN public.modules m ON tm.module_id = m.id
      WHERE tm.template_id = $1
      ORDER BY m.sort_order
    `, [template.id]);
    
    const modules = [];
    for (const module of modulesRes.rows) {
      const featuresRes = await query(`
        SELECT f.id, f.code, f.name, f.description, f.is_premium,
               tf.is_required
        FROM public.template_features tf
        JOIN public.features f ON tf.feature_id = f.id
        WHERE tf.template_id = $1 AND tf.module_id = $2
        ORDER BY f.sort_order
      `, [template.id, module.id]);
      
      modules.push({
        ...module,
        features: featuresRes.rows,
        is_suggested: true,
        is_required: module.is_required
      });
    }
    
    res.json(successResponse({
      template_id: template.id,
      template_name: template.name,
      modules: modules
    }, 'Plantilla obtenida'));
  } catch (error) {
    console.error('Error al obtener plantilla por tipo:', error);
    next(error);
  }
});

export default router;