// src/controllers/odontologia/periodontogramasController.js
import * as periodontogramasService from '../../services/odontologia/periodontogramasService.js';
import * as auditLogService from '../../services/auditLogService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR TODOS
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const periodontogramas = await periodontogramasService.getAll(schema);
    res.json({ success: true, data: periodontogramas });
  } catch (err) {
    console.error('❌ Error en getAll periodontogramas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    const periodontograma = await periodontogramasService.getByPatientId(schema, patientId);
    
    if (!periodontograma) {
      return res.status(200).json({ 
        success: true, 
        data: null,
        message: 'No hay periodontograma para este paciente'
      });
    }
    
    res.json({ success: true, data: periodontograma });
  } catch (err) {
    console.error('❌ Error en getByPatientId periodontogramas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// GUARDAR PERIODONTOGRAMA - CORREGIDO
// ============================================================
export const savePeriodontograma = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId = req.user?.id || req.body.created_by;
    
    // Validar datos requeridos
    if (!req.body.patient_id) {
      return res.status(400).json({ success: false, error: 'El ID del paciente es requerido' });
    }

    // 🔥 Asegurarse de que NO se envía 'fase'
    const dataToSave = {
      patient_id: req.body.patient_id,
      teeth: req.body.teeth || {},
      patient_info: req.body.patient_info || {},
      notas: req.body.notas || '',
    };

    const periodontograma = await periodontogramasService.save(schema, dataToSave);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'periodontogramas',
        action: 'CREATE',
        record_id: periodontograma.id,
        new_values: {
          patient_id: periodontograma.patient_id,
          teeth_count: Object.keys(periodontograma.teeth || {}).length,
        },
        description: `Periodontograma guardado para paciente ${periodontograma.patient_id}`
      });
    }

    res.status(201).json({
      success: true,
      data: periodontograma,
      message: 'Periodontograma guardado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en savePeriodontograma:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR PERIODONTOGRAMA
// ============================================================
export const updatePeriodontograma = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id || req.body.updated_by;

    // 🔥 Asegurarse de que NO se envía 'fase'
    const dataToUpdate = {
      teeth: req.body.teeth,
      patient_info: req.body.patient_info,
      notas: req.body.notas,
      last_saved_at: new Date().toISOString()
    };

    const periodontograma = await periodontogramasService.update(schema, id, dataToUpdate);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'periodontogramas',
        action: 'UPDATE',
        record_id: periodontograma.id,
        new_values: req.body,
        description: `Periodontograma actualizado para paciente ${periodontograma.patient_id}`
      });
    }

    res.json({
      success: true,
      data: periodontograma,
      message: 'Periodontograma actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updatePeriodontograma:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id;

    const periodontograma = await periodontogramasService.getById(schema, id);
    await periodontogramasService.remove(schema, id);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'periodontogramas',
        action: 'DELETE',
        record_id: id,
        old_values: {
          patient_id: periodontograma.patient_id,
        },
        description: `Periodontograma eliminado para paciente ${periodontograma.patient_id}`
      });
    }

    res.json({
      success: true,
      message: 'Periodontograma eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove periodontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ESTADÍSTICAS
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const stats = await periodontogramasService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats periodontogramas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};