// controllers/odontologia/evolucionesClinicasController.js
import * as evolucionesService from '../../services/odontologia/evolucionesClinicasService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR EVOLUCIONES POR PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const evoluciones = await evolucionesService.getAllByPatient(schema, patientId);
    res.json({ success: true, data: evoluciones });
  } catch (err) {
    console.error('❌ Error en getByPatientId evoluciones:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// LISTAR EVOLUCIONES POR PLAN
// ============================================================
export const getByPlanId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { planId } = req.params;
    if (!planId) return res.status(400).json({ error: 'ID de plan requerido' });

    const evoluciones = await evolucionesService.getByPlan(schema, planId);
    res.json({ success: true, data: evoluciones });
  } catch (err) {
    console.error('❌ Error en getByPlanId evoluciones:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER EVOLUCIÓN COMPLETA (Inicial + Evolución)
// ============================================================
export const getEvolucionCompleta = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const evolucionCompleta = await evolucionesService.getEvolucionCompleta(schema, patientId);
    res.json({ success: true, data: evolucionCompleta });
  } catch (err) {
    console.error('❌ Error en getEvolucionCompleta:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER ESTADO DE DIENTE
// ============================================================
export const getEstadoDiente = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId, toothNumber } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });
    if (!toothNumber) return res.status(400).json({ error: 'Número de diente requerido' });

    const estado = await evolucionesService.getEstadoDiente(schema, patientId, parseInt(toothNumber));
    res.json({ success: true, data: estado });
  } catch (err) {
    console.error('❌ Error en getEstadoDiente:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR EVOLUCIÓN
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const evolucion = await evolucionesService.create(schema, data);
    res.status(201).json({
      success: true,
      data: evolucion,
      message: 'Evolución clínica registrada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create evolucion:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR EVOLUCIÓN
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const evolucion = await evolucionesService.update(schema, id, data);
    res.json({
      success: true,
      data: evolucion,
      message: 'Evolución actualizada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update evolucion:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR EVOLUCIÓN
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await evolucionesService.remove(schema, id);
    res.json({
      success: true,
      message: 'Evolución eliminada exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove evolucion:', err);
    if (err.message.includes('no encontrada')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};