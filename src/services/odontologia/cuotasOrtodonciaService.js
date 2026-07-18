// services/odontologia/cuotasOrtodonciaService.js
import * as cuotasModel from '../../models/odontologia/cuotasOrtodonciaModel.js';

// ============================================================
// LISTAR CUOTAS DE UN PLAN
// ============================================================
export const getAllByPlan = async (schema, planId) => {
  try {
    if (!planId) {
      throw new Error('El ID del plan es obligatorio');
    }
    return await cuotasModel.findAllByPlan(schema, planId);
  } catch (error) {
    throw new Error(`Error al listar cuotas: ${error.message}`);
  }
};

// ============================================================
// OBTENER CUOTA POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    const cuota = await cuotasModel.findById(schema, id);
    if (!cuota) {
      throw new Error('Cuota no encontrada');
    }
    return cuota;
  } catch (error) {
    throw new Error(`Error al obtener cuota: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR ESTADO DE CUOTA
// ============================================================
export const updateEstado = async (schema, id, estado, pagoId) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    const existing = await cuotasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Cuota no encontrada');
    }
    return await cuotasModel.updateEstado(schema, id, estado, pagoId);
  } catch (error) {
    throw new Error(`Error al actualizar estado: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR CUOTA
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }
    const existing = await cuotasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Cuota no encontrada');
    }
    return await cuotasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar cuota: ${error.message}`);
  }
};