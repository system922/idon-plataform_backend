import { query } from '../../config/database.js';


// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id,
      document_number,
      first_name,
      last_name,
      email,
      phone,
      birth_date,
      gender,
      occupation,
      nationality,
      address,
      hc_number,
      blood_type,
      allergies,
      medical_history,
      insurance_company,
      insurance_policy,
      image_url,
      is_active,
      created_at,
      updated_at,
      (SELECT COUNT(*) FROM "${schema}".citas WHERE patient_id = pacientes.id AND deleted_at IS NULL) AS total_appointments
    FROM "${schema}".pacientes
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
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
      document_number,
      first_name,
      last_name,
      email,
      phone,
      birth_date,
      gender,
      occupation,
      nationality,
      address,
      hc_number,
      blood_type,
      allergies,
      medical_history,
      insurance_company,
      insurance_policy,
      image_url,
      is_active,
      created_at,
      updated_at,
      (SELECT COUNT(*) FROM "${schema}".citas WHERE patient_id = pacientes.id AND deleted_at IS NULL) AS total_appointments
    FROM "${schema}".pacientes
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// BUSCAR POR CÉDULA
// ============================================================
export const findByDocument = async (schema, documentNumber) => {
  const sql = `
    SELECT id, document_number, first_name, last_name, email, phone, image_url
    FROM "${schema}".pacientes
    WHERE document_number = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [documentNumber]);
  return rows[0] || null;
};

// ============================================================
// BUSCAR POR TÉRMINO
// ============================================================
export const search = async (schema, searchTerm) => {
  const sql = `
    SELECT 
      id,
      document_number,
      first_name,
      last_name,
      email,
      phone,
      hc_number,
      image_url
    FROM "${schema}".pacientes
    WHERE deleted_at IS NULL
      AND (
        document_number ILIKE $1
        OR first_name ILIKE $1
        OR last_name ILIKE $1
        OR CONCAT(first_name, ' ', last_name) ILIKE $1
        OR hc_number ILIKE $1
      )
    ORDER BY first_name ASC
    LIMIT 20
  `;
  const { rows } = await query(sql, [`%${searchTerm}%`]);
  return rows;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".pacientes (
      document_number,
      first_name,
      last_name,
      email,
      phone,
      birth_date,
      gender,
      occupation,
      nationality,
      address,
      hc_number,
      blood_type,
      allergies,
      medical_history,
      insurance_company,
      insurance_policy,
      image_url,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.document_number,
    data.first_name,
    data.last_name,
    data.email || null,
    data.phone || null,
    data.birth_date || null,
    data.gender || null,
    data.occupation || null,
    data.nationality || null,
    data.address || null,
    data.hc_number || null,
    data.blood_type || null,
    data.allergies || null,
    data.medical_history || null,
    data.insurance_company || null,
    data.insurance_policy || null,
    data.image_url || null,
    data.is_active !== undefined ? data.is_active : true,
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
    'document_number', 'first_name', 'last_name', 'email', 'phone',
    'birth_date', 'gender', 'occupation', 'nationality', 'address',
    'hc_number', 'blood_type', 'allergies', 'medical_history',
    'insurance_company', 'insurance_policy', 'image_url', 'is_active'
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
    UPDATE "${schema}".pacientes 
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
  // Verificar si tiene citas asociadas
  const checkSql = `
    SELECT COUNT(*) AS count FROM "${schema}".citas
    WHERE patient_id = $1 AND deleted_at IS NULL
  `;
  const checkResult = await query(checkSql, [id]);
  if (Number(checkResult.rows[0]?.count || 0) > 0) {
    throw new Error('No se puede eliminar el paciente porque tiene citas asociadas');
  }

  const sql = `
    UPDATE "${schema}".pacientes 
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
      COUNT(CASE WHEN is_active = true THEN 1 END) AS activos,
      COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) AS nuevos_30dias,
      (SELECT COUNT(DISTINCT patient_id) FROM "${schema}".citas WHERE deleted_at IS NULL) AS con_citas
    FROM "${schema}".pacientes
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    activos: Number(rows[0]?.activos || 0),
    nuevos_30dias: Number(rows[0]?.nuevos_30dias || 0),
    con_citas: Number(rows[0]?.con_citas || 0),
  };
};

// ============================================================
// CONTAR POR RANGO DE FECHAS
// ============================================================
export const countByDateRange = async (schema, startDate, endDate) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM "${schema}".pacientes
    WHERE created_at >= $1 AND created_at <= $2 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [startDate, endDate]);
  return Number(rows[0]?.total || 0);
};