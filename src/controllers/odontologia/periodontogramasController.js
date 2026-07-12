// src/services/odontologia/periodontogramasService.js
import * as periodontogramasModel from '../../models/odontologia/periodontogramasModel.js';

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (schema) => {
  try {
    return await periodontogramasModel.findAll(schema);
  } catch (error) {
    throw new Error(`Error al listar periodontogramas: ${error.message}`);
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
    const periodontograma = await periodontogramasModel.findById(schema, id);
    if (!periodontograma) {
      throw new Error('Periodontograma no encontrado');
    }
    return periodontograma;
  } catch (error) {
    throw new Error(`Error al obtener periodontograma: ${error.message}`);
  }
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const getByPatientId = async (schema, patientId) => {
  try {
    if (!patientId) {
      throw new Error('El ID del paciente es obligatorio');
    }
    return await periodontogramasModel.findByPatientId(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener periodontograma del paciente: ${error.message}`);
  }
};

// ============================================================
// GUARDAR PERIODONTOGRAMA
// ============================================================
export const save = async (schema, data) => {
  try {
    const { patient_id, teeth, patient_info, notas } = data;

    if (!patient_id) {
      throw new Error('El ID del paciente es obligatorio');
    }

    // Verificar si ya existe un periodontograma para este paciente
    const existing = await periodontogramasModel.findByPatientId(schema, patient_id);

    if (existing) {
      // Actualizar existente
      return await periodontogramasModel.updateById(schema, existing.id, {
        teeth: teeth || {},
        patient_info: patient_info || {},
        notas: notas || '',
        last_saved_at: new Date().toISOString()
      });
    } else {
      // Crear nuevo
      return await periodontogramasModel.insert(schema, {
        patient_id,
        teeth: teeth || {},
        patient_info: patient_info || {},
        notas: notas || ''
      });
    }
  } catch (error) {
    throw new Error(`Error al guardar periodontograma: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR PERIODONTOGRAMA
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) {
      throw new Error('El ID es obligatorio');
    }

    const existing = await periodontogramasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Periodontograma no encontrado');
    }

    return await periodontogramasModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar periodontograma: ${error.message}`);
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

    const existing = await periodontogramasModel.findById(schema, id);
    if (!existing) {
      throw new Error('Periodontograma no encontrado');
    }

    return await periodontogramasModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar periodontograma: ${error.message}`);
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (schema) => {
  try {
    return await periodontogramasModel.getStats(schema);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};