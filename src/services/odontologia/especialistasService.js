// src/services/odontologia/especialistasService.js
import * as especialistasModel from '../../models/odontologia/especialistasModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await especialistasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar especialistas: ${error.message}`);
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
    return await especialistasModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener especialista: ${error.message}`);
  }
};

// ============================================================
// BUSCAR
// ============================================================
export const search = async (schema, term) => {
  try {
    if (!term || term.trim().length < 2) {
      throw new Error('La búsqueda debe tener al menos 2 caracteres');
    }
    return await especialistasModel.search(schema, term.trim());
  } catch (error) {
    throw new Error(`Error al buscar especialistas: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    // Validaciones
    if (!data.nombre) {
      throw new Error('El nombre es obligatorio');
    }
    if (!data.especialidad) {
      throw new Error('La especialidad es obligatoria');
    }
    if (data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (data.email && !isValidEmail(data.email)) {
      throw new Error('El email no es válido');
    }

    return await especialistasModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear especialista: ${error.message}`);
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

    // Verificar que existe
    const existing = await especialistasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Especialista no encontrado');
    }

    // Validaciones
    if (data.nombre && data.nombre.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (data.email && !isValidEmail(data.email)) {
      throw new Error('El email no es válido');
    }

    return await especialistasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar especialista: ${error.message}`);
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

    // Verificar que existe
    const existing = await especialistasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Especialista no encontrado');
    }

    return await especialistasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar especialista: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await especialistasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// FUNCIÓN AUXILIAR: VALIDAR EMAIL
// ============================================================
const isValidEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};