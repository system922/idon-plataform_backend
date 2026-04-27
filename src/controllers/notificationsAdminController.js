import { findBusinessRegistrationRequests } from '../models/NotificationAdminModel.js';
import { successResponse, errorResponse } from '../utils/response.js';

/**
 * Controlador: Obtener notificaciones para admin
 */
export async function getAdminNotificationsController(req, res, next) {
  try {
    const filterType = req.query.filterType || 'all';
    const notifications = await findBusinessRegistrationRequests(filterType);
    res.json(successResponse(notifications, 'Admin notifications fetched successfully'));
  } catch (error) {
    next(error);
  }
}
