// src/controllers/odontologia/motivosConsultaController.js
import * as motivosService from '../../services/odontologia/motivosConsultaService.js';

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

    const motivos = await motivosService.getAll(schema);
    res.json({ success: true, data: motivos });
  } catch (err) {
    console.error('Error en getAll motivos:', err);
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

    const motivo = await motivosService.getById(schema, req.params.id);
    if (!motivo) {
      return res.status(404).json({ success: false, error: 'Motivo no encontrado' });
    }
    res.json({ success: true, data: motivo });
  } catch (err) {
    console.error('Error en getById motivos:', err);
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

    const motivo = await motivosService.create(schema, req.body);
    res.status(201).json({ success: true, data: motivo, message: 'Motivo creado exitosamente' });
  } catch (err) {
    console.error('Error en create motivos:', err);
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

    const motivo = await motivosService.update(schema, req.params.id, req.body);
    res.json({ success: true, data: motivo, message: 'Motivo actualizado exitosamente' });
  } catch (err) {
    console.error('Error en update motivos:', err);
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

    await motivosService.remove(schema, req.params.id);
    res.json({ success: true, message: 'Motivo eliminado exitosamente' });
  } catch (err) {
    console.error('Error en remove motivos:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};