// models/odontologia/planesTratamientoModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS LOS PLANES CON DATOS DEL PACIENTE
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      p.id,
      p.patient_id,
      p.nombre AS name,
      p.descripcion AS description,
      p.fase,
      p.status,
      p.costo_total AS total_cost,
      p.items,
      p.odontograma_data,
      p.created_at,
      p.updated_at,
      pac.first_name,
      pac.last_name,
      pac.document_number,
      CONCAT(pac.first_name, ' ', pac.last_name) AS paciente_nombre
    FROM "${schema}".planes_tratamiento p
    LEFT JOIN "${schema}".pacientes pac ON p.patient_id = pac.id AND pac.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// LISTAR PLANES POR PACIENTE
// ============================================================
export const findByPatientId = async (schema, patientId) => {
  const sql = `
    SELECT 
      p.id,
      p.patient_id,
      p.nombre AS name,
      p.descripcion AS description,
      p.fase,
      p.status,
      p.costo_total AS total_cost,
      p.items,
      p.odontograma_data,
      p.created_at,
      p.updated_at,
      pac.first_name,
      pac.last_name,
      CONCAT(pac.first_name, ' ', pac.last_name) AS paciente_nombre
    FROM "${schema}".planes_tratamiento p
    LEFT JOIN "${schema}".pacientes pac ON p.patient_id = pac.id AND pac.deleted_at IS NULL
    WHERE p.patient_id = $1 AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `;
  const { rows } = await query(sql, [patientId]);
  return rows;
};

// ============================================================
// OBTENER PLAN POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      p.id,
      p.patient_id,
      p.nombre AS name,
      p.descripcion AS description,
      p.fase,
      p.status,
      p.costo_total AS total_cost,
      p.items,
      p.odontograma_data,
      p.created_at,
      p.updated_at,
      pac.first_name,
      pac.last_name,
      CONCAT(pac.first_name, ' ', pac.last_name) AS paciente_nombre
    FROM "${schema}".planes_tratamiento p
    LEFT JOIN "${schema}".pacientes pac ON p.patient_id = pac.id AND pac.deleted_at IS NULL
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CREAR PLAN
// ============================================================
// models/odontologia/planesTratamientoModel.js

// ============================================================
// CREAR PLAN (VERSIÓN CORREGIDA)
// ============================================================
export const insert = async (schema, data) => {
  // ✅ Limpiar y stringificar datos JSON para evitar errores
  const itemsJson = JSON.stringify(data.items || []);
  const odontogramaDataJson = JSON.stringify(data.odontograma_data || {});
  
  const sql = `
    INSERT INTO "${schema}".planes_tratamiento (
      patient_id,
      nombre,
      descripcion,
      fase,
      status,
      costo_total,
      items,
      odontograma_data
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  
  const { rows } = await query(sql, [
    data.patient_id,
    data.name,
    data.description || null,
    data.fase || 'inicial',
    data.status || 'draft',
    data.costo_total || 0,   // ✅ usa 'costo_total' (coincide con columna)
    itemsJson,               // ✅ JSON string
    odontogramaDataJson      // ✅ JSON string
  ]);
  
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR PLAN
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  // Asegurar que los campos JSON se stringifiquen si existen
  const fields = ['patient_id', 'nombre', 'descripcion', 'fase', 'status', 'costo_total', 'items', 'odontograma_data'];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      let value = data[field];
      // Stringificar campos JSONB
      if (field === 'items' || field === 'odontograma_data') {
        value = JSON.stringify(value);
      }
      updates.push(`${field} = $${idx++}`);
      values.push(value);
    }
  });

  if (updates.length === 0) {
    return findById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".planes_tratamiento 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR PLAN (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".planes_tratamiento 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// ESTADÍSTICAS DE PLANES
// ============================================================
export const getStats = async (schema) => {
  const sql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'active' THEN 1 END) AS activos,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completados,
      COUNT(CASE WHEN status = 'draft' THEN 1 END) AS borradores,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelados,
      COALESCE(AVG(costo_total), 0) AS costo_promedio
    FROM "${schema}".planes_tratamiento
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    activos: Number(rows[0]?.activos || 0),
    completados: Number(rows[0]?.completados || 0),
    borradores: Number(rows[0]?.borradores || 0),
    cancelados: Number(rows[0]?.cancelados || 0),
    costo_promedio: Number(rows[0]?.costo_promedio || 0)
  };
};