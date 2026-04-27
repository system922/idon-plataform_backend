import { query } from '../config/database.js';

// Devuelve la lista de pagos y suscripciones de negocios para el panel admin
export async function getAllAdminPayments() {
  // Puedes ajustar los campos y joins según tu modelo de datos
  const result = await query(`
    SELECT b.id as business_id, b.name as business_name, b.slug, b.is_active as business_active,
           bt.name as business_type, u.email as owner_email, u.first_name || ' ' || u.last_name as owner_name,
           s.id as sub_id, s.status as sub_status, s.billing_period, s.next_billing_at, s.last_paid_at,
           s.total_amount, s.discount_percentage
    FROM public.businesses b
    LEFT JOIN public.business_types bt ON b.business_type_id = bt.id
    LEFT JOIN public.users u ON b.owner_id = u.id
    LEFT JOIN public.subscriptions s ON s.business_id = b.id AND s.is_active = TRUE
    ORDER BY b.name
  `);
  return result.rows;
}
