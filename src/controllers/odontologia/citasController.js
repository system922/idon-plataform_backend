// src/controllers/odontologia/citasController.js
import * as citasService from '../../services/odontologia/citasService.js';
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

    const { patient_id, odontologo_id, status, start_date, end_date, search } = req.query;
    
    const filters = {};
    if (patient_id) filters.patient_id = patient_id;
    if (odontologo_id) filters.odontologo_id = odontologo_id;
    if (status) filters.status = status;
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;
    if (search) filters.search = search;

    const citas = await citasService.getAll(schema, filters);
    res.json({ success: true, data: citas });
  } catch (err) {
    console.error('❌ Error en getAll citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const cita = await citasService.getById(schema, id);
    res.json({ success: true, data: cita });
  } catch (err) {
    console.error('❌ Error en getById citas:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const userId = req.user?.id || req.body.created_by;
    const cita = await citasService.create(schema, req.body, userId);

    // Auditoría
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'citas',
        action: 'CREATE',
        record_id: cita.id,
        new_values: {
          patient_id: cita.patient_id,
          odontologo_id: cita.odontologo_id,
          scheduled_for: cita.scheduled_for,
          status: cita.status,
        },
        description: `Cita creada para paciente ${cita.paciente_nombre} con odontólogo ${cita.odontologo_nombre}`
      });
    }

    res.status(201).json({
      success: true,
      data: cita,
      message: 'Cita creada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const userId = req.user?.id || req.body.created_by;

    const cita = await citasService.update(schema, id, req.body, userId);

    // Auditoría
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'citas',
        action: 'UPDATE',
        record_id: cita.id,
        new_values: req.body,
        description: `Cita actualizada para paciente ${cita.paciente_nombre}`
      });
    }

    res.json({
      success: true,
      data: cita,
      message: 'Cita actualizada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update citas:', err);
    if (err.message.includes('no encontrada')) {
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

    const cita = await citasService.getById(schema, id);
    await citasService.remove(schema, id);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'citas',
        action: 'DELETE',
        record_id: id,
        old_values: {
          patient_id: cita.patient_id,
          scheduled_for: cita.scheduled_for,
          status: cita.status,
        },
        description: `Cita eliminada para paciente ${cita.paciente_nombre}`
      });
    }

    res.json({
      success: true,
      message: 'Cita eliminada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove citas:', err);
    if (err.message.includes('no encontrada')) {
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

    const { start_date, end_date, odontologo_id } = req.query;
    const filters = {};
    if (start_date) filters.start_date = start_date;
    if (end_date) filters.end_date = end_date;
    if (odontologo_id) filters.odontologo_id = odontologo_id;

    const stats = await citasService.getStats(schema, filters);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER POR FECHA
// ============================================================
export const getByDate = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { date } = req.params;
    const citas = await citasService.getByDate(schema, date);
    res.json({ success: true, data: citas });
  } catch (err) {
    console.error('❌ Error en getByDate citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR ESTADO
// ============================================================
export const updateStatus = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user?.id;

    const cita = await citasService.updateStatus(schema, id, status);

    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'citas',
        action: 'UPDATE',
        record_id: cita.id,
        new_values: { status },
        description: `Estado de cita actualizado a: ${status}`
      });
    }

    res.json({
      success: true,
      data: cita,
      message: `Estado actualizado a: ${status}`
    });
  } catch (err) {
    console.error('❌ Error en updateStatus citas:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};