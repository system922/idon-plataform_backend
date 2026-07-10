// src/services/odontologia/agendasService.js
import * as agendasModel from '../../models/odontologia/agendasModel.js';
import * as especialistasModel from '../../models/odontologia/especialistasModel.js';

const DIAS_VALIDOS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  return await agendasModel.findAll(schema);
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  return await agendasModel.findById(schema, id);
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  // Validaciones
  if (!data.nombre) {
    throw new Error('El nombre es obligatorio');
  }
  if (!data.especialista_id) {
    throw new Error('El especialista es obligatorio');
  }

  // Verificar que el especialista exista
  const especialista = await especialistasModel.findById(schema, data.especialista_id);
  if (!especialista) {
    throw new Error('El especialista no existe');
  }

  // Validar días
  if (data.dias && data.dias.length > 0) {
    for (const dia of data.dias) {
      if (!DIAS_VALIDOS.includes(dia.dia)) {
        throw new Error(`Día inválido: ${dia.dia}. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
      }
    }
  }

  return await agendasModel.insert(schema, data);
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data) => {
  const existing = await agendasModel.findById(schema, id);
  if (!existing) {
    throw new Error('Agenda no encontrada');
  }

  // Verificar que el especialista exista si se envía
  if (data.especialista_id) {
    const especialista = await especialistasModel.findById(schema, data.especialista_id);
    if (!especialista) {
      throw new Error('El especialista no existe');
    }
  }

  // Validar días
  if (data.dias && data.dias.length > 0) {
    for (const dia of data.dias) {
      if (!DIAS_VALIDOS.includes(dia.dia)) {
        throw new Error(`Día inválido: ${dia.dia}. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
      }
    }
  }

  return await agendasModel.updateById(schema, id, data);
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (schema, id) => {
  const existing = await agendasModel.findById(schema, id);
  if (!existing) {
    throw new Error('Agenda no encontrada');
  }
  return await agendasModel.softDelete(schema, id);
};

// ============================================================
// AGREGAR DÍA LIBRE
// ============================================================
export const addDiaLibre = async (schema, agendaId, data) => {
  const agenda = await agendasModel.findById(schema, agendaId);
  if (!agenda) {
    throw new Error('Agenda no encontrada');
  }
  if (!data.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  if (!data.motivo) {
    throw new Error('El motivo es obligatorio');
  }
  return await agendasModel.addDiaLibre(schema, agendaId, data);
};

// ============================================================
// ELIMINAR DÍA LIBRE
// ============================================================
export const removeDiaLibre = async (schema, agendaId, diaLibreId) => {
  const agenda = await agendasModel.findById(schema, agendaId);
  if (!agenda) {
    throw new Error('Agenda no encontrada');
  }
  return await agendasModel.removeDiaLibre(schema, agendaId, diaLibreId);
};

// ============================================================
// OBTENER DÍAS LIBRES
// ============================================================
export const getDiasLibres = async (schema, agendaId) => {
  const agenda = await agendasModel.findById(schema, agendaId);
  if (!agenda) {
    throw new Error('Agenda no encontrada');
  }
  return await agendasModel.getDiasLibres(schema, agendaId);
};