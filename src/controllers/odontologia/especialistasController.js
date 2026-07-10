// src/controllers/odontologia/especialistasController.js
import * as especialistasService from '../../services/odontologia/especialistasService.js';

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

    const especialistas = await especialistasService.getAll(schema);
    res.json({ success: true, data: especialistas });
  } catch (err) {
    console.error('Error en getAll especialistas:', err);
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

    const especialista = await especialistasService.getById(schema, req.params.id);
    if (!especialista) {
      return res.status(404).json({ success: false, error: 'Especialista no encontrado' });
    }
    res.json({ success: true, data: especialista });
  } catch (err) {
    console.error('Error en getById especialistas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// BUSCAR
// ============================================================
export const search = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'La búsqueda debe tener al menos 2 caracteres' });
    }

    const especialistas = await especialistasService.search(schema, q.trim());
    res.json({ success: true, data: especialistas });
  } catch (err) {
    console.error('Error en search especialistas:', err);
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

    const especialista = await especialistasService.create(schema, req.body);
    res.status(201).json({ success: true, data: especialista, message: 'Especialista creado exitosamente' });
  } catch (err) {
    console.error('Error en create especialistas:', err);
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

    const especialista = await especialistasService.update(schema, req.params.id, req.body);
    res.json({ success: true, data: especialista, message: 'Especialista actualizado exitosamente' });
  } catch (err) {
    console.error('Error en update especialistas:', err);
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

    await especialistasService.remove(schema, req.params.id);
    res.json({ success: true, message: 'Especialista eliminado exitosamente' });
  } catch (err) {
    console.error('Error en remove especialistas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('tiene agendas asociadas')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const stats = await especialistasService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('Error en getStats especialistas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};