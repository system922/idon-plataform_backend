// models/odontologia/tiposCategoriasModel.js
import { query } from '../../config/database.js';

// ============================================================
// TIPOS DE MEDICAMENTO
// ============================================================

// LISTAR TIPOS
export const findAllTipos = async (schema) => {
  const sql = `
    SELECT 
      id,
      nombre,
      descripcion,
      created_at,
      updated_at
    FROM "${schema}".tipos_medicamento
    WHERE deleted_at IS NULL
    ORDER BY nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// OBTENER TIPO POR ID
export const findTipoById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      nombre,
      descripcion,
      created_at,
      updated_at
    FROM "${schema}".tipos_medicamento
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// CREAR TIPO
export const insertTipo = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".tipos_medicamento (
      nombre,
      descripcion
    ) VALUES ($1, $2)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.descripcion || null
  ]);
  return rows[0] || null;
};

// ACTUALIZAR TIPO
export const updateTipoById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.nombre !== undefined) {
    updates.push(`nombre = $${idx++}`);
    values.push(data.nombre);
  }
  if (data.descripcion !== undefined) {
    updates.push(`descripcion = $${idx++}`);
    values.push(data.descripcion);
  }

  if (updates.length === 0) {
    return findTipoById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".tipos_medicamento 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ELIMINAR TIPO (SOFT DELETE) - Verificar si tiene medicamentos asociados
export const softDeleteTipo = async (schema, id) => {
  // Verificar si hay medicamentos usando este tipo
  const checkSql = `
    SELECT COUNT(*) AS count FROM "${schema}".medicamentos
    WHERE tipo_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar el tipo porque tiene medicamentos asociados');
  }

  const sql = `
    UPDATE "${schema}".tipos_medicamento 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CATEGORÍAS DE MEDICAMENTO
// ============================================================

// LISTAR CATEGORÍAS
export const findAllCategorias = async (schema) => {
  const sql = `
    SELECT 
      id,
      nombre,
      descripcion,
      created_at,
      updated_at
    FROM "${schema}".categorias_medicamento
    WHERE deleted_at IS NULL
    ORDER BY nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// OBTENER CATEGORÍA POR ID
export const findCategoriaById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      nombre,
      descripcion,
      created_at,
      updated_at
    FROM "${schema}".categorias_medicamento
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// CREAR CATEGORÍA
export const insertCategoria = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".categorias_medicamento (
      nombre,
      descripcion
    ) VALUES ($1, $2)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.descripcion || null
  ]);
  return rows[0] || null;
};

// ACTUALIZAR CATEGORÍA
export const updateCategoriaById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.nombre !== undefined) {
    updates.push(`nombre = $${idx++}`);
    values.push(data.nombre);
  }
  if (data.descripcion !== undefined) {
    updates.push(`descripcion = $${idx++}`);
    values.push(data.descripcion);
  }

  if (updates.length === 0) {
    return findCategoriaById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".categorias_medicamento 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ELIMINAR CATEGORÍA (SOFT DELETE) - Verificar si tiene medicamentos asociados
export const softDeleteCategoria = async (schema, id) => {
  // Verificar si hay medicamentos usando esta categoría
  const checkSql = `
    SELECT COUNT(*) AS count FROM "${schema}".medicamentos
    WHERE categoria_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar la categoría porque tiene medicamentos asociados');
  }

  const sql = `
    UPDATE "${schema}".categorias_medicamento 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};