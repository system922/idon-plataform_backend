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
// OBTENER POR PACIENTE Y FASE
// ============================================================
export const getByPatientIdAndFase = async (schema, patientId, fase) => {
  try {
    if (!patientId) {
      throw new Error('El ID del paciente es obligatorio');
    }
    if (!fase) {
      throw new Error('La fase es obligatoria');
    }

    const periodontograma = await periodontogramasModel.findByPatientIdAndFase(schema, patientId, fase);
    
    if (!periodontograma) {
      return {
        id: null,
        patient_id: patientId,
        fase: fase,
        teeth: {},
        patient_info: {},
        notas: '',
        last_saved_at: null
      };
    }
    
    return periodontograma;
  } catch (error) {
    throw new Error(`Error al obtener periodontograma por paciente y fase: ${error.message}`);
  }
};

// ============================================================
// GUARDAR PERIODONTOGRAMA
// ============================================================
export const save = async (schema, data) => {
  try {
    const { patient_id, teeth, patient_info, notas, fase } = data;

    if (!patient_id) {
      throw new Error('El ID del paciente es obligatorio');
    }

    // Verificar si ya existe un periodontograma para este paciente
    const existing = await periodontogramasModel.findByPatientId(schema, patient_id);

    // Si existe y viene fase, buscar por fase
    if (existing && fase) {
      const existingByFase = await periodontogramasModel.findByPatientIdAndFase(schema, patient_id, fase);
      if (existingByFase) {
        return await periodontogramasModel.updateById(schema, existingByFase.id, {
          teeth: teeth || {},
          patient_info: patient_info || {},
          notas: notas || '',
          last_saved_at: new Date().toISOString(),
          fase: fase
        });
      }
    }

    if (existing) {
      // Actualizar existente
      return await periodontogramasModel.updateById(schema, existing.id, {
        teeth: teeth || {},
        patient_info: patient_info || {},
        notas: notas || '',
        last_saved_at: new Date().toISOString(),
        fase: fase || 'inicial'
      });
    } else {
      // Crear nuevo
      return await periodontogramasModel.insert(schema, {
        patient_id,
        teeth: teeth || {},
        patient_info: patient_info || {},
        notas: notas || '',
        fase: fase || 'inicial'
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