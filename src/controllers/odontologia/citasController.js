// controllers/odontologia/citasController.js
import * as citasService from '../../services/odontologia/citasService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR CITAS
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const citas = await citasService.getAll(schema);
    res.json({ success: true, data: Array.isArray(citas) ? citas : [] });
  } catch (err) {
    console.error('❌ Error en getAll citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// LISTAR CITAS POR FECHA Y ESPECIALISTA
// ============================================================
export const getByFechaAndEspecialista = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { fecha, especialistaId } = req.query;
    if (!fecha) return res.status(400).json({ error: 'La fecha es requerida' });
    if (!especialistaId) return res.status(400).json({ error: 'El especialista es requerido' });

    const citas = await citasService.getByFechaAndEspecialista(schema, fecha, especialistaId);
    res.json({ success: true, data: citas });
  } catch (err) {
    console.error('❌ Error en getByFechaAndEspecialista:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// LISTAR CITAS POR PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const citas = await citasService.getByPatientId(schema, patientId);
    res.json({ success: true, data: citas });
  } catch (err) {
    console.error('❌ Error en getByPatientId:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER CITA POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const cita = await citasService.getById(schema, id);
    res.json({ success: true, data: cita });
  } catch (err) {
    console.error('❌ Error en getById cita:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER HORARIOS DISPONIBLES
// ============================================================
export const getHorariosDisponibles = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { especialistaId, fecha, duracion } = req.query;
    if (!especialistaId) return res.status(400).json({ error: 'Especialista requerido' });
    if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });

    const horarios = await citasService.getHorariosDisponibles(
      schema,
      especialistaId,
      fecha,
      duracion ? parseInt(duracion) : 30
    );
    res.json({ success: true, data: horarios });
  } catch (err) {
    console.error('❌ Error en getHorariosDisponibles:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR CITA
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const cita = await citasService.create(schema, data);
    res.status(201).json({
      success: true,
      data: cita,
      message: 'Cita creada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create cita:', err);
    if (err.message.includes('disponible')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR CITA
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const cita = await citasService.update(schema, id, data);
    res.json({
      success: true,
      data: cita,
      message: 'Cita actualizada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update cita:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    if (err.message.includes('disponible')) {
      return res.status(409).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR ESTADO DE CITA
// ============================================================
export const updateStatus = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Estado requerido' });

    const cita = await citasService.updateStatus(schema, id, status);
    res.json({
      success: true,
      data: cita,
      message: 'Estado de cita actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en updateStatus cita:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR CITA
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await citasService.remove(schema, id);
    res.json({
      success: true,
      message: 'Cita eliminada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove cita:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ESTADÍSTICAS DE CITAS
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const stats = await citasService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats citas:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};