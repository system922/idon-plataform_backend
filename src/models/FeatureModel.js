import { query } from '../config/database.js';

export async function findAllFeatures() {
  // Traer también el nombre del módulo asociado
  const result = await query(`
    SELECT f.*, m.name AS module_name
    FROM public.features f
    JOIN public.modules m ON f.module_id = m.id
    ORDER BY f.name
  `);
  return result.rows;
}

export async function findFeatureById(id) {
  const result = await query('SELECT * FROM public.features WHERE id = $1', [id]);
  return result.rows[0];
}

export async function createFeature(data) {
  const { code, name, description, is_active } = data;
  const result = await query(
    `INSERT INTO public.features (code, name, description, is_active)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [code, name, description, is_active]
  );
  return result.rows[0];
}

export async function updateFeature(id, data) {
  const { code, name, description, is_active } = data;
  const result = await query(
    `UPDATE public.features SET code=$2, name=$3, description=$4, is_active=$5 WHERE id=$1 RETURNING *`,
    [id, code, name, description, is_active]
  );
  return result.rows[0];
}

export async function deleteFeature(id) {
  await query('DELETE FROM public.features WHERE id = $1', [id]);
  return true;
}
