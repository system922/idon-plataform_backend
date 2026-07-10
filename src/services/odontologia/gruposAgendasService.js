// src/services/odontologia/horariosTrabajoService.js
import * as horariosModel from '../../models/odontologia/horariosTrabajoModel.js';

const DIAS_VALIDOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  return await horariosModel.findAll(schema);
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (schema, id) => {
  return await horariosModel.findById(schema, id);
};

// ============================================================
// OBTENER POR DÍA
// ============================================================
export const getByDia = async (schema, dia) => {
  return await horariosModel.findByDia(schema, dia);
};

// ============================================================
// INICIALIZAR HORARIOS POR DEFECTO
// ============================================================
export const initDefaults = async (schema) => {
  return await horariosModel.initDefaultHorarios(schema);
};

// ============================================================
// CREAR
// ============================================================
export const create = async (schema, data) => {
  if (!data.dia) {
    throw new Error('El día es obligatorio');
  }
  if (!DIAS_VALIDOS.includes(data.dia)) {
    throw new Error(`Día inválido. Debe ser uno de: ${DIAS_VALIDOS.join(', ')}`);
  }
  return await horariosModel.insert(schema, data);
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (schema, id, data) => {
  const existing = await horariosModel.findById(schema, id);
  if (!existing) {
    throw new Error('Horario no encontrado');
  }
  return await horariosModel.updateById(schema, id, data);
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (schema, id) => {
  const existing = await horariosModel.findById(schema, id);
  if (!existing) {
    throw new Error('Horario no encontrado');
  }
  return await horariosModel.softDelete(schema, id);
};