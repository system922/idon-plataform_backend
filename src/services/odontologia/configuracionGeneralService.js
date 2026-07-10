// src/services/odontologia/configuracionGeneralService.js
import * as configModel from '../../models/odontologia/configuracionGeneralModel.js';

// ============================================================
// OBTENER CONFIGURACIÓN
// ============================================================
export const getConfig = async (schema) => {
  return await configModel.findOrCreate(schema);
};

// ============================================================
// ACTUALIZAR CONFIGURACIÓN
// ============================================================
export const updateConfig = async (schema, data) => {
  return await configModel.updateConfig(schema, data);
};

// ============================================================
// REINICIAR A VALORES POR DEFECTO
// ============================================================
export const resetConfig = async (schema) => {
  return await configModel.resetToDefaults(schema);
};