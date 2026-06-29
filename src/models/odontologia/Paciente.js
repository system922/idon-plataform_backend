// src/models/odontologia/Paciente.js
import { query, queryOne, queryWithSchema, getSchemaName } from '../../utils/dbHelpers.js';

// ============================================================
// LISTAR PACIENTES
// ============================================================
export async function findAllPacientes(schema) {
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
      (SELECT COUNT(*) FROM ${schema}.citas WHERE patient_id = pacientes.id) AS total_appointments
    FROM ${schema}.pacientes
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  return await query(schema, sql);
}

// ============================================================
// OBTENER PACIENTE POR ID
// ============================================================
export async function findPacienteById(schema, id) {
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
    FROM ${schema}.pacientes
    WHERE id = $1 AND deleted_at IS NULL
  `;
  return await queryOne(schema, sql, [id]);
}

// ============================================================
// OBTENER PACIENTE POR DOCUMENTO
// ============================================================
export async function findPacienteByDocument(schema, documentNumber) {
  const sql = `
    SELECT id, document_number, first_name, last_name, email, phone
    FROM ${schema}.pacientes
    WHERE document_number = $1 AND deleted_at IS NULL
  `;
  return await queryOne(schema, sql, [documentNumber]);
}

// ============================================================
// CREAR PACIENTE
// ============================================================
export async function createPaciente(schema, data) {
  const {
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
    external_id
  } = data;

  const sql = `
    INSERT INTO ${schema}.pacientes (
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

  const params = [
    document_number,
    first_name,
    last_name,
    email || null,
    phone || null,
    birth_date || null,
    gender || null,
    occupation || null,
    nationality || null,
    address || null,
    hc_number || null,
    blood_type || null,
    allergies || null,
    medical_history || null,
    insurance_company || null,
    insurance_policy || null,
    external_id || null,
    true
  ];

  return await queryOne(schema, sql, params);
}

// ============================================================
// ACTUALIZAR PACIENTE
// ============================================================
export async function updatePaciente(schema, id, data) {
  const {
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
    is_active
  } = data;

  const sql = `
    UPDATE ${schema}.pacientes SET
      document_number = COALESCE($1, document_number),
      first_name = COALESCE($2, first_name),
      last_name = COALESCE($3, last_name),
      email = $4,
      phone = $5,
      birth_date = $6,
      gender = $7,
      occupation = $8,
      nationality = $9,
      address = $10,
      hc_number = $11,
      blood_type = $12,
      allergies = $13,
      medical_history = $14,
      insurance_company = $15,
      insurance_policy = $16,
      is_active = COALESCE($17, is_active),
      updated_at = NOW()
    WHERE id = $18 AND deleted_at IS NULL
    RETURNING *
  `;

  const params = [
    document_number,
    first_name,
    last_name,
    email || null,
    phone || null,
    birth_date || null,
    gender || null,
    occupation || null,
    nationality || null,
    address || null,
    hc_number || null,
    blood_type || null,
    allergies || null,
    medical_history || null,
    insurance_company || null,
    insurance_policy || null,
    is_active !== undefined ? is_active : true,
    id
  ];

  return await queryOne(schema, sql, params);
}

// ============================================================
// ELIMINAR PACIENTE (soft delete)
// ============================================================
export async function deletePaciente(schema, id) {
  const sql = `
    UPDATE ${schema}.pacientes 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const result = await queryOne(schema, sql, [id]);
  return result !== null;
}

// ============================================================
// GENERAR NÚMERO DE HISTORIA CLÍNICA
// ============================================================
export async function generateHCNumber(schema) {
  const sql = `
    SELECT MAX(CAST(SUBSTRING(hc_number FROM 'HC-\\d{4}-(\\d+)') AS INTEGER)) AS last_num
    FROM ${schema}.pacientes
    WHERE hc_number IS NOT NULL
  `;
  const result = await queryOne(schema, sql);
  const nextNum = (result?.last_num || 0) + 1;
  const year = new Date().getFullYear();
  return `HC-${year}-${String(nextNum).padStart(6, '0')}`;
}