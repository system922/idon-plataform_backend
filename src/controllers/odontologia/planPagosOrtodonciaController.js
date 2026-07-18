// controllers/odontologia/planPagosOrtodonciaController.js
import { getSchemaName } from '../../utils/tenantHelper.js';
import * as planPagosService from '../../services/odontologia/planPagosOrtodonciaService.js';
import * as auditLogService from '../../services/auditLogService.js';

const getSchema = async (req) => {
  return await getSchemaName(req);
};

// ============================================================
// LISTAR PLANES POR PACIENTE
// ============================================================
export const getAllByPatient = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { patientId } = req.params;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'patientId es requerido' });
    }

    const planes = await planPagosService.getAllByPatient(schema, patientId);
    res.json({
      success: true,
      data: planes,
    });
  } catch (err) {
    console.error('❌ Error en getAllByPatient:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// LISTAR PLANES POR ORTODONCIA
// ============================================================
export const getAllByOrtodoncia = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { ortodonciaId } = req.params;
    if (!ortodonciaId) {
      return res.status(400).json({ success: false, error: 'ortodonciaId es requerido' });
    }

    const planes = await planPagosService.getAllByOrtodoncia(schema, ortodonciaId);
    res.json({
      success: true,
      data: planes,
    });
  } catch (err) {
    console.error('❌ Error en getAllByOrtodoncia:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// OBTENER PLAN ACTIVO POR PACIENTE
// ============================================================
export const getActiveByPatient = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { patientId } = req.params;
    if (!patientId) {
      return res.status(400).json({ success: false, error: 'patientId es requerido' });
    }

    const plan = await planPagosService.getActiveByPatient(schema, patientId);
    res.json({
      success: true,
      data: plan || null,
    });
  } catch (err) {
    console.error('❌ Error en getActiveByPatient:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// OBTENER PLAN POR ID
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

    const plan = await planPagosService.getById(schema, id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    }

    res.json({
      success: true,
      data: plan,
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
// CREAR PLAN
// ============================================================
export const create = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const userId = req.user?.id || req.body.user_id;
    const data = req.body;

    // Validaciones
    if (!data.paciente_id) {
      return res.status(400).json({ success: false, error: 'paciente_id es requerido' });
    }
    if (!data.monto_total || data.monto_total <= 0) {
      return res.status(400).json({ success: false, error: 'monto_total debe ser mayor a 0' });
    }
    if (!data.numero_cuotas || data.numero_cuotas <= 0) {
      return res.status(400).json({ success: false, error: 'numero_cuotas debe ser mayor a 0' });
    }

    const plan = await planPagosService.create(schema, data);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'plan_pagos_ortodoncia',
        action: 'CREATE',
        record_id: plan.id,
        new_values: {
          paciente_id: plan.paciente_id,
          nombre: plan.nombre,
          monto_total: plan.monto_total,
          numero_cuotas: plan.numero_cuotas,
          estado: plan.estado,
        },
        description: `Plan de pagos creado: ${plan.nombre} - $${plan.monto_total}`,
      });
    }

    res.status(201).json({
      success: true,
      data: plan,
      message: 'Plan de pagos creado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en create:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// ACTUALIZAR PLAN
// ============================================================
export const update = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    const userId = req.user?.id || req.body.user_id;
    const data = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    const planActual = await planPagosService.getById(schema, id);
    if (!planActual) {
      return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    }

    const plan = await planPagosService.update(schema, id, data);

    // --- Registrar auditoría ---
    if (userId) {
      const camposCambiados = [];
      ['nombre', 'monto_total', 'numero_cuotas', 'estado'].forEach(campo => {
        if (data[campo] !== undefined && data[campo] !== planActual[campo]) {
          camposCambiados.push(campo);
        }
      });

      if (camposCambiados.length > 0) {
        await auditLogService.createAuditLog(schema, {
          user_id: userId,
          table_name: 'plan_pagos_ortodoncia',
          action: 'UPDATE',
          record_id: plan.id,
          old_values: {
            nombre: planActual.nombre,
            monto_total: planActual.monto_total,
            estado: planActual.estado,
          },
          new_values: {
            nombre: plan.nombre,
            monto_total: plan.monto_total,
            estado: plan.estado,
          },
          description: `Plan actualizado - Campos: ${camposCambiados.join(', ')}`,
        });
      }
    }

    res.json({
      success: true,
      data: plan,
      message: 'Plan actualizado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en update:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// ELIMINAR PLAN
// ============================================================
export const remove = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    const userId = req.user?.id || req.body.user_id;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    const plan = await planPagosService.getById(schema, id);
    if (!plan) {
      return res.status(404).json({ success: false, error: 'Plan no encontrado' });
    }

    await planPagosService.remove(schema, id);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'plan_pagos_ortodoncia',
        action: 'DELETE',
        record_id: id,
        old_values: {
          paciente_id: plan.paciente_id,
          nombre: plan.nombre,
          monto_total: plan.monto_total,
        },
        description: `Plan de pagos eliminado: ${plan.nombre}`,
      });
    }

    res.json({
      success: true,
      message: 'Plan eliminado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en remove:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// ESTADÍSTICAS DEL PLAN
// ============================================================
export const getStats = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'ID requerido' });
    }

    const stats = await planPagosService.getStats(schema, id);
    res.json({
      success: true,
      data: stats,
    });
  } catch (err) {
    console.error('❌ Error en getStats:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// REGISTRAR PAGO DE CUOTA
// ============================================================
export const registrarPago = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    const userId = req.user?.id || req.body.user_id;
    const { cuota_id, monto, metodo_pago, referencia } = req.body;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID del plan requerido' });
    }
    if (!cuota_id) {
      return res.status(400).json({ success: false, error: 'cuota_id es requerido' });
    }
    if (!monto || monto <= 0) {
      return res.status(400).json({ success: false, error: 'monto debe ser mayor a 0' });
    }

    const plan = await planPagosService.registrarPago(
      schema, 
      id, 
      cuota_id, 
      monto, 
      metodo_pago || 'efectivo', 
      referencia || ''
    );

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'cuotas_ortodoncia',
        action: 'UPDATE',
        record_id: cuota_id,
        new_values: {
          estado: 'pagado',
          monto: monto,
          metodo_pago: metodo_pago || 'efectivo',
        },
        description: `Pago registrado - Cuota ${cuota_id} - $${monto}`,
      });
    }

    res.json({
      success: true,
      data: plan,
      message: 'Pago registrado exitosamente',
    });
  } catch (err) {
    console.error('❌ Error en registrarPago:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// ============================================================
// GENERAR CUOTAS
// ============================================================
export const generarCuotas = async (req, res) => {
  try {
    const schema = await getSchema(req);
    if (!schema) {
      return res.status(400).json({ success: false, error: 'Business context required' });
    }

    const { id } = req.params;
    const userId = req.user?.id || req.body.user_id;

    if (!id) {
      return res.status(400).json({ success: false, error: 'ID del plan requerido' });
    }

    const cuotas = await planPagosService.generarCuotas(schema, id);

    // --- Registrar auditoría ---
    if (userId) {
      await auditLogService.createAuditLog(schema, {
        user_id: userId,
        table_name: 'cuotas_ortodoncia',
        action: 'CREATE',
        record_id: id,
        new_values: {
          total_cuotas: cuotas.length,
        },
        description: `Cuotas generadas para el plan: ${cuotas.length} cuotas`,
      });
    }

    res.json({
      success: true,
      data: cuotas,
      message: `Cuotas generadas exitosamente (${cuotas.length} cuotas)`,
    });
  } catch (err) {
    console.error('❌ Error en generarCuotas:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};