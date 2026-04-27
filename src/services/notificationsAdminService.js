import { query } from '../config/database.js';

/**
 * Obtiene notificaciones para el admin IDON
 * @param {string} filterType - 'pending', 'all', etc.
 * @returns {Promise<Array>} Lista de notificaciones
 */
export async function getAdminNotifications(filterType = 'all') {
  let where = '';
  if (filterType === 'pending') {
    where = "WHERE status = 'pending'";
  }
  // Puedes agregar más filtros según tu modelo

  // Ejemplo: notificaciones de solicitudes de registro de negocios
  const result = await query(
    `SELECT id, business_name, owner_email, status, requested_at
     FROM public.business_registration_requests
     ${where}
     ORDER BY requested_at DESC`
  );

  // Puedes mapear a un formato más amigable si lo deseas
  return result.rows;
}
