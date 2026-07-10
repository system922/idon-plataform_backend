// src/services/odontologia/horariosTrabajoService.js
import * as horariosModel from '../../models/odontologia/horariosTrabajoModel.js';

const DIAS_VALIDOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await horariosModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar horarios: ${error.message}`);
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
    return await horariosModel.findById(schema, id);
  } catch (error) {
    throw new Error(`Error al obtener horario: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR DÍA
// ============================================================
export const getByDia = async (schema, dia) => {
  try {
    if (!dia) {
      throw new Error('El día es obligatorio');
    }
    if (!DIAS_VALIDOS.includes(dia)) {
      throw new Error(`Día inválido. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
    }
    return await horariosModel.findByDia(schema, dia);
  } catch (error) {
    throw new Error(`Error al obtener horario por día: ${error.message}`);
  }
};

// ============================================================
// INICIALIZAR HORARIOS POR DEFECTO
// ============================================================
export const initDefaults = async (schema) => {
  try {
    const existing = await horariosModel.findAll(schema);
    if (existing.length > 0) {
      return existing;
    }
    return await horariosModel.initDefaultHorarios(schema);
  } catch (error) {
    throw new Error(`Error al inicializar horarios: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  try {
    // Validaciones
    if (!data.dia) {
      throw new Error('El día es obligatorio');
    }
    if (!DIAS_VALIDOS.includes(data.dia)) {
      throw new Error(`Día inválido. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
    }
    if (!data.hora_inicio) {
      throw new Error('La hora de inicio es obligatoria');
    }
    if (!data.hora_fin) {
      throw new Error('La hora de fin es obligatoria');
    }
    
    // Validar que hora_inicio < hora_fin
    if (data.hora_inicio >= data.hora_fin) {
      throw new Error('La hora de inicio debe ser menor que la hora de fin');
    }

    // Verificar que el día no esté duplicado
    const existing = await horariosModel.findByDia(schema, data.dia);
    if (existing) {
      throw new Error(`El día "${data.dia}" ya tiene un horario configurado`);
    }

    return await horariosModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear horario: ${error.message}`);
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
    const existing = await horariosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Horario no encontrado');
    }

    // Validaciones
    if (data.dia && !DIAS_VALIDOS.includes(data.dia)) {
      throw new Error(`Día inválido. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
    }
    if (data.hora_inicio && data.hora_fin && data.hora_inicio >= data.hora_fin) {
      throw new Error('La hora de inicio debe ser menor que la hora de fin');
    }

    // Si cambia el día, verificar que no esté duplicado
    if (data.dia && data.dia !== existing.dia) {
      const duplicated = await horariosModel.findByDia(schema, data.dia);
      if (duplicated) {
        throw new Error(`El día "${data.dia}" ya tiene un horario configurado`);
      }
    }

    return await horariosModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar horario: ${error.message}`);
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

    const existing = await horariosModel.findById(schema, id);
    if (!existing) {
      throw new Error('Horario no encontrado');
    }

    return await horariosModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar horario: ${error.message}`);
  }
};