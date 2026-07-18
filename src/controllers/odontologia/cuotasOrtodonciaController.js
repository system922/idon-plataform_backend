// controllers/odontologia/cuotasOrtodonciaController.js
import { getSchemaName } from '../../utils/tenantHelper.js';
import * as cuotasService from '../../services/odontologia/cuotasOrtodonciaService.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR CUOTAS DE UN PLAN
// ============================================================
export const getAllByPlan = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { planId } = req.params;
    console.log('📦 [getAllByPlan] planId:', planId);

    if (!planId) {
      return res.status(400).json({ success: false, error: 'planId es requerido' });
    }

    const cuotas = await cuotasService.getAllByPlan(schema, planId);
    console.log('✅ [getAllByPlan] Cuotas encontradas:', cuotas.length);

    res.json({
      success: true,
      data: cuotas,
    });
  } catch (err) {
    console.error('❌ Error en getAllByPlan:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// OBTENER CUOTA POR ID
// ============================================================
export const getById = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    const cuota = await cuotasService.getById(schema, id);
    if (!cuota) {
      return res.status(404).json({ success: false, error: 'Cuota no encontrada' });
    }

    res.json({
      success: true,
      data: cuota,
    });
  } catch (err) {
    console.error('❌ Error en getById:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// ACTUALIZAR ESTADO DE CUOTA
// ============================================================
export const updateEstado = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    const { estado, pago_id } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }
    if (!estado) {
      return res.status(400).json({ success: false, error: 'estado es requerido' });
    }

    const cuota = await cuotasService.updateEstado(schema, id, estado, pago_id);

    res.json({
      success: true,
      data: cuota,
      message: 'Estado de cuota actualizado',
    });
  } catch (err) {
    console.error('❌ Error en updateEstado:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// ELIMINAR CUOTA
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    await cuotasService.remove(schema, id);

    res.json({
      success: true,
      message: 'Cuota eliminada exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en remove:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};