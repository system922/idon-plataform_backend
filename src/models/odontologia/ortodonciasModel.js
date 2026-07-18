// models/odontologia/ortodonciasModel.js
import { query } from '../../config/database.js';

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const findByPatientId = async (schema, patientId) => {
  const sql = `
    SELECT 
      id,
      paciente_id,
      requiere_tratamiento,
      estado,
      diagnostico,
      trabajo,
      tratamiento,
      resumen,
      fotografias,
      doctor,
      fecha_inicio,
      fecha_fin,
      created_at,
      updated_at
    FROM "${schema}".ortodoncias
    WHERE paciente_id = $1 AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const { rows } = await query(sql, [patientId]);
  
  if (rows.length > 0) {
    // Parsear fotografias si es string
    if (typeof rows[0].fotografias === 'string') {
      try {
        rows[0].fotografias = JSON.parse(rows[0].fotografias);
      } catch (e) {
        rows[0].fotografias = [];
      }
    }
    // Asegurar que es un array
    if (!Array.isArray(rows[0].fotografias)) {
      rows[0].fotografias = [];
    }
  }
  
  return rows[0] || null;
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      paciente_id,
      requiere_tratamiento,
      estado,
      diagnostico,
      trabajo,
      tratamiento,
      resumen,
      fotografias,
      doctor,
      fecha_inicio,
      fecha_fin,
      created_at,
      updated_at
    FROM "${schema}".ortodoncias
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  
  if (rows.length > 0) {
    if (typeof rows[0].fotografias === 'string') {
      try {
        rows[0].fotografias = JSON.parse(rows[0].fotografias);
      } catch (e) {
        rows[0].fotografias = [];
      }
    }
    if (!Array.isArray(rows[0].fotografias)) {
      rows[0].fotografias = [];
    }
  }
  
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
    'requiere_tratamiento',
    'estado',
    'diagnostico',
    'trabajo',
    'tratamiento',
    'resumen',
    'fotografias',
    'doctor',
    'fecha_inicio',
    'fecha_fin'
  ];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      // Si es fotografias, asegurar que es JSON
      if (field === 'fotografias' && typeof data[field] === 'object') {
        values.push(JSON.stringify(data[field]));
      } else {
        values.push(data[field]);
      }
    }
  });

  if (updates.length === 0) {
    return findById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".ortodoncias 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  
  const { rows } = await query(sql, values);
  
  if (rows.length > 0) {
    if (typeof rows[0].fotografias === 'string') {
      try {
        rows[0].fotografias = JSON.parse(rows[0].fotografias);
      } catch (e) {
        rows[0].fotografias = [];
      }
    }
    if (!Array.isArray(rows[0].fotografias)) {
      rows[0].fotografias = [];
    }
  }
  
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".ortodoncias (
      paciente_id,
      requiere_tratamiento,
      estado,
      diagnostico,
      trabajo,
      tratamiento,
      resumen,
      fotografias,
      doctor,
      fecha_inicio,
      fecha_fin
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `;
  
  const fotografiasJson = data.fotografias ? JSON.stringify(data.fotografias) : '[]';
  
  const { rows } = await query(sql, [
    data.paciente_id,
    data.requiere_tratamiento || false,
    data.estado || (data.requiere_tratamiento ? 'diagnostico' : 'no_requiere'),
    data.diagnostico || {},
    data.trabajo || {},
    data.tratamiento || {},
    data.resumen || {},
    fotografiasJson,
    data.doctor || null,
    data.fecha_inicio || null,
    data.fecha_fin || null,
  ]);
  
  if (rows.length > 0) {
    if (typeof rows[0].fotografias === 'string') {
      try {
        rows[0].fotografias = JSON.parse(rows[0].fotografias);
      } catch (e) {
        rows[0].fotografias = [];
      }
    }
    if (!Array.isArray(rows[0].fotografias)) {
      rows[0].fotografias = [];
    }
  }
  
  return rows[0] || null;
};