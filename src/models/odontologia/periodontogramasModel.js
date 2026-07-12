// src/models/odontologia/periodontogramasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      teeth,
      patient_info,
      notas,
      fase,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".periodontogramas
    WHERE deleted_at IS NULL
    ORDER BY patient_id
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
      patient_id,
      teeth,
      patient_info,
      notas,
      fase,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".periodontogramas
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const findByPatientId = async (schema, patientId) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      teeth,
      patient_info,
      notas,
      fase,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".periodontogramas
    WHERE patient_id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [patientId]);
  return rows[0] || null;
};

// ============================================================
// OBTENER POR PACIENTE Y FASE
// ============================================================
export const findByPatientIdAndFase = async (schema, patientId, fase) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      teeth,
      patient_info,
      notas,
      fase,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".periodontogramas
    WHERE patient_id = $1 AND fase = $2 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [patientId, fase]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".periodontogramas (
      patient_id,
      teeth,
      patient_info,
      notas,
      fase,
      last_saved_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.patient_id,
    data.teeth || {},
    data.patient_info || {},
    data.notas || '',
    data.fase || 'inicial',
    new Date().toISOString()
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

  const fields = ['teeth', 'patient_info', 'notas', 'fase', 'last_saved_at'];

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
    UPDATE "${schema}".periodontogramas 
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
    UPDATE "${schema}".periodontogramas 
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
      COUNT(CASE WHEN fase = 'inicial' THEN 1 END) AS iniciales,
      COUNT(CASE WHEN fase = 'seguimiento' THEN 1 END) AS seguimientos,
      COUNT(CASE WHEN fase = 'alta' THEN 1 END) AS altas,
      COUNT(DISTINCT patient_id) AS pacientes_unicos
    FROM "${schema}".periodontogramas
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    iniciales: Number(rows[0]?.iniciales || 0),
    seguimientos: Number(rows[0]?.seguimientos || 0),
    altas: Number(rows[0]?.altas || 0),
    pacientes_unicos: Number(rows[0]?.pacientes_unicos || 0),
  };
};