// services/odontologia/citasService.js
import * as citasModel from '../../models/odontologia/citasModel.js';

export const getAll = async (schema) => {
  try {
    return await citasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar citas: ${error.message}`);
  }
};

export const getByFechaAndEspecialista = async (schema, fecha, especialistaId) => {
  try {
    if (!fecha) throw new Error('La fecha es obligatoria');
    if (!especialistaId) throw new Error('El especialista es obligatorio');
    return await citasModel.findByFechaAndEspecialista(schema, fecha, especialistaId);
  } catch (error) {
    throw new Error(`Error al obtener citas: ${error.message}`);
  }
};

export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    return await citasModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener citas del paciente: ${error.message}`);
  }
};

export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const cita = await citasModel.findById(schema, id);
    if (!cita) throw new Error('Cita no encontrada');
    return cita;
  } catch (error) {
    throw new Error(`Error al obtener cita: ${error.message}`);
  }
};

export const create = async (schema, data) => {
  try {
    if (!data.patient_id) throw new Error('El paciente es obligatorio');
    if (!data.especialista_id) throw new Error('El especialista es obligatorio');
    if (!data.fecha) throw new Error('La fecha es obligatoria');
    if (!data.hora_inicio) throw new Error('La hora de inicio es obligatoria');
    if (!data.hora_fin) throw new Error('La hora de fin es obligatoria');

    const disponible = await citasModel.verificarDisponibilidad(
      schema,
      data.especialista_id,
      data.fecha,
      data.hora_inicio,
      data.hora_fin
    );

    if (!disponible) {
      throw new Error('El horario seleccionado no está disponible');
    }

    return await citasModel.insert(schema, data);
  } catch (error) {
    throw new Error(`Error al crear cita: ${error.message}`);
  }
};

export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await citasModel.findById(schema, id);
    if (!existing) throw new Error('Cita no encontrada');

    if (data.fecha || data.hora_inicio || data.hora_fin || data.especialista_id) {
      const especialistaId = data.especialista_id || existing.especialista_id;
      const fecha = data.fecha || existing.fecha;
      const horaInicio = data.hora_inicio || existing.hora_inicio;
      const horaFin = data.hora_fin || existing.hora_fin;

      const disponible = await citasModel.verificarDisponibilidad(
        schema,
        especialistaId,
        fecha,
        horaInicio,
        horaFin,
        id
      );

      if (!disponible) {
        throw new Error('El horario seleccionado no está disponible');
      }
    }

    return await citasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar cita: ${error.message}`);
  }
};

export const updateStatus = async (schema, id, status) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await citasModel.findById(schema, id);
    if (!existing) throw new Error('Cita no encontrada');
    return await citasModel.updateStatus(schema, id, status);
  } catch (error) {
    throw new Error(`Error al cambiar estado de la cita: ${error.message}`);
  }
};

export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await citasModel.findById(schema, id);
    if (!existing) throw new Error('Cita no encontrada');
    return await citasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar cita: ${error.message}`);
  }
};

export const getHorariosDisponibles = async (schema, especialistaId, fecha, duracion = null) => {
  try {
    if (!especialistaId) throw new Error('El especialista es obligatorio');
    if (!fecha) throw new Error('La fecha es obligatoria');
    return await citasModel.getHorariosDisponibles(schema, especialistaId, fecha, duracion);
  } catch (error) {
    throw new Error(`Error al obtener horarios disponibles: ${error.message}`);
  }
};

export const getEspecialistasDisponibles = async (schema, fecha, horaInicio, horaFin) => {
  try {
    if (!fecha) throw new Error('La fecha es obligatoria');
    if (!horaInicio) throw new Error('La hora de inicio es obligatoria');
    if (!horaFin) throw new Error('La hora de fin es obligatoria');
    return await citasModel.findEspecialistasDisponibles(schema, fecha, horaInicio, horaFin);
  } catch (error) {
    throw new Error(`Error al obtener especialistas disponibles: ${error.message}`);
  }
};

export const getStats = async (schema) => {
  try {
    return await citasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};