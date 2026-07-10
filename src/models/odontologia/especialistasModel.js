// src/models/odontologia/especialistasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id, nombre, especialidad, email, telefono, is_active,
      created_at, updated_at
    FROM "${schema}".especialistas
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
    SELECT * FROM "${schema}".especialistas
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// BUSCAR
// ============================================================
export const search = async (schema, term) => {
  const sql = `
    SELECT id, nombre, especialidad, email, telefono, is_active
    FROM "${schema}".especialistas
    WHERE deleted_at IS NULL
      AND (nombre ILIKE $1 OR especialidad ILIKE $1 OR email ILIKE $1)
    ORDER BY nombre ASC
    LIMIT 20
  `;
  const { rows } = await query(sql, [`%${term}%`]);
  return rows;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".especialistas (
      nombre, especialidad, email, telefono, is_active
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.especialidad,
    data.email || null,
    data.telefono || null,
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

  const fields = ['nombre', 'especialidad', 'email', 'telefono', 'is_active'];
  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(data[field]);
    }
  });

  if (updates.length === 0) return findById(schema, id);

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".especialistas
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
    WHERE especialista_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar el especialista porque tiene agendas asociadas');
  }

  const sql = `
    UPDATE "${schema}".especialistas
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  const sql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN is_active = true THEN 1 END) AS activos,
      COUNT(CASE WHEN is_active = false THEN 1 END) AS inactivos,
      (SELECT COUNT(DISTINCT especialista_id) FROM "${schema}".agendas WHERE deleted_at IS NULL) AS con_agenda
    FROM "${schema}".especialistas
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    activos: Number(rows[0]?.activos || 0),
    inactivos: Number(rows[0]?.inactivos || 0),
    con_agenda: Number(rows[0]?.con_agenda || 0)
  };
};