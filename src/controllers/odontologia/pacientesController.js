// src/controllers/odontologia/pacientesController.js
import * as pacienteModel from '../../models/odontologia/Paciente.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

// ============================================================
// LISTAR PACIENTES
// ============================================================
export async function getPacientes(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

    const pacientes = await pacienteModel.findAllPacientes(schema);
    res.json({ 
      success: true, 
      data: pacientes 
    });
  } catch (error) {
    console.error('Error en getPacientes:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error al obtener pacientes' 
    });
  }
}

// ============================================================
// OBTENER PACIENTE POR ID
// ============================================================
export async function getPaciente(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

    const { id } = req.params;
    const paciente = await pacienteModel.findPacienteById(schema, id);

    if (!paciente) {
      return res.status(404).json({ 
        success: false, 
        message: 'Paciente no encontrado' 
      });
    }

    res.json({ 
      success: true, 
      data: paciente 
    });
  } catch (error) {
    console.error('Error en getPaciente:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Error al obtener paciente' 
    });
  }
}

// ============================================================
// CREAR PACIENTE
// ============================================================
export async function createPaciente(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

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
      allergies,
      medical_history,
      insurance_company,
      insurance_policy
    } = req.body;

    // Validaciones
    if (!document_number || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: 'Nombres, apellidos y cédula son obligatorios'
      });
    }

    // Verificar si ya existe un paciente con la misma cédula
    const existing = await pacienteModel.findPacienteByDocument(schema, document_number);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un paciente con esta cédula'
      });
    }

    // Generar número de historia clínica
    const hc_number = await pacienteModel.generateHCNumber(schema);

    const paciente = await pacienteModel.createPaciente(schema, {
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
      allergies,
      medical_history,
      insurance_company,
      insurance_policy
    });

    res.status(201).json({
      success: true,
      data: paciente,
      message: 'Paciente creado exitosamente'
    });
  } catch (error) {
    console.error('Error en createPaciente:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Ya existe un paciente con esta cédula o correo'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Error al crear paciente'
    });
  }
}

// ============================================================
// ACTUALIZAR PACIENTE
// ============================================================
export async function updatePaciente(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

    const { id } = req.params;
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
      allergies,
      medical_history,
      insurance_company,
      insurance_policy,
      is_active
    } = req.body;

    // Verificar si el paciente existe
    const existing = await pacienteModel.findPacienteById(schema, id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Paciente no encontrado'
      });
    }

    // Validar campos requeridos
    if (!document_number || !first_name || !last_name) {
      return res.status(400).json({
        success: false,
        message: 'Nombres, apellidos y cédula son obligatorios'
      });
    }

    const paciente = await pacienteModel.updatePaciente(schema, id, {
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
      allergies,
      medical_history,
      insurance_company,
      insurance_policy,
      is_active
    });

    res.json({
      success: true,
      data: paciente,
      message: 'Paciente actualizado exitosamente'
    });
  } catch (error) {
    console.error('Error en updatePaciente:', error);
    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Ya existe otro paciente con esta cédula o correo'
      });
    }
    res.status(500).json({
      success: false,
      message: error.message || 'Error al actualizar paciente'
    });
  }
}

// ============================================================
// ELIMINAR PACIENTE (soft delete)
// ============================================================
export async function deletePaciente(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

    const { id } = req.params;

    const paciente = await pacienteModel.findPacienteById(schema, id);
    if (!paciente) {
      return res.status(404).json({
        success: false,
        message: 'Paciente no encontrado'
      });
    }

    const deleted = await pacienteModel.deletePaciente(schema, id);
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Paciente no encontrado o ya eliminado'
      });
    }

    res.json({
      success: true,
      message: 'Paciente eliminado exitosamente'
    });
  } catch (error) {
    console.error('Error en deletePaciente:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al eliminar paciente'
    });
  }
}

// ============================================================
// BUSCAR PACIENTES
// ============================================================
export async function searchPacientes(req, res) {
  try {
    const schema = await getSchemaName(req);
    if (!schema) {
      return res.status(400).json({ 
        success: false, 
        message: 'Business context required' 
      });
    }

    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'La búsqueda debe tener al menos 2 caracteres'
      });
    }

    const pacientes = await pacienteModel.searchPacientes(schema, q.trim());
    res.json({
      success: true,
      data: pacientes
    });
  } catch (error) {
    console.error('Error en searchPacientes:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error al buscar pacientes'
    });
  }
}