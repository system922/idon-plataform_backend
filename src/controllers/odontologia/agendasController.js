// src/controllers/odontologia/agendasController.js
import * as agendasService from '../../services/odontologia/agendasService.js';

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

    const agendas = await agendasService.getAll(schema);
    res.json({ success: true, data: agendas });
  } catch (err) {
    console.error('Error en getAll agendas:', err);
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

    const agenda = await agendasService.getById(schema, req.params.id);
    if (!agenda) {
      return res.status(404).json({ success: false, error: 'Agenda no encontrada' });
    }
    res.json({ success: true, data: agenda });
  } catch (err) {
    console.error('Error en getById agendas:', err);
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

    const agenda = await agendasService.create(schema, req.body);
    res.status(201).json({ success: true, data: agenda, message: 'Agenda creada exitosamente' });
  } catch (err) {
    console.error('Error en create agendas:', err);
    if (err.message.includes('no existe')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('Día inválido')) {
      return res.status(400).json({ success: false, error: err.message });
    }
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

    const agenda = await agendasService.update(schema, req.params.id, req.body);
    res.json({ success: true, data: agenda, message: 'Agenda actualizada exitosamente' });
  } catch (err) {
    console.error('Error en update agendas:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('no existe')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('Día inválido')) {
      return res.status(400).json({ success: false, error: err.message });
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

    await agendasService.remove(schema, req.params.id);
    res.json({ success: true, message: 'Agenda eliminada exitosamente' });
  } catch (err) {
    console.error('Error en remove agendas:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// AGREGAR DÍA LIBRE
// ============================================================
export const addDiaLibre = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { agendaId } = req.params;
    const diaLibre = await agendasService.addDiaLibre(schema, agendaId, req.body);
    res.status(201).json({ success: true, data: diaLibre, message: 'Día libre agregado exitosamente' });
  } catch (err) {
    console.error('Error en addDiaLibre:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR DÍA LIBRE
// ============================================================
export const removeDiaLibre = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { agendaId, diaLibreId } = req.params;
    await agendasService.removeDiaLibre(schema, agendaId, diaLibreId);
    res.json({ success: true, message: 'Día libre eliminado exitosamente' });
  } catch (err) {
    console.error('Error en removeDiaLibre:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER DÍAS LIBRES
// ============================================================
export const getDiasLibres = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { agendaId } = req.params;
    const diasLibres = await agendasService.getDiasLibres(schema, agendaId);
    res.json({ success: true, data: diasLibres });
  } catch (err) {
    console.error('Error en getDiasLibres:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};