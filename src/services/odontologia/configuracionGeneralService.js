// src/services/odontologia/configuracionGeneralService.js
import * as configModel from '../../models/odontologia/configuracionGeneralModel.js';

// ============================================================
// OBTENER CONFIGURACIÓN
// ============================================================
export const getConfig = async (schema) => {
  try {
    return await configModel.findOrCreate(schema);
  } catch (error) {
    throw new Error(`Error al obtener configuración: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR CONFIGURACIÓN
// ============================================================
export const updateConfig = async (schema, data) => {
  try {
    // Validar datos
    if (data.duracion_turno && data.duracion_turno < 5) {
      throw new Error('La duración del turno debe ser al menos 5 minutos');
    }
    if (data.intervalo_inicio !== undefined && (data.intervalo_inicio < 0 || data.intervalo_inicio > 23)) {
      throw new Error('La hora de inicio debe estar entre 0 y 23');
    }
    if (data.intervalo_fin !== undefined && (data.intervalo_fin < 0 || data.intervalo_fin > 23)) {
      throw new Error('La hora de fin debe estar entre 0 y 23');
    }
    if (data.intervalo_inicio !== undefined && data.intervalo_fin !== undefined) {
      if (data.intervalo_inicio >= data.intervalo_fin) {
        throw new Error('La hora de inicio debe ser menor que la hora de fin');
      }
    }
    if (data.tiempo_entre_citas && data.tiempo_entre_citas < 0) {
      throw new Error('El tiempo entre citas no puede ser negativo');
    }
    if (data.recordatorio_horas && data.recordatorio_horas < 1) {
      throw new Error('El recordatorio debe ser al menos 1 hora antes');
    }

    return await configModel.updateConfig(schema, data);
  } catch (error) {
    throw new Error(`Error al actualizar configuración: ${error.message}`);
  }
};

// ============================================================
// REINICIAR A VALORES POR DEFECTO
// ============================================================
export const resetConfig = async (schema) => {
  try {
    return await configModel.resetToDefaults(schema);
  } catch (error) {
    throw new Error(`Error al reiniciar configuración: ${error.message}`);
  }
};