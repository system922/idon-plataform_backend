// services/odontologia/planesTratamientoService.js
import * as planesModel from '../../models/odontologia/planesTratamientoModel.js';
import * as odontogramasService from './odontogramasService.js';

export const getAll = async (schema) => {
  try {
    return await planesModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar planes: ${error.message}`);
  }
};

export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    return await planesModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener planes del paciente: ${error.message}`);
  }
};

export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const plan = await planesModel.findById(schema, id);
    if (!plan) throw new Error('Plan no encontrado');
    return plan;
  } catch (error) {
    throw new Error(`Error al obtener plan: ${error.message}`);
  }
};

export const create = async (schema, data) => {
  try {
    if (!data.patient_id) throw new Error('El paciente es obligatorio');
    if (!data.name) throw new Error('El nombre del plan es obligatorio');
    
    // Create the plan
    const newPlan = await planesModel.insert(schema, data);
    
    // Update the initial odontogram (fase 'inicial') to set plan_id
    try {
      await odontogramasService.save(schema, {
        patient_id: data.patient_id,
        fase: 'inicial',
        teeth: {}, // This won't overwrite existing teeth because save function handles existing
        plan_id: newPlan.id,
        plan_tratamiento: data.odontograma_data?.planTratamiento || []
      });
      
      // Also update the evolution odontogram
      await odontogramasService.save(schema, {
        patient_id: data.patient_id,
        fase: 'evolucion',
        teeth: {},
        plan_id: newPlan.id,
        plan_tratamiento: data.odontograma_data?.planTratamiento || []
      });
    } catch (odontogramError) {
      console.error('Error updating odontogram when creating plan:', odontogramError);
      // We don't throw here because the plan was created successfully
    }
    
    return newPlan;
  } catch (error) {
    throw new Error(`Error al crear plan: ${error.message}`);
  }
};

export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await planesModel.findById(schema, id);
    if (!existing) throw new Error('Plan no encontrado');
    return await planesModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar plan: ${error.message}`);
  }
};

export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await planesModel.findById(schema, id);
    if (!existing) throw new Error('Plan no encontrado');
    return await planesModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar plan: ${error.message}`);
  }
};

export const getStats = async (schema) => {
  try {
    return await planesModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};