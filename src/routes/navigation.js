// src/routes/navigation.js

import express from 'express';
import {
  getNavigationMenu,
  getBusinessInfo,
  getBusinessModules,
  getBusinessModulesWithFeatures
} from '../services/navigationService.js';
import { getNavigationMenuLevel3Controller } from '../controllers/navigationController.js';
import { successResponse, errorResponse } from '../utils/response.js';

const router = express.Router();

// Menú estándar (nivel 2)
router.get('/', async (req, res, next) => {
  try {
    const { businessId, userId } = req.user;
    if (!businessId || !userId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }
    const menu = await getNavigationMenu(businessId, userId);
    res.json(successResponse(menu, 'Navigation menu fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Menú nivel 3 (schema + permissions)
router.get('/menu-level3', getNavigationMenuLevel3Controller);

// Business info
router.get('/business/info', async (req, res, next) => {
  try {
    const { businessId } = req.user;
    if (!businessId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }
    const businessInfo = await getBusinessInfo(businessId);
    res.json(successResponse(businessInfo, 'Business info fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Business modules
router.get('/business/modules', async (req, res, next) => {
  try {
    const { businessId } = req.user;
    if (!businessId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }
    const modules = await getBusinessModules(businessId);
    res.json(successResponse(modules, 'Business modules fetched successfully'));
  } catch (error) {
    next(error);
  }
});

// Business modules with features
router.get('/business/modules-features', async (req, res, next) => {
  try {
    const { businessId } = req.user;
    if (!businessId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }
    const modules = await getBusinessModulesWithFeatures(businessId);
    res.json(successResponse(modules, 'Business modules with features fetched successfully'));
  } catch (error) {
    next(error);
  }
});

export default router;