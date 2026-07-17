import { query } from '../../config/database.js';

// ============================================================
// OBTENER FOTOS POR ORTODONCIA_ID
// ============================================================
export const findByOrtodonciaId = async (schema, ortodonciaId) => {
  const sql = `
    SELECT 
      id,
      ortodoncia_id,
      nombre_archivo,
      image_url,
      created_at,
      updated_at
    FROM "${schema}".ortodoncia_fotografias
    WHERE ortodoncia_id = $1 AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  const { rows } = await query(sql, [ortodonciaId]);
  return rows;
};

// ============================================================
// INSERTAR FOTO
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".ortodoncia_fotografias (
      ortodoncia_id,
      nombre_archivo,
      image_url
    ) VALUES ($1, $2, $3)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.ortodoncia_id,
    data.nombre_archivo || 'foto',
    data.image_url,
  ]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR FOTO POR URL (para actualización)
// ============================================================
export const deleteByOrtodonciaId = async (schema, ortodonciaId, imageUrl) => {
  const sql = `
    UPDATE "${schema}".ortodoncia_fotografias
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE ortodoncia_id = $1 AND image_url = $2 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [ortodonciaId, imageUrl]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR TODAS LAS FOTOS DE UNA ORTODONCIA
// ============================================================
export const deleteAllByOrtodonciaId = async (schema, ortodonciaId) => {
  const sql = `
    UPDATE "${schema}".ortodoncia_fotografias
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE ortodoncia_id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [ortodonciaId]);
  return rows;
};