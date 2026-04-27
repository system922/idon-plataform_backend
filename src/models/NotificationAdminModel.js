import { query } from '../config/database.js';

/**
 * Modelo: Acceso a datos de notificaciones admin
 */
export async function findBusinessRegistrationRequests(filterType = 'all') {
  let where = '';
  if (filterType === 'pending') {
    where = "WHERE status = 'pending'";
  }
  const result = await query(
    `SELECT id, business_name, owner_email, status, requested_at
     FROM public.business_registration_requests
     ${where}
     ORDER BY requested_at DESC`
  );
  return result.rows;
}
