// src/models/odontologia/odontogramasModel.js
import { query } from '../../config/database.js';

// ============================================================
// HELPER: Parsear JSONB fields (teeth y plan_tratamiento)
// ============================================================
const parseOdontogramaRow = (row) => {
  if (!row) return null;
  
  // ✅ Parsear teeth de string a objeto
  let teeth = {};
  if (row.teeth) {
    if (typeof row.teeth === 'string') {
      try {
        teeth = JSON.parse(row.teeth);
      } catch (e) {
        teeth = {};
      }
    } else if (typeof row.teeth === 'object') {
      teeth = row.teeth;
    }
  }
  
  // ✅ Parsear plan_tratamiento de string a array
  let planTratamiento = [];
  if (row.plan_tratamiento) {
    if (typeof row.plan_tratamiento === 'string') {
      try {
        planTratamiento = JSON.parse(row.plan_tratamiento);
      } catch (e) {
        planTratamiento = [];
      }
    } else if (Array.isArray(row.plan_tratamiento)) {
      planTratamiento = row.plan_tratamiento;
    }
  }
  
  return {
    ...row,
    teeth: teeth,
    plan_tratamiento: planTratamiento
  };
};

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
  return rows.map(row => parseOdontogramaRow(row));
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
  return parseOdontogramaRow(rows[0]);
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
  return rows.map(row => parseOdontogramaRow(row));
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
  return parseOdontogramaRow(rows[0]);
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
  return parseOdontogramaRow(rows[0]);
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  // ✅ Asegurar que teeth sea un objeto
  let teethData = {};
  if (data.teeth) {
    if (typeof data.teeth === 'string') {
      try {
        teethData = JSON.parse(data.teeth);
      } catch (e) {
        teethData = {};
      }
    } else if (typeof data.teeth === 'object') {
      teethData = data.teeth;
    }
  }
  
  // ✅ Asegurar que plan_tratamiento sea un array
  let planTratamientoData = [];
  if (data.plan_tratamiento) {
    if (typeof data.plan_tratamiento === 'string') {
      try {
        planTratamientoData = JSON.parse(data.plan_tratamiento);
      } catch (e) {
        planTratamientoData = [];
      }
    } else if (Array.isArray(data.plan_tratamiento)) {
      planTratamientoData = data.plan_tratamiento;
    }
  }

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
    teethData,
    planTratamientoData,
    data.plan_id || null,
    data.notas || '',
    data.last_saved_at || new Date().toISOString()
  ]);
  return parseOdontogramaRow(rows[0]);
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  // ✅ Procesar teeth
  if (data.teeth !== undefined) {
    let teethData = {};
    if (typeof data.teeth === 'string') {
      try {
        teethData = JSON.parse(data.teeth);
      } catch (e) {
        teethData = {};
      }
    } else if (typeof data.teeth === 'object') {
      teethData = data.teeth;
    }
    updates.push(`teeth = $${idx++}`);
    values.push(teethData);
  }

  // ✅ Procesar plan_tratamiento
  if (data.plan_tratamiento !== undefined) {
    let planTratamientoData = [];
    if (typeof data.plan_tratamiento === 'string') {
      try {
        planTratamientoData = JSON.parse(data.plan_tratamiento);
      } catch (e) {
        planTratamientoData = [];
      }
    } else if (Array.isArray(data.plan_tratamiento)) {
      planTratamientoData = data.plan_tratamiento;
    }
    updates.push(`plan_tratamiento = $${idx++}`);
    values.push(planTratamientoData);
  }

  if (data.plan_id !== undefined) {
    updates.push(`plan_id = $${idx++}`);
    values.push(data.plan_id);
  }

  if (data.notas !== undefined) {
    updates.push(`notas = $${idx++}`);
    values.push(data.notas);
  }

  if (data.last_saved_at !== undefined) {
    updates.push(`last_saved_at = $${idx++}`);
    values.push(data.last_saved_at);
  }

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
  return parseOdontogramaRow(rows[0]);
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