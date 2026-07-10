// src/models/odontologia/gruposAgendasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      g.*,
      (SELECT COUNT(*) FROM "${schema}".agendas WHERE grupo_id = g.id AND deleted_at IS NULL) AS total_agendas
    FROM "${schema}".grupos_agendas g
    WHERE g.deleted_at IS NULL
    ORDER BY g.nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      g.*,
      (SELECT COUNT(*) FROM "${schema}".agendas WHERE grupo_id = g.id AND deleted_at IS NULL) AS total_agendas
    FROM "${schema}".grupos_agendas g
    WHERE g.id = $1 AND g.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".grupos_agendas (
      nombre, descripcion, is_active
    ) VALUES ($1, $2, $3)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.descripcion || null,
    data.is_active !== undefined ? data.is_active : true
  ]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.nombre !== undefined) {
    updates.push(`nombre = $${idx++}`);
    values.push(data.nombre);
  }
  if (data.descripcion !== undefined) {
    updates.push(`descripcion = $${idx++}`);
    values.push(data.descripcion || null);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) return findById(schema, id);

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".grupos_agendas
    SET ${updates.join(', ')}
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  // Verificar si tiene agendas asociadas
  const checkSql = `
    SELECT COUNT(*) AS count FROM "${schema}".agendas
    WHERE grupo_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar el grupo porque tiene agendas asociadas');
  }

  const sql = `
    UPDATE "${schema}".grupos_agendas
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};