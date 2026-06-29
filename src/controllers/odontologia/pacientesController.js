// src/controllers/odontologia/pacientesController.js
import * as pacienteService from '../../services/odontologia/pacientesService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

// ============================================================
// FUNCIÓN AUXILIAR PARA OBTENER SCHEMA
// ============================================================
const getSchema = (req, res) => {
  const schema = req.schema || req.headers['x-db-name'] || req.headers['x-schema-name'];
  if (!schema) {
    res.status(400).json({
      success: false,
      error: 'Business context required'
    });
    return null;
  }
  return schema;
};

// ============================================================
// LISTAR TODOS LOS PACIENTES
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const pacientes = await pacienteService.getAll(schema);
    res.json({
      success: true,
      data: pacientes,
    });
  } catch (err) {
    console.error('Error en getAll pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// OBTENER PACIENTE POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const paciente = await pacienteService.getById(schema, req.params.id);
    if (!paciente) {
      return res.status(404).json({
        success: false,
        error: 'Paciente no encontrado'
      });
    }

    res.json({
      success: true,
      data: paciente,
    });
  } catch (err) {
    console.error('Error en getById pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// BUSCAR PACIENTES
// ============================================================
export const search = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({
        success: false,
        error: 'La búsqueda debe tener al menos 2 caracteres'
      });
    }

    const pacientes = await pacienteService.search(schema, q.trim());
    res.json({
      success: true,
      data: pacientes,
    });
  } catch (err) {
    console.error('Error en search pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// CREAR PACIENTE
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const paciente = await pacienteService.create(schema, req.body);
    res.status(201).json({
      success: true,
      data: paciente,
      message: 'Paciente creado exitosamente',
    });
  } catch (err) {
    console.error('Error en create pacientes:', err);

    if (err.message.includes('cédula')) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// ACTUALIZAR PACIENTE
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const paciente = await pacienteService.update(schema, req.params.id, req.body);
    res.json({
      success: true,
      data: paciente,
      message: 'Paciente actualizado exitosamente',
    });
  } catch (err) {
    console.error('Error en update pacientes:', err);

    if (err.message.includes('no encontrado')) {
      return res.status(404).json({
        success: false,
        error: err.message,
      });
    }

    if (err.message.includes('cédula')) {
      return res.status(409).json({
        success: false,
        error: err.message,
      });
    }

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// ELIMINAR PACIENTE
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    await pacienteService.remove(schema, req.params.id);
    res.json({
      success: true,
      message: 'Paciente eliminado exitosamente',
    });
  } catch (err) {
    console.error('Error en remove pacientes:', err);

    if (err.message.includes('no encontrado')) {
      return res.status(404).json({
        success: false,
        error: err.message,
      });
    }

    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

// ============================================================
// ESTADÍSTICAS DE PACIENTES
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const stats = await pacienteService.getStats(schema);
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('Error en getStats pacientes:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};