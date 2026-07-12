// controllers/odontologia/planesTratamientoController.js
import * as planesService from '../../services/odontologia/planesTratamientoService.js';
import { getSchemaName } from '../../utils/tenantHelper.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR PLANES
// ============================================================
export const getAll = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const planes = await planesService.getAll(schema);
    res.json({ success: true, data: Array.isArray(planes) ? planes : [] });
  } catch (err) {
    console.error('❌ Error en getAll planes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// LISTAR PLANES POR PACIENTE
// ============================================================
export const getByPatientId = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { patientId } = req.params;
    if (!patientId) return res.status(400).json({ error: 'ID de paciente requerido' });

    const planes = await planesService.getByPatientId(schema, patientId);
    res.json({ success: true, data: Array.isArray(planes) ? planes : [] });
  } catch (err) {
    console.error('❌ Error en getByPatientId planes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// OBTENER PLAN POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const plan = await planesService.getById(schema, id);
    res.json({ success: true, data: plan });
  } catch (err) {
    console.error('❌ Error en getById plan:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// CREAR PLAN
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const data = req.body;
    const plan = await planesService.create(schema, data);
    res.status(201).json({
      success: true,
      data: plan,
      message: 'Plan creado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en create plan:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ACTUALIZAR PLAN
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    const data = req.body;
    const plan = await planesService.update(schema, id, data);
    res.json({
      success: true,
      data: plan,
      message: 'Plan actualizado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en update plan:', err);
    if (err.message.includes('no encontrado')) {
      return res.status(404).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: err.message });
  }
};

// ============================================================
// ELIMINAR PLAN
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) return res.status(400).json({ error: 'Business context required' });

    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'ID requerido' });

    await planesService.remove(schema, id);
    res.json({
      success: true,
      message: 'Plan eliminado exitosamente'
    });
  } catch (err) {
    console.error('❌ Error en remove plan:', err);
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

    const stats = await planesService.getStats(schema);
    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('❌ Error en getStats planes:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};