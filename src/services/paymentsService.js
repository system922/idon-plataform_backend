import { query } from '../config/database.js';

export const getPayments = async () => {
  // Esto junta negocios, dueños y suscripción activa (si la hay)
  const { rows } = await query(`
    SELECT
      b.id as business_id,
      b.slug,
      b.name as business_name,
      bt.name as business_type,
      b.is_active as business_active,
      o.first_name || ' ' || o.last_name as owner_name,
      o.email as owner_email,
      s.id as sub_id,
      s.status as sub_status,
      s.billing_period,
      s.amount_monthly,
      s.amount_annual,
      s.total_amount,
      s.discount_percentage,
      s.next_billing_at,
      s.activated_at,
      s.suspended_at,
      (SELECT MAX(bh.billing_date)
         FROM public.billing_history bh
        WHERE bh.subscription_id = s.id AND bh.status='paid'
      ) as last_paid_at
    FROM public.businesses b
    LEFT JOIN public.business_types bt ON b.business_type_id=bt.id
    LEFT JOIN public.business_users bu ON bu.business_id = b.id AND bu.is_owner = TRUE
    LEFT JOIN public.business_owners o ON bu.user_id = o.user_id
    LEFT JOIN public.subscriptions s ON s.business_id = b.id
    ORDER BY b.created_at DESC
  `);
  return rows;
};