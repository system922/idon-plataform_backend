// src/controllers/odontologia/configuracionGeneralController.js
import * as configService from '../../services/odontologia/configuracionGeneralService.js';

const getSchema = (req, res) => {
  const schema = req.schema || req.headers['x-db-name'] || req.headers['x-schema-name'];
  if (!schema) {
    res.status(400).json({ success: false, error: 'Business context required' });
    return null;
  }
  return schema;
};


// ============================================================
// OBTENER HORARIO DE ATENCIÓN (SOLO INICIO Y FIN)
// ============================================================
export const getHorarioAtencion = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const config = await configService.getConfig(schema);
    
    res.json({ 
      success: true, 
      data: {
        inicio: config.intervalo_inicio || 8,
        fin: config.intervalo_fin || 18,
        duracion_turno: config.duracion_turno || 30
      }
    });
  } catch (err) {
    console.error('Error en getHorarioAtencion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER CONFIGURACIÓN
// ============================================================
export const getConfig = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const config = await configService.getConfig(schema);
    res.json({ success: true, data: config });
  } catch (err) {
    console.error('Error en getConfig:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR CONFIGURACIÓN
// ============================================================
export const updateConfig = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const config = await configService.updateConfig(schema, req.body);
    res.json({ success: true, data: config, message: 'Configuración actualizada exitosamente' });
  } catch (err) {
    console.error('Error en updateConfig:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// REINICIAR CONFIGURACIÓN
// ============================================================
export const resetConfig = async (req, res) => {
  try {
    const schema = getSchema(req, res);
    if (!schema) return;

    const config = await configService.resetConfig(schema);
    res.json({ success: true, data: config, message: 'Configuración reiniciada a valores por defecto' });
  } catch (err) {
    console.error('Error en resetConfig:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};