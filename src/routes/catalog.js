import express from 'express';
import { query } from '../config/database.js';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all business types
router.get('/business-types', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, name, description FROM public.business_types
       WHERE is_active = true ORDER BY code ASC`
    );

    res.json(successResponse(result.rows, 'Business types fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Get modules available for a business type
router.get('/business-types/:typeId/modules', async (req, res, next) => {
  try {
    const { typeId } = req.params;

    const result = await query(
      `SELECT m.id, m.code, m.name, m.description, m.price_monthly, m.price_annual, m.icon, m.sort_order,
              btm.is_required, btm.is_default
       FROM public.business_type_modules btm
       JOIN public.modules m ON btm.module_id = m.id
       WHERE btm.business_type_id = $1 AND m.is_active = true
       ORDER BY m.sort_order ASC`,
      [typeId]
    );

    // Get features for each module
    const modules = await Promise.all(
      result.rows.map(async (module) => {
        const featuresResult = await query(
          `SELECT id, code, name, description, is_premium
           FROM public.features
           WHERE module_id = $1 AND is_active = true`,
          [module.id]
        );

        return {
          ...module,
          features: featuresResult.rows,
        };
      })
    );

    res.json(successResponse(modules, 'Modules fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Get all modules (for admin/catalog)
router.get('/modules', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT id, code, name, description, price_monthly, price_annual, icon, sort_order
       FROM public.modules
       WHERE is_active = true
       ORDER BY sort_order ASC`
    );

    res.json(successResponse(result.rows, 'Modules fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Get module pages with details
router.get('/modules/:moduleId/pages', async (req, res, next) => {
  try {
    const { moduleId } = req.params;

    const result = await query(
      `SELECT id, code, name, route_path, icon, sort_order, required_feature_id
       FROM public.module_pages
       WHERE module_id = $1 AND is_active = true
       ORDER BY sort_order ASC`,
      [moduleId]
    );

    res.json(successResponse(result.rows, 'Module pages fetched successfully'));
  } catch (error) {
    next(error);
  }
});

export default router;
