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
    res.json({ success: true, data: periodontograma });
  } catch (err) {
    console.error('❌ Error en getByPatientId periodontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR PACIENTE Y FASE
// ============================================================
export const getByPatientIdAndFase = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId, fase } = req.params;
    
    // Validar fase
    const fasesValidas = ['inicial', 'seguimiento', 'alta'];
    if (!fasesValidas.includes(fase)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Fase inválida. Debe ser: inicial, seguimiento o alta' 
      });
    }

    const periodontograma = await periodontogramasService.getByPatientIdAndFase(schema, patientId, fase);
    res.json({ success: true, data: periodontograma });
  } catch (err) {
    console.error('❌ Error en getByPatientIdAndFase periodontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// GUARDAR PERIODONTOGRAMA
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

    const periodontograma = await periodontogramasService.save(schema, req.body);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'periodontogramas',
        action: 'CREATE',
        record_id: periodontograma.id,
        new_values: {
          patient_id: periodontograma.patient_id,
          teeth_count: Object.keys(periodontograma.teeth || {}).length,
          fase: req.body.fase || 'inicial'
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

    const periodontograma = await periodontogramasService.update(schema, id, req.body);

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