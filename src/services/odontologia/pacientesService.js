// src/services/odontologia/pacientesService.js
import * as pacienteModel from '../models/odontologia/pacientesModel.js';

// ============================================================
// FUNCIONES DE SERVICIO (lógica de negocio)
// ============================================================

export const getAll = async (schema) => {
  return pacienteModel.findAll(schema);
};

export const getById = async (schema, id) => {
  return pacienteModel.findById(schema, id);
};

export const search = async (schema, searchTerm) => {
  if (!searchTerm || searchTerm.trim().length < 2) {
    return [];
  }
  return pacienteModel.search(schema, searchTerm.trim());
};

export const create = async (schema, body) => {
  // Validaciones
  if (!body.document_number) {
    throw new Error('La cédula es requerida');
  }
  if (!body.first_name) {
    throw new Error('El nombre es requerido');
  }
  if (!body.last_name) {
    throw new Error('El apellido es requerido');
  }

  // Verificar duplicado por cédula
  const existing = await pacienteModel.findByDocument(schema, body.document_number);
  if (existing) {
    throw new Error('Ya existe un paciente con esta cédula');
  }

  // Generar número de historia clínica
  const hc_number = await pacienteModel.generateHCNumber(schema);

  const paciente = await pacienteModel.insert(schema, {
    document_number: body.document_number,
    first_name: body.first_name,
    last_name: body.last_name,
    email: body.email || null,
    phone: body.phone || null,
    birth_date: body.birth_date || null,
    gender: body.gender || null,
    occupation: body.occupation || null,
    nationality: body.nationality || null,
    address: body.address || null,
    hc_number: hc_number,
    blood_type: body.blood_type || null,
    allergies: body.allergies || null,
    medical_history: body.medical_history || null,
    insurance_company: body.insurance_company || null,
    insurance_policy: body.insurance_policy || null,
    external_id: body.external_id || null,
    is_active: body.is_active !== undefined ? body.is_active : true,
  });

  return paciente;
};

export const update = async (schema, id, body) => {
  // Verificar que el paciente existe
  const current = await pacienteModel.findById(schema, id);
  if (!current) {
    throw new Error('Paciente no encontrado');
  }

  // Si cambia la cédula, verificar que no esté duplicada
  if (body.document_number && body.document_number !== current.document_number) {
    const existing = await pacienteModel.findByDocument(schema, body.document_number);
    if (existing) {
      throw new Error('Ya existe otro paciente con esta cédula');
    }
  }

  const paciente = await pacienteModel.updateById(schema, id, {
    document_number: body.document_number || current.document_number,
    first_name: body.first_name || current.first_name,
    last_name: body.last_name || current.last_name,
    email: body.email !== undefined ? body.email : current.email,
    phone: body.phone !== undefined ? body.phone : current.phone,
    birth_date: body.birth_date !== undefined ? body.birth_date : current.birth_date,
    gender: body.gender !== undefined ? body.gender : current.gender,
    occupation: body.occupation !== undefined ? body.occupation : current.occupation,
    nationality: body.nationality !== undefined ? body.nationality : current.nationality,
    address: body.address !== undefined ? body.address : current.address,
    hc_number: body.hc_number !== undefined ? body.hc_number : current.hc_number,
    blood_type: body.blood_type !== undefined ? body.blood_type : current.blood_type,
    allergies: body.allergies !== undefined ? body.allergies : current.allergies,
    medical_history: body.medical_history !== undefined ? body.medical_history : current.medical_history,
    insurance_company: body.insurance_company !== undefined ? body.insurance_company : current.insurance_company,
    insurance_policy: body.insurance_policy !== undefined ? body.insurance_policy : current.insurance_policy,
    is_active: body.is_active !== undefined ? body.is_active : current.is_active,
  });

  return paciente;
};

export const remove = async (schema, id) => {
  const paciente = await pacienteModel.findById(schema, id);
  if (!paciente) {
    throw new Error('Paciente no encontrado');
  }
  return pacienteModel.softDelete(schema, id);
};

export const getStats = async (schema) => {
  const pacientes = await pacienteModel.findAll(schema);
  const total = pacientes.length;
  const activos = pacientes.filter(p => p.is_active !== false).length;
  
  // Calcular nuevos en los últimos 30 días
  const haceUnMes = new Date();
  haceUnMes.setDate(haceUnMes.getDate() - 30);
  const nuevos = pacientes.filter(p => {
    if (!p.created_at) return false;
    return new Date(p.created_at) >= haceUnMes;
  }).length;

  // Pacientes con citas
  const conCitas = pacientes.filter(p => (p.total_appointments || 0) > 0).length;

  return {
    total,
    activos,
    nuevos_30dias: nuevos,
    con_citas: conCitas,
  };
};