import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODAS
// ============================================================
export const findAll = async (schema) => {
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
      doctor,
      fecha_inicio,
      fecha_fin,
      created_at,
      updated_at
    FROM "${schema}".ortodoncias
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

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
      doctor,
      fecha_inicio,
      fecha_fin,
      created_at,
      updated_at
    FROM "${schema}".ortodoncias
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
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
      doctor,
      fecha_inicio,
      fecha_fin
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.paciente_id,
    data.requiere_tratamiento || false,
    data.estado || 'diagnostico',
    data.diagnostico || {},
    data.trabajo || {},
    data.tratamiento || {},
    data.resumen || {},
    data.doctor || null,
    data.fecha_inicio || null,
    data.fecha_fin || null,
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
    'requiere_tratamiento',
    'estado',
    'diagnostico',
    'trabajo',
    'tratamiento',
    'resumen',
    'doctor',
    'fecha_inicio',
    'fecha_fin',
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
    UPDATE "${schema}".ortodoncias 
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
    UPDATE "${schema}".ortodoncias 
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
      COUNT(CASE WHEN requiere_tratamiento = true THEN 1 END) AS requieren,
      COUNT(CASE WHEN requiere_tratamiento = false THEN 1 END) AS no_requieren,
      COUNT(CASE WHEN estado = 'diagnostico' THEN 1 END) AS en_diagnostico,
      COUNT(CASE WHEN estado = 'en_curso' THEN 1 END) AS en_curso,
      COUNT(CASE WHEN estado = 'finalizado' THEN 1 END) AS finalizados
    FROM "${schema}".ortodoncias
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    requieren: Number(rows[0]?.requieren || 0),
    no_requieren: Number(rows[0]?.no_requieren || 0),
    en_diagnostico: Number(rows[0]?.en_diagnostico || 0),
    en_curso: Number(rows[0]?.en_curso || 0),
    finalizados: Number(rows[0]?.finalizados || 0),
  };
};