// src/services/odontologia/citasService.js
import * as citasModel from '../../models/odontologia/citasModel.js';
import * as pacientesModel from '../../models/odontologia/pacientesModel.js';
import * as especialistasModel from '../../models/odontologia/especialistasModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema, filters = {}) => {
  try {
    return await citasModel.findAll(schema, filters);
  } catch (error) {
    throw new Error(`Error al listar citas: ${error.message}`);
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
    const cita = await citasModel.findById(schema, id);
    if (!cita) {
      throw new Error('Cita no encontrada');
    }
    return cita;
  } catch (error) {
    throw new Error(`Error al obtener cita: ${error.message}`);
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data, userId = null) => {
  try {
    // Validaciones
    if (!data.patient_id) {
      throw new Error('El paciente es obligatorio');
    }
    if (!data.odontologo_id) {
      throw new Error('El odontólogo es obligatorio');
    }
    if (!data.scheduled_for) {
      throw new Error('La fecha y hora son obligatorias');
    }

    // Verificar que el paciente existe
    const paciente = await pacientesModel.findById(schema, data.patient_id);
    if (!paciente) {
      throw new Error('Paciente no encontrado');
    }

    // Verificar que el odontólogo existe
    const odontologo = await especialistasModel.findById(schema, data.odontologo_id);
    if (!odontologo) {
      throw new Error('Odontólogo no encontrado');
    }

    // Verificar disponibilidad
    const startTime = new Date(data.scheduled_for);
    const duration = data.duration_minutes || 30;
    const endTime = new Date(startTime.getTime() + duration * 60000);
    
    const conflicts = await citasModel.checkAvailability(
      schema,
      data.odontologo_id,
      startTime,
      endTime
    );

    if (conflicts > 0) {
      throw new Error('El odontólogo ya tiene una cita en ese horario');
    }

    const citaData = {
      ...data,
      created_by: userId,
    };

    return await citasModel.insert(schema, citaData);
  } catch (error) {
    throw new Error(`Error al crear cita: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data, userId = null) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await citasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Cita no encontrada');
    }

    // Si cambia odontólogo o fecha, verificar disponibilidad
    if (data.odontologo_id || data.scheduled_for) {
      const odontologoId = data.odontologo_id || existing.odontologo_id;
      const startTime = data.scheduled_for ? new Date(data.scheduled_for) : new Date(existing.scheduled_for);
      const duration = data.duration_minutes || existing.duration_minutes || 30;
      const endTime = new Date(startTime.getTime() + duration * 60000);

      // Excluir la cita actual de la verificación
      const conflicts = await citasModel.checkAvailability(
        schema,
        odontologoId,
        startTime,
        endTime
      );

      // Si hay conflictos y la cita no es la misma
      if (conflicts > 0) {
        throw new Error('El odontólogo ya tiene una cita en ese horario');
      }
    }

    return await citasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar cita: ${error.message}`);
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

    const existing = await citasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Cita no encontrada');
    }

    return await citasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar cita: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema, filters = {}) => {
  try {
    return await citasModel.getStats(schema, filters);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR FECHA
// ============================================================
export const getByDate = async (schema, date) => {
  try {
    if (!date) {
      throw new Error('La fecha es obligatoria');
    }
    return await citasModel.findByDate(schema, date);
  } catch (error) {
    throw new Error(`Error al obtener citas por fecha: ${error.message}`);
  }
};

// ============================================================
// CAMBIAR ESTADO
// ============================================================
export const updateStatus = async (schema, id, status) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    if (!status) {
      throw new Error('El estado es obligatorio');
    }

    const validStatus = ['scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
    if (!validStatus.includes(status)) {
      throw new Error('Estado inválido');
    }

    const existing = await citasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Cita no encontrada');
    }

    return await citasModel.updateById(schema, id, { status });
  } catch (error) {
    throw new Error(`Error al actualizar estado: ${error.message}`);
  }
};