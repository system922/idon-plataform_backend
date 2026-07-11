import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id,
      name,
      description,
      duration_minutes,
      price,
      color,
      is_active,
      created_at,
      updated_at
    FROM "${schema}".tratamientos
    WHERE deleted_at IS NULL
    ORDER BY name ASC
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
      id,
      name,
      description,
      duration_minutes,
      price,
      color,
      is_active,
      created_at,
      updated_at
    FROM "${schema}".tratamientos
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// BUSCAR POR TÉRMINO
// ============================================================
export const search = async (schema, searchTerm) => {
  const sql = `
    SELECT 
      id,
      name,
      description,
      duration_minutes,
      price,
      color,
      is_active
    FROM "${schema}".tratamientos
    WHERE deleted_at IS NULL
      AND (
        name ILIKE $1
        OR description ILIKE $1
      )
    ORDER BY name ASC
    LIMIT 20
  `;
  const { rows } = await query(sql, [`%${searchTerm}%`]);
  return rows;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".tratamientos (
      name,
      description,
      duration_minutes,
      price,
      color,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.name,
    data.description || null,
    data.duration_minutes || 30,
    data.price || 0,
    data.color || '#3b82f6',
    data.is_active !== undefined ? data.is_active : true,
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

  const fields = ['name', 'description', 'duration_minutes', 'price', 'color', 'is_active'];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(data[field]);
    }
  });

  if (updates.length === 0) {
    return findById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".tratamientos 
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
    UPDATE "${schema}".tratamientos 
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
      AVG(duration_minutes) AS duracion_promedio,
      AVG(price) AS precio_promedio,
      MAX(price) AS precio_maximo,
      MIN(price) AS precio_minimo
    FROM "${schema}".tratamientos
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    activos: Number(rows[0]?.activos || 0),
    inactivos: Number(rows[0]?.inactivos || 0),
    duracion_promedio: Math.round(Number(rows[0]?.duracion_promedio || 0)),
    precio_promedio: Number(rows[0]?.precio_promedio || 0),
    precio_maximo: Number(rows[0]?.precio_maximo || 0),
    precio_minimo: Number(rows[0]?.precio_minimo || 0),
  };
};