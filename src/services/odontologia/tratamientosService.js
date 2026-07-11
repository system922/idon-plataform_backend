// src/services/odontologia/tratamientosService.js
import * as tratamientosModel from '../../models/odontologia/tratamientosModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await tratamientosModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar tratamientos: ${error.message}`);
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
    const tratamiento = await tratamientosModel.findById(schema, id);
    if (!tratamiento) {
      throw new Error('Tratamiento no encontrado');
    }
    return tratamiento;
  } catch (error) {
    throw new Error(`Error al obtener tratamiento: ${error.message}`);
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
    return await tratamientosModel.search(schema, term.trim());
  } catch (error) {
    throw new Error(`Error al buscar tratamientos: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    if (!data.name) {
      throw new Error('El nombre es obligatorio');
    }
    if (data.name.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (data.duration_minutes && data.duration_minutes < 5) {
      throw new Error('La duración debe ser al menos 5 minutos');
    }
    if (data.duration_minutes && data.duration_minutes > 240) {
      throw new Error('La duración no puede superar los 240 minutos');
    }
    if (data.price && data.price < 0) {
      throw new Error('El precio no puede ser negativo');
    }

    return await tratamientosModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear tratamiento: ${error.message}`);
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

    const existing = await tratamientosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Tratamiento no encontrado');
    }

    if (data.name && data.name.length < 3) {
      throw new Error('El nombre debe tener al menos 3 caracteres');
    }
    if (data.duration_minutes && data.duration_minutes < 5) {
      throw new Error('La duración debe ser al menos 5 minutos');
    }
    if (data.duration_minutes && data.duration_minutes > 240) {
      throw new Error('La duración no puede superar los 240 minutos');
    }
    if (data.price && data.price < 0) {
      throw new Error('El precio no puede ser negativo');
    }

    return await tratamientosModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar tratamiento: ${error.message}`);
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

    const existing = await tratamientosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Tratamiento no encontrado');
    }

    return await tratamientosModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar tratamiento: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await tratamientosModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};