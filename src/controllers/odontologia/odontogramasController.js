// src/controllers/odontologia/odontogramasController.js
import * as odontogramasService from '../../services/odontologia/odontogramasService.js';
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

    const odontogramas = await odontogramasService.getAll(schema);
    res.json({ success: true, data: odontogramas });
  } catch (err) {
    console.error('❌ Error en getAll odontogramas:', err);
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
    const odontogramas = await odontogramasService.getByPatientId(schema, patientId);
    res.json({ success: true, data: odontogramas });
  } catch (err) {
    console.error('❌ Error en getByPatientId odontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR PACIENTE Y FASE
// ============================================================
export const getByPatientAndFase = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId, fase } = req.params;
    
    // Validar fase
    const fasesValidas = ['inicial', 'evolucion', 'alta'];
    if (!fasesValidas.includes(fase)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Fase inválida. Debe ser: inicial, evolucion o alta' 
      });
    }

    const odontograma = await odontogramasService.getByPatientAndFase(schema, patientId, fase);
    res.json({ success: true, data: odontograma });
  } catch (err) {
    console.error('❌ Error en getByPatientAndFase odontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR PLAN DE TRATAMIENTO
// ============================================================
export const getByPlanId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { planId } = req.params;
    const odontograma = await odontogramasService.getByPlanId(schema, planId);
    res.json({ success: true, data: odontograma });
  } catch (err) {
    console.error('❌ Error en getByPlanId odontogramas:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// GUARDAR ODONTOGRAMA
// ============================================================
export const saveOdontograma = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId = req.user?.id || req.body.created_by;
    
    // Validar datos requeridos
    if (!req.body.patient_id) {
      return res.status(400).json({ success: false, error: 'El ID del paciente es requerido' });
    }
    if (!req.body.fase) {
      return res.status(400).json({ success: false, error: 'La fase es requerida' });
    }

    const odontograma = await odontogramasService.save(schema, req.body);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'odontogramas',
        action: 'CREATE',
        record_id: odontograma.id,
        new_values: {
          patient_id: odontograma.patient_id,
          fase: odontograma.fase,
          teeth_count: Object.keys(odontograma.teeth || {}).length,
          plan_count: (odontograma.plan_tratamiento || []).length,
        },
        description: `Odontograma ${odontograma.fase} guardado para paciente ${odontograma.patient_id}`
      });
    }

    res.status(201).json({
      success: true,
      data: odontograma,
      message: `Odontograma ${odontograma.fase} guardado exitosamente`
    });
  } catch (err) {
    console.error('❌ Error en saveOdontograma:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR ODONTOGRAMA
// ============================================================
export const updateOdontograma = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id || req.body.updated_by;

    const odontograma = await odontogramasService.update(schema, id, req.body);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'odontogramas',
        action: 'UPDATE',
        record_id: odontograma.id,
        new_values: req.body,
        description: `Odontograma ${odontograma.fase} actualizado`
      });
    }

    res.json({
      success: true,
      data: odontograma,
      message: 'Odontograma actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updateOdontograma:', err);
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

    const odontograma = await odontogramasService.getById(schema, id);
    await odontogramasService.remove(schema, id);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'odontogramas',
        action: 'DELETE',
        record_id: id,
        old_values: {
          patient_id: odontograma.patient_id,
          fase: odontograma.fase,
        },
        description: `Odontograma ${odontograma.fase} eliminado`
      });
    }

    res.json({
      success: true,
      message: 'Odontograma eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove odontogramas:', err);
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

    const stats = await odontogramasService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats odontogramas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SINCRONIZAR DESDE INICIAL
// ============================================================
export const syncFromInicial = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.body;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'El ID del paciente es requerido' });
    }

    const result = await odontogramasService.syncFromInicial(schema, patientId);
    
    res.json({
      success: true,
      data: result,
      message: 'Sincronización desde Inicial completada'
    });
  } catch (err) {
    console.error('❌ Error en syncFromInicial:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// SINCRONIZAR DESDE EVOLUCION
// ============================================================
export const syncFromEvolucion = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.body;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'El ID del paciente es requerido' });
    }

    const result = await odontogramasService.syncFromEvolucion(schema, patientId);
    
    res.json({
      success: true,
      data: result,
      message: 'Sincronización desde Evolución completada'
    });
  } catch (err) {
    console.error('❌ Error en syncFromEvolucion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};