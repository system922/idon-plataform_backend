// src/models/odontologia/citasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema, filters = {}) => {
  let sql = `
    SELECT 
      c.*,
      p.first_name AS paciente_nombre,
      p.last_name AS paciente_apellido,
      p.document_number,
      e.nombre AS odontologo_nombre,
      e.especialidad AS odontologo_especialidad,
      t.name AS treatment_name
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.odontologo_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.treatment_id = t.id AND t.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
  `;
  
  const values = [];
  let idx = 1;

  // Filtros
  if (filters.patient_id) {
    sql += ` AND c.patient_id = $${idx++}`;
    values.push(filters.patient_id);
  }
  if (filters.odontologo_id) {
    sql += ` AND c.odontologo_id = $${idx++}`;
    values.push(filters.odontologo_id);
  }
  if (filters.status) {
    sql += ` AND c.status = $${idx++}`;
    values.push(filters.status);
  }
  if (filters.start_date) {
    sql += ` AND c.scheduled_for >= $${idx++}`;
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    sql += ` AND c.scheduled_for <= $${idx++}`;
    values.push(filters.end_date);
  }
  if (filters.search) {
    sql += ` AND (p.first_name ILIKE $${idx++} OR p.last_name ILIKE $${idx} OR p.document_number ILIKE $${idx + 1})`;
    const term = `%${filters.search}%`;
    values.push(term, term, term);
    idx += 3;
  }

  sql += ` ORDER BY c.scheduled_for ASC`;

  const { rows } = await query(sql, values);
  return rows;
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      c.*,
      p.first_name AS paciente_nombre,
      p.last_name AS paciente_apellido,
      p.document_number,
      p.phone AS paciente_phone,
      p.email AS paciente_email,
      e.nombre AS odontologo_nombre,
      e.especialidad AS odontologo_especialidad,
      t.name AS treatment_name
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.odontologo_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.treatment_id = t.id AND t.deleted_at IS NULL
    WHERE c.id = $1 AND c.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".citas (
      patient_id,
      odontologo_id,
      treatment_id,
      scheduled_for,
      duration_minutes,
      status,
      service_type,
      notes,
      tooth_number,
      created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.patient_id,
    data.odontologo_id,
    data.treatment_id || null,
    data.scheduled_for,
    data.duration_minutes || 30,
    data.status || 'scheduled',
    data.service_type || 'consulta',
    data.notes || null,
    data.tooth_number || null,
    data.created_by || null,
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

  const fields = [
    'patient_id', 'odontologo_id', 'treatment_id', 'scheduled_for',
    'duration_minutes', 'status', 'service_type', 'notes', 'tooth_number'
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
    UPDATE "${schema}".citas 
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
    UPDATE "${schema}".citas 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// OBTENER ESTADÍSTICAS
// ============================================================
export const getStats = async (schema, filters = {}) => {
  let sql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'scheduled' THEN 1 END) AS scheduled,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN status = 'in_progress' THEN 1 END) AS in_progress,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled,
      COUNT(CASE WHEN status = 'no_show' THEN 1 END) AS no_show
    FROM "${schema}".citas
    WHERE deleted_at IS NULL
  `;

  const values = [];
  let idx = 1;

  if (filters.start_date) {
    sql += ` AND scheduled_for >= $${idx++}`;
    values.push(filters.start_date);
  }
  if (filters.end_date) {
    sql += ` AND scheduled_for <= $${idx++}`;
    values.push(filters.end_date);
  }
  if (filters.odontologo_id) {
    sql += ` AND odontologo_id = $${idx++}`;
    values.push(filters.odontologo_id);
  }

  const { rows } = await query(sql, values);
  return rows[0] || {};
};

// ============================================================
// OBTENER CITAS POR FECHA
// ============================================================
export const findByDate = async (schema, date) => {
  const sql = `
    SELECT 
      c.*,
      p.first_name AS paciente_nombre,
      p.last_name AS paciente_apellido,
      e.nombre AS odontologo_nombre
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.odontologo_id = e.id AND e.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND DATE(c.scheduled_for) = $1
    ORDER BY c.scheduled_for ASC
  `;
  const { rows } = await query(sql, [date]);
  return rows;
};

// ============================================================
// VERIFICAR DISPONIBILIDAD
// ============================================================
export const checkAvailability = async (schema, odontologoId, startTime, endTime) => {
  const sql = `
    SELECT COUNT(*) AS count
    FROM "${schema}".citas
    WHERE odontologo_id = $1
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'completed')
      AND scheduled_for < $2
      AND scheduled_for + (duration_minutes || ' minutes')::INTERVAL > $1
  `;
  const { rows } = await query(sql, [odontologoId, startTime, endTime]);
  return Number(rows[0]?.count || 0);
};