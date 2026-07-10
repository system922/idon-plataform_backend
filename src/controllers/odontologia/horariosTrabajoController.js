// src/controllers/odontologia/horariosTrabajoController.js
import * as horariosService from '../../services/odontologia/horariosTrabajoService.js';

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

    const horarios = await horariosService.getAll(schema);
    res.json({ success: true, data: horarios });
  } catch (err) {
    console.error('Error en getAll horarios:', err);
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

    const horario = await horariosService.getById(schema, req.params.id);
    if (!horario) {
      return res.status(404).json({ success: false, error: 'Horario no encontrado' });
    }
    res.json({ success: true, data: horario });
  } catch (err) {
    console.error('Error en getById horarios:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR DÍA
// ============================================================
export const getByDia = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const { dia } = req.params;
    const horario = await horariosService.getByDia(schema, dia);
    res.json({ success: true, data: horario });
  } catch (err) {
    console.error('Error en getByDia horarios:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// INICIALIZAR HORARIOS POR DEFECTO
// ============================================================
export const initDefaults = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const horarios = await horariosService.initDefaults(schema);
    res.json({ success: true, data: horarios, message: 'Horarios por defecto inicializados' });
  } catch (err) {
    console.error('Error en initDefaults horarios:', err);
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

    const horario = await horariosService.create(schema, req.body);
    res.status(201).json({ success: true, data: horario, message: 'Horario creado exitosamente' });
  } catch (err) {
    console.error('Error en create horarios:', err);
    if (err.message.includes('ya tiene un horario configurado')) {
      return res.status(409).json({ success: false, error: err.message });
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

    const horario = await horariosService.update(schema, req.params.id, req.body);
    res.json({ success: true, data: horario, message: 'Horario actualizado exitosamente' });
  } catch (err) {
    console.error('Error en update horarios:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('ya tiene un horario configurado')) {
      return res.status(409).json({ success: false, error: err.message });
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

    await horariosService.remove(schema, req.params.id);
    res.json({ success: true, message: 'Horario eliminado exitosamente' });
  } catch (err) {
    console.error('Error en remove horarios:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};