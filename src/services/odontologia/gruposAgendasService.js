// src/services/odontologia/gruposAgendasService.js
import * as gruposModel from '../../models/odontologia/gruposAgendasModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await gruposModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar grupos: ${error.message}`);
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
    return await gruposModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener grupo: ${error.message}`);
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
    return await gruposModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear grupo: ${error.message}`);
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

    const existing = await gruposModel.findById(schema, id);
    if (!existing) {
      throw new Error('Grupo no encontrado');
    }

    if (data.nombre && data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }

    return await gruposModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar grupo: ${error.message}`);
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

    const existing = await gruposModel.findById(schema, id);
    if (!existing) {
      throw new Error('Grupo no encontrado');
    }

    return await gruposModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar grupo: ${error.message}`);
  }
};