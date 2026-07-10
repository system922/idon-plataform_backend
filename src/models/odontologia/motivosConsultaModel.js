// src/models/odontologia/motivosConsultaModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT * FROM "${schema}".motivos_consulta
    WHERE deleted_at IS NULL
    ORDER BY nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT * FROM "${schema}".motivos_consulta
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".motivos_consulta (
      nombre, duracion, color, is_active
    ) VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.duracion || 30,
    data.color || '#10b981',
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
  if (data.duracion !== undefined) {
    updates.push(`duracion = $${idx++}`);
    values.push(data.duracion);
  }
  if (data.color !== undefined) {
    updates.push(`color = $${idx++}`);
    values.push(data.color);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) return findById(schema, id);

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".motivos_consulta
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
  const sql = `
    UPDATE "${schema}".motivos_consulta
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};