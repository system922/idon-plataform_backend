import { query } from '../config/database.js';

export async function findAllModules() {
  const result = await query('SELECT * FROM public.modules ORDER BY sort_order, name');
  return result.rows;
}

export async function findModuleById(id) {
  const result = await query('SELECT * FROM public.modules WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createModule(data) {
  const { code, name, icon, sort_order, price_monthly, price_annual, is_active } = data;
  const result = await query(
    `INSERT INTO public.modules (code, name, icon, sort_order, price_monthly, price_annual, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [code, name, icon, sort_order, price_monthly, price_annual, is_active]
  );
  return result.rows[0];
}

export async function updateModule(id, data) {
  const { code, name, icon, sort_order, price_monthly, price_annual, is_active } = data;
  const result = await query(
    `UPDATE public.modules SET code=$2, name=$3, icon=$4, sort_order=$5, price_monthly=$6, price_annual=$7, is_active=$8 WHERE id=$1 RETURNING *`,
    [id, code, name, icon, sort_order, price_monthly, price_annual, is_active]
  );
  return result.rows[0];
}

export async function deleteModule(id) {
  await query('DELETE FROM public.modules WHERE id = $1', [id]);
  return true;
}
