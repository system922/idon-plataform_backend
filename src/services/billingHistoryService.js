// Para Postgres
import { query } from '../config/database.js';
export const getList = async () => {
  const { rows } = await query(`
    SELECT bh.*, b.name as business_name, s.billing_period
      FROM public.billing_history bh
      LEFT JOIN public.subscriptions s ON bh.subscription_id = s.id
      LEFT JOIN public.businesses b    ON s.business_id = b.id
    ORDER BY bh.billing_date DESC, bh.created_at DESC
  `);
  return rows;
};