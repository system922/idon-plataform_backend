// src/controllers/odontologia/gruposAgendasController.js
import * as gruposService from '../../services/odontologia/gruposAgendasService.js';

const getSchema = (req, res) => {
  const schema = req.schema || req.headers['x-db-name'] || req.headers['x-schema-name'];
  if (!schema) {
    res.status(400).json({ success: false, error: 'Business context required' });
    return null;
  }
  return schema;
};

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const grupos = await gruposService.getAll(schema);
    res.json({ success: true, data: grupos });
  } catch (err) {
    console.error('Error en getAll grupos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const grupo = await gruposService.getById(schema, req.params.id);
    if (!grupo) {
      return res.status(404).json({ success: false, error: 'Grupo no encontrado' });
    }
    res.json({ success: true, data: grupo });
  } catch (err) {
    console.error('Error en getById grupos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const grupo = await gruposService.create(schema, req.body);
    res.status(201).json({ success: true, data: grupo, message: 'Grupo creado exitosamente' });
  } catch (err) {
    console.error('Error en create grupos:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const grupo = await gruposService.update(schema, req.params.id, req.body);
    res.json({ success: true, data: grupo, message: 'Grupo actualizado exitosamente' });
  } catch (err) {
    console.error('Error en update grupos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    await gruposService.remove(schema, req.params.id);
    res.json({ success: true, message: 'Grupo eliminado exitosamente' });
  } catch (err) {
    console.error('Error en remove grupos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('tiene agendas asociadas')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};