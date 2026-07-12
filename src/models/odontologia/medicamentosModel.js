// models/odontologia/medicamentosModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS LOS MEDICAMENTOS CON TIPO Y CATEGORÍA
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      m.id,
      m.nombre,
      m.descripcion,
      m.presentacion,
      m.dosis_recomendada,
      m.frecuencia_recomendada,
      m.contraindicaciones,
      m.tipo_id,
      t.nombre AS tipo_nombre,
      m.categoria_id,
      c.nombre AS categoria_nombre,
      m.created_at,
      m.updated_at
    FROM "${schema}".medicamentos m
    LEFT JOIN "${schema}".tipos_medicamento t ON m.tipo_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".categorias_medicamento c ON m.categoria_id = c.id AND c.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
    ORDER BY m.nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// FILTRAR MEDICAMENTOS POR TIPO Y CATEGORÍA
// ============================================================
export const findByTipoCategoria = async (schema, tipoId, categoriaId) => {
  const sql = `
    SELECT 
      m.id,
      m.nombre,
      m.descripcion,
      m.presentacion,
      m.dosis_recomendada,
      m.frecuencia_recomendada,
      m.contraindicaciones,
      m.tipo_id,
      t.nombre AS tipo_nombre,
      m.categoria_id,
      c.nombre AS categoria_nombre
    FROM "${schema}".medicamentos m
    LEFT JOIN "${schema}".tipos_medicamento t ON m.tipo_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".categorias_medicamento c ON m.categoria_id = c.id AND c.deleted_at IS NULL
    WHERE m.deleted_at IS NULL
      AND ($1::UUID IS NULL OR m.tipo_id = $1)
      AND ($2::UUID IS NULL OR m.categoria_id = $2)
    ORDER BY m.nombre ASC
  `;
  const { rows } = await query(sql, [tipoId, categoriaId]);
  return rows;
};

// ============================================================
// OBTENER MEDICAMENTO POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      m.id,
      m.nombre,
      m.descripcion,
      m.presentacion,
      m.dosis_recomendada,
      m.frecuencia_recomendada,
      m.contraindicaciones,
      m.tipo_id,
      t.nombre AS tipo_nombre,
      m.categoria_id,
      c.nombre AS categoria_nombre
    FROM "${schema}".medicamentos m
    LEFT JOIN "${schema}".tipos_medicamento t ON m.tipo_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".categorias_medicamento c ON m.categoria_id = c.id AND c.deleted_at IS NULL
    WHERE m.id = $1 AND m.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CREAR MEDICAMENTO
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".medicamentos (
      nombre,
      descripcion,
      presentacion,
      dosis_recomendada,
      frecuencia_recomendada,
      contraindicaciones,
      tipo_id,
      categoria_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.nombre,
    data.descripcion || null,
    data.presentacion || null,
    data.dosis_recomendada || null,
    data.frecuencia_recomendada || null,
    data.contraindicaciones || null,
    data.tipo_id,
    data.categoria_id
  ]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR MEDICAMENTO
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'nombre', 'descripcion', 'presentacion',
    'dosis_recomendada', 'frecuencia_recomendada',
    'contraindicaciones', 'tipo_id', 'categoria_id'
  ];

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
    UPDATE "${schema}".medicamentos 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR MEDICAMENTO (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  // Verificar si está siendo usado en plantillas
  const checkSql = `
    SELECT COUNT(*) AS count FROM "${schema}".plantilla_medicamentos
    WHERE medicamento_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar el medicamento porque está siendo usado en plantillas');
  }

  const sql = `
    UPDATE "${schema}".medicamentos 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};