// src/controllers/navigationController.js

import { getNavigationMenuLevel3, getBusinessInfo } from '../services/navigationService.js';
import { successResponse, errorResponse } from '../utils/response.js';

// GET /api/navigation/menu-level3
export const getNavigationMenuLevel3Controller = async (req, res, next) => {
  try {
    // Preferir siempre obtener del JWT, pero permitir fallback por headers
    const { businessId, userId, schemaName } = req.user;
    const schema = schemaName || req.headers['x-db-name'];

    if (!businessId || !userId) {
      return res.status(401).json(errorResponse('User context required', 401));
    }
    if (!schema) {
      return res.status(400).json(errorResponse('Schema (X-DB-Name) required', 400));
    }

    // Obtener menú nivel 3
    const menu = await getNavigationMenuLevel3(businessId, userId, schema);

    // INCLUIR SIEMPRE info de negocio en la respuesta:
    let businessInfo = {};
    try {
      businessInfo = await getBusinessInfo(businessId);
    } catch (e) {
      // No lanzar, solo dejar vacío si ocurre error
    }

    // Adherir la info de negocio para FE
    const resp = {
      ...menu,
      business: businessInfo 
        ? { id: businessInfo.id, name: businessInfo.name, slug: businessInfo.slug }
        : { id: businessId }
    };

    res.json(successResponse(resp, 'Navigation menu for level 3 fetched successfully'));
  } catch (error) {
    next(error);
  }
};