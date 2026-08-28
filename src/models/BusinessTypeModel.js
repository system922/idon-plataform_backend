import { query } from '../config/database.js';

export async function findAllBusinessTypes() {
  const result = await query('SELECT * FROM public.business_types ORDER BY name');
  return result.rows;
}

export async function findBusinessTypeById(id) {
  const result = await query('SELECT * FROM public.business_types WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createBusinessType(data) {
  const { code, name, description, is_active } = data;
  const result = await query(
    `INSERT INTO public.business_types (code, name, description, is_active)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [code, name, description, is_active]
  );
  return result.rows[0];
}

export async function updateBusinessType(id, data) {
  const { code, name, description, is_active } = data;
  const result = await query(
    `UPDATE public.business_types SET code=$2, name=$3, description=$4, is_active=$5 WHERE id=$1 RETURNING *`,
    [id, code, name, description, is_active]
  );
  return result.rows[0];
}

export async function deleteBusinessType(id) {
  await query('DELETE FROM public.business_types WHERE id = $1', [id]);
  return true;
}
