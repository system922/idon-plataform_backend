// models/odontologia/evolucionesClinicasModel.js
import { query } from '../../config/database.js';

// ============================================================
// CREAR EVOLUCIÓN CLÍNICA
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".evoluciones_clinicas (
      patient_id,
      plan_id,
      tooth_number,
      diagnostico_inicial,
      tratamiento_id,
      tratamiento_nombre,
      estado,
      resultado_final,
      observaciones,
      fecha_ejecucion
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.patient_id,
    data.plan_id || null,
    data.tooth_number,
    data.diagnostico_inicial,
    data.tratamiento_id || null,
    data.tratamiento_nombre,
    data.estado || 'pendiente',
    data.resultado_final || null,
    data.observaciones || null,
    data.fecha_ejecucion || null
  ]);
  return rows[0];
};

// ============================================================
// LISTAR EVOLUCIONES POR PACIENTE
// ============================================================
export const findByPatientId = async (schema, patientId) => {
  const sql = `
    SELECT 
      e.*,
      p.nombre AS plan_nombre,
      p.status AS plan_status
    FROM "${schema}".evoluciones_clinicas e
    LEFT JOIN "${schema}".planes_tratamiento p ON e.plan_id = p.id
    WHERE e.patient_id = $1 AND e.deleted_at IS NULL
    ORDER BY e.created_at DESC
  `;
  const { rows } = await query(sql, [patientId]);
  return rows;
};

// ============================================================
// LISTAR EVOLUCIONES POR PLAN
// ============================================================
export const findByPlanId = async (schema, planId) => {
  const sql = `
    SELECT *
    FROM "${schema}".evoluciones_clinicas
    WHERE plan_id = $1 AND deleted_at IS NULL
    ORDER BY tooth_number, created_at ASC
  `;
  const { rows } = await query(sql, [planId]);
  return rows;
};

// ============================================================
// OBTENER EVOLUCIÓN POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT *
    FROM "${schema}".evoluciones_clinicas
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR EVOLUCIÓN
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = ['plan_id', 'tratamiento_id', 'tratamiento_nombre', 'estado', 'resultado_final', 'observaciones', 'fecha_ejecucion'];

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
    UPDATE "${schema}".evoluciones_clinicas 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR EVOLUCIÓN
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".evoluciones_clinicas 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// BUSCAR RESULTADO POR DIAGNÓSTICO Y TRATAMIENTO
// ============================================================
export const findResultadoByDiagnosticoTratamiento = async (schema, diagnostico, tratamiento) => {
  const sql = `
    SELECT resultado_final
    FROM "${schema}".tratamientos_resultados
    WHERE hallazgo_inicial = $1 
      AND tratamiento_nombre ILIKE $2 
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const { rows } = await query(sql, [diagnostico, `%${tratamiento}%`]);
  return rows[0]?.resultado_final || null;
};

// ============================================================
// OBTENER ESTADO DEL DIENTE EN EVOLUCIÓN
// ============================================================
export const getEstadoDiente = async (schema, patientId, toothNumber) => {
  const sql = `
    SELECT *
    FROM "${schema}".evoluciones_clinicas
    WHERE patient_id = $1 
      AND tooth_number = $2 
      AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const { rows } = await query(sql, [patientId, toothNumber]);
  return rows[0] || null;
};

// ============================================================
// OBTENER TODOS LOS DIENTES EN EVOLUCIÓN
// ============================================================
export const getAllDientesEvolucion = async (schema, patientId) => {
  const sql = `
    SELECT DISTINCT ON (tooth_number)
      tooth_number,
      diagnostico_inicial,
      tratamiento_nombre,
      estado,
      resultado_final,
      fecha_ejecucion,
      created_at AS ultima_actualizacion
    FROM "${schema}".evoluciones_clinicas
    WHERE patient_id = $1 AND deleted_at IS NULL
    ORDER BY tooth_number, created_at DESC
  `;
  const { rows } = await query(sql, [patientId]);
  return rows;
};