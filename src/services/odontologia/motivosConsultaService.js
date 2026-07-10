// src/services/odontologia/motivosConsultaService.js
import * as motivosModel from '../../models/odontologia/motivosConsultaModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await motivosModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar motivos: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    return await motivosModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener motivo: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    if (!data.nombre) {
      throw new Error('El nombre es obligatorio');
    }
    if (data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (!data.duracion || data.duracion < 5) {
      throw new Error('La duración debe ser al menos 5 minutos');
    }
    if (data.duracion > 120) {
      throw new Error('La duración no puede superar los 120 minutos');
    }
    return await motivosModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear motivo: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await motivosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Motivo no encontrado');
    }

    if (data.nombre && data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (data.duracion && data.duracion < 5) {
      throw new Error('La duración debe ser al menos 5 minutos');
    }
    if (data.duracion && data.duracion > 120) {
      throw new Error('La duración no puede superar los 120 minutos');
    }

    return await motivosModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar motivo: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await motivosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Motivo no encontrado');
    }

    return await motivosModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar motivo: ${error.message}`);
  }
};