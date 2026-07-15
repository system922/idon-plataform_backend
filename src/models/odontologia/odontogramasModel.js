// src/models/odontologia/odontogramasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".odontogramas
    WHERE deleted_at IS NULL
    ORDER BY patient_id, fase
  `;
  const { rows } = await query(sql);
  // ✅ Asegurar que plan_tratamiento sea array
  return rows.map(row => ({
    ...row,
    plan_tratamiento: Array.isArray(row.plan_tratamiento) ? row.plan_tratamiento : []
  }));
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".odontogramas
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  if (rows[0]) {
    // ✅ Asegurar que plan_tratamiento sea array
    rows[0].plan_tratamiento = Array.isArray(rows[0].plan_tratamiento) ? rows[0].plan_tratamiento : [];
  }
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
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".odontogramas
    WHERE patient_id = $1 AND deleted_at IS NULL
    ORDER BY fase
  `;
  const { rows } = await query(sql, [patientId]);
  // ✅ Asegurar que plan_tratamiento sea array
  return rows.map(row => ({
    ...row,
    plan_tratamiento: Array.isArray(row.plan_tratamiento) ? row.plan_tratamiento : []
  }));
};

// ============================================================
// OBTENER POR PACIENTE Y FASE
// ============================================================
export const findByPatientAndFase = async (schema, patientId, fase) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".odontogramas
    WHERE patient_id = $1 AND fase = $2 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [patientId, fase]);
  if (rows[0]) {
    // ✅ Asegurar que plan_tratamiento sea array
    rows[0].plan_tratamiento = Array.isArray(rows[0].plan_tratamiento) ? rows[0].plan_tratamiento : [];
  }
  return rows[0] || null;
};

// ============================================================
// OBTENER POR PLAN DE TRATAMIENTO
// ============================================================
export const findByPlanId = async (schema, planId) => {
  const sql = `
    SELECT 
      id,
      patient_id,
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at,
      created_at,
      updated_at
    FROM "${schema}".odontogramas
    WHERE plan_id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [planId]);
  if (rows[0]) {
    rows[0].plan_tratamiento = Array.isArray(rows[0].plan_tratamiento) ? rows[0].plan_tratamiento : [];
  }
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  // ✅ Asegurar que plan_tratamiento sea un array
  const planTratamiento = Array.isArray(data.plan_tratamiento) 
    ? data.plan_tratamiento 
    : [];

  const sql = `
    INSERT INTO "${schema}".odontogramas (
      patient_id,
      fase,
      teeth,
      plan_tratamiento,
      plan_id,
      notas,
      last_saved_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.patient_id,
    data.fase,
    data.teeth || {},
    planTratamiento,
    data.plan_id || null,
    data.notas || '',
    new Date().toISOString()
  ]);
  if (rows[0]) {
    rows[0].plan_tratamiento = Array.isArray(rows[0].plan_tratamiento) ? rows[0].plan_tratamiento : [];
  }
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const updateById = async (schema, id, data) => {
  // ✅ Asegurar que plan_tratamiento sea un array
  if (data.plan_tratamiento !== undefined) {
    data.plan_tratamiento = Array.isArray(data.plan_tratamiento) 
      ? data.plan_tratamiento 
      : [];
  }

  const updates = [];
  const values = [];
  let idx = 1;

  const fields = ['teeth', 'plan_tratamiento', 'plan_id', 'notas', 'last_saved_at'];

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
    UPDATE "${schema}".odontogramas 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  if (rows[0]) {
    rows[0].plan_tratamiento = Array.isArray(rows[0].plan_tratamiento) ? rows[0].plan_tratamiento : [];
  }
  return rows[0] || null;
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".odontogramas 
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
      COUNT(CASE WHEN fase = 'evolucion' THEN 1 END) AS evoluciones,
      COUNT(CASE WHEN fase = 'alta' THEN 1 END) AS altas,
      COUNT(DISTINCT patient_id) AS pacientes_unicos
    FROM "${schema}".odontogramas
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    iniciales: Number(rows[0]?.iniciales || 0),
    evoluciones: Number(rows[0]?.evoluciones || 0),
    altas: Number(rows[0]?.altas || 0),
    pacientes_unicos: Number(rows[0]?.pacientes_unicos || 0),
  };
};