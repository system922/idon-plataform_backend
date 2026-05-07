/**
 * public.js
 * Rutas públicas (sin autenticación) para clientes
 */

import express from 'express';
import { query } from '../config/database.js';

const router = express.Router();

/**
 * GET /api/public/business-types
 * Obtener todos los tipos de negocio disponibles (público)
 */
router.get('/business-types', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, name, slug, description, icon
       FROM public.business_types
       WHERE is_active = true
       ORDER BY name`
    );
    
    res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al obtener tipos de negocio:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/templates/by-business-type/:businessTypeId
 * Obtener la plantilla de módulos para un tipo de negocio específico (público)
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
      return res.json({
        ok: true,
        data: null,
        message: 'No hay plantilla para este tipo de negocio'
      });
    }
    
    const template = templateRes.rows[0];
    
    // Obtener módulos sugeridos
    const modulesRes = await query(`
      SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual,
             tm.is_required
      FROM public.template_modules tm
      JOIN public.modules m ON tm.module_id = m.id
      WHERE tm.template_id = $1 AND m.is_active = true
      ORDER BY m.sort_order
    `, [template.id]);
    
    const modules = [];
    for (const module of modulesRes.rows) {
      const featuresRes = await query(`
        SELECT f.id, f.code, f.name, f.description, f.is_premium,
               tf.is_required
        FROM public.template_features tf
        JOIN public.features f ON tf.feature_id = f.id
        WHERE tf.template_id = $1 AND tf.module_id = $2 AND f.is_active = true
        ORDER BY f.sort_order
      `, [template.id, module.id]);
      
      modules.push({
        ...module,
        features: featuresRes.rows,
        is_suggested: true
      });
    }
    
    res.json({
      ok: true,
      data: {
        template_id: template.id,
        template_name: template.name,
        modules: modules
      }
    });
  } catch (error) {
    console.error('Error al obtener plantilla por tipo:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * GET /api/public/modules
 * Obtener todos los módulos disponibles (público)
 */
router.get('/modules', async (req, res, next) => {
  try {
    const result = await query(`
      SELECT m.id, m.code, m.name, m.description, 
             m.price_monthly, m.price_annual, m.sort_order,
             (SELECT json_agg(
                json_build_object(
                  'id', f.id,
                  'code', f.code,
                  'name', f.name,
                  'description', f.description,
                  'is_premium', f.is_premium
                )
              ) FROM public.features f 
              WHERE f.module_id = m.id AND f.is_active = true
              ORDER BY f.sort_order
             ) as features
      FROM public.modules m
      WHERE m.is_active = true
      ORDER BY m.sort_order
    `);
    
    res.json({
      ok: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error al obtener módulos:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default router;