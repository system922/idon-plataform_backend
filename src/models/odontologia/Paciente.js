// src/models/odontologia/pacientesModel.js
import { query } from '../../config/database.js';

const TABLE = 'pacientes';

// ============================================================
// FUNCIONES DE MODELO (solo queries SQL)
// ============================================================

export const findAll = async (schema) => {
  const sql = `
    SELECT 
      id,
      external_id,
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
      is_active,
      created_at,
      updated_at,
      (SELECT COUNT(*) FROM "${schema}".citas WHERE patient_id = pacientes.id) AS total_appointments
    FROM "${schema}".pacientes
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  const { rows } = await query(sql);
  return rows;
};

export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      external_id,
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
      is_active,
      created_at,
      updated_at
    FROM "${schema}".pacientes
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

export const findByDocument = async (schema, documentNumber) => {
  const sql = `
    SELECT id, document_number, first_name, last_name, email, phone
    FROM "${schema}".pacientes
    WHERE document_number = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [documentNumber]);
  return rows[0] || null;
};

export const search = async (schema, searchTerm) => {
  const sql = `
    SELECT 
      id,
      document_number,
      first_name,
      last_name,
      email,
      phone,
      hc_number
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
      external_id,
      is_active,
      created_at,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW())
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
    data.external_id || null,
    data.is_active !== undefined ? data.is_active : true,
  ]);
  return rows[0] || null;
};

export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.document_number !== undefined) {
    updates.push(`document_number = $${idx++}`);
    values.push(data.document_number);
  }
  if (data.first_name !== undefined) {
    updates.push(`first_name = $${idx++}`);
    values.push(data.first_name);
  }
  if (data.last_name !== undefined) {
    updates.push(`last_name = $${idx++}`);
    values.push(data.last_name);
  }
  if (data.email !== undefined) {
    updates.push(`email = $${idx++}`);
    values.push(data.email || null);
  }
  if (data.phone !== undefined) {
    updates.push(`phone = $${idx++}`);
    values.push(data.phone || null);
  }
  if (data.birth_date !== undefined) {
    updates.push(`birth_date = $${idx++}`);
    values.push(data.birth_date || null);
  }
  if (data.gender !== undefined) {
    updates.push(`gender = $${idx++}`);
    values.push(data.gender || null);
  }
  if (data.occupation !== undefined) {
    updates.push(`occupation = $${idx++}`);
    values.push(data.occupation || null);
  }
  if (data.nationality !== undefined) {
    updates.push(`nationality = $${idx++}`);
    values.push(data.nationality || null);
  }
  if (data.address !== undefined) {
    updates.push(`address = $${idx++}`);
    values.push(data.address || null);
  }
  if (data.hc_number !== undefined) {
    updates.push(`hc_number = $${idx++}`);
    values.push(data.hc_number || null);
  }
  if (data.blood_type !== undefined) {
    updates.push(`blood_type = $${idx++}`);
    values.push(data.blood_type || null);
  }
  if (data.allergies !== undefined) {
    updates.push(`allergies = $${idx++}`);
    values.push(data.allergies || null);
  }
  if (data.medical_history !== undefined) {
    updates.push(`medical_history = $${idx++}`);
    values.push(data.medical_history || null);
  }
  if (data.insurance_company !== undefined) {
    updates.push(`insurance_company = $${idx++}`);
    values.push(data.insurance_company || null);
  }
  if (data.insurance_policy !== undefined) {
    updates.push(`insurance_policy = $${idx++}`);
    values.push(data.insurance_policy || null);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) {
    return findById(schema, id);
  }

  updates.push(`updated_at = NOW()`);
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

export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".pacientes 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

export const generateHCNumber = async (schema) => {
  const sql = `
    SELECT MAX(CAST(SUBSTRING(hc_number FROM 'HC-\\d{4}-(\\d+)') AS INTEGER)) AS last_num
    FROM "${schema}".pacientes
    WHERE hc_number IS NOT NULL
  `;
  const { rows } = await query(sql);
  const lastNum = parseInt(rows[0]?.last_num || '0', 10);
  const nextNum = lastNum + 1;
  const year = new Date().getFullYear();
  return `HC-${year}-${String(nextNum).padStart(6, '0')}`;
};

export const countByDateRange = async (schema, startDate, endDate) => {
  const sql = `
    SELECT COUNT(*) AS total
    FROM "${schema}".pacientes
    WHERE created_at >= $1 AND created_at <= $2 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [startDate, endDate]);
  return Number(rows[0]?.total || 0);
};