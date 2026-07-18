// services/odontologia/planPagosOrtodonciaService.js
import { query } from '../../config/database.js';
import * as planModel from '../../models/odontologia/planPagosOrtodonciaModel.js';
import * as cuotasModel from '../../models/odontologia/cuotasOrtodonciaModel.js';

// ============================================================
// LISTAR PLANES POR PACIENTE
// ============================================================
export const getAllByPatient = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    return await planModel.findAllByPatient(schema, patientId);
  } catch (error) {
    throw new Error(`Error al listar planes: ${error.message}`);
  }
};

// ============================================================
// LISTAR PLANES POR ORTODONCIA
// ============================================================
export const getAllByOrtodoncia = async (schema, ortodonciaId) => {
  try {
    if (!ortodonciaId) throw new Error('El ID de ortodoncia es obligatorio');
    return await planModel.findAllByOrtodoncia(schema, ortodonciaId);
  } catch (error) {
    throw new Error(`Error al listar planes: ${error.message}`);
  }
};

// ============================================================
// OBTENER PLAN POR ID
// ============================================================
export const getById = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const plan = await planModel.findById(schema, id);
    if (!plan) throw new Error('Plan no encontrado');
    return plan;
  } catch (error) {
    throw new Error(`Error al obtener plan: ${error.message}`);
  }
};

// ============================================================
// OBTENER PLAN ACTIVO POR PACIENTE
// ============================================================
export const getActiveByPatient = async (schema, patientId) => {
  try {
    if (!patientId) throw new Error('El ID del paciente es obligatorio');
    return await planModel.findActiveByPatient(schema, patientId);
  } catch (error) {
    throw new Error(`Error al obtener plan activo: ${error.message}`);
  }
};

// ============================================================
// CREAR PLAN CON CUOTAS
// ============================================================
export const create = async (schema, data) => {
  try {
    if (!data.paciente_id) throw new Error('El paciente es obligatorio');
    if (!data.monto_total || data.monto_total <= 0) throw new Error('El monto total debe ser mayor a 0');
    if (!data.numero_cuotas || data.numero_cuotas <= 0) throw new Error('El número de cuotas debe ser mayor a 0');

    // Verificar que el paciente existe
    const pacienteCheck = await query(
      `SELECT id FROM "${schema}".pacientes WHERE id = $1 AND deleted_at IS NULL`,
      [data.paciente_id]
    );
    if (pacienteCheck.rows.length === 0) {
      throw new Error('Paciente no encontrado');
    }

    // Si hay ortodoncia_id, verificar que existe
    if (data.ortodoncia_id) {
      const ortodonciaCheck = await query(
        `SELECT id FROM "${schema}".ortodoncias WHERE id = $1 AND deleted_at IS NULL`,
        [data.ortodoncia_id]
      );
      if (ortodonciaCheck.rows.length === 0) {
        throw new Error('Registro de ortodoncia no encontrado');
      }
    }

    // Calcular monto mensual si no se especifica
    const montoMensual = data.monto_mensual || (data.monto_total / data.numero_cuotas);

    // Crear el plan
    const planData = {
      ...data,
      monto_mensual: montoMensual,
      saldo_restante: data.monto_total - (data.abono_inicial || 0),
      cuotas_pagadas: data.abono_inicial > 0 ? 1 : 0,
    };

    const plan = await planModel.insert(schema, planData);

    // Generar cuotas
    const cuotas = [];
    const fechaInicio = data.fecha_inicio ? new Date(data.fecha_inicio) : new Date();

    for (let i = 0; i < data.numero_cuotas; i++) {
      const fechaVencimiento = new Date(fechaInicio);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);

      cuotas.push({
        plan_id: plan.id,
        numero_cuota: i + 1,
        monto: montoMensual,
        fecha_vencimiento: fechaVencimiento,
        estado: 'pendiente',
        notas: `Cuota ${i + 1} de ${data.numero_cuotas}`,
        created_at: new Date(),
      });
    }

    // Si hay abono inicial, marcar la primera cuota como pagada
    if (data.abono_inicial > 0 && cuotas.length > 0) {
      cuotas[0].estado = 'pagado';
      cuotas[0].fecha_pago = new Date();
    }

    await cuotasModel.insertMany(schema, cuotas);

    return plan;
  } catch (error) {
    throw new Error(`Error al crear plan: ${error.message}`);
  }
};

// ============================================================
// ACTUALIZAR PLAN
// ============================================================
export const update = async (schema, id, data) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await planModel.findById(schema, id);
    if (!existing) throw new Error('Plan no encontrado');
    return await planModel.updateById(schema, id, data);
  } catch (error) {
    throw new Error(`Error al actualizar plan: ${error.message}`);
  }
};

// ============================================================
// ELIMINAR PLAN
// ============================================================
export const remove = async (schema, id) => {
  try {
    if (!id) throw new Error('El ID es obligatorio');
    const existing = await planModel.findById(schema, id);
    if (!existing) throw new Error('Plan no encontrado');
    
    // Eliminar cuotas asociadas
    await cuotasModel.softDeleteByPlan(schema, id);
    return await planModel.softDelete(schema, id);
  } catch (error) {
    throw new Error(`Error al eliminar plan: ${error.message}`);
  }
};

// ============================================================
// REGISTRAR PAGO DE CUOTA
// ============================================================
export const registrarPago = async (schema, planId, cuotaId, monto, metodoPago, referencia) => {
  try {
    if (!planId) throw new Error('El ID del plan es obligatorio');
    if (!cuotaId) throw new Error('El ID de la cuota es obligatorio');
    if (!monto || monto <= 0) throw new Error('El monto debe ser mayor a 0');

    const plan = await planModel.findById(schema, planId);
    if (!plan) throw new Error('Plan no encontrado');

    const cuota = await cuotasModel.findById(schema, cuotaId);
    if (!cuota) throw new Error('Cuota no encontrada');
    if (cuota.estado === 'pagado') throw new Error('Esta cuota ya fue pagada');

    // Registrar en la tabla de pagos (si existe) o simplemente actualizar la cuota
    // Aquí se puede integrar con la tabla de pagos general

    // Actualizar cuota
    await cuotasModel.updateEstado(schema, cuotaId, 'pagado');

    // Actualizar saldo del plan
    await planModel.updateSaldo(schema, planId, monto);

    return await planModel.findById(schema, planId);
  } catch (error) {
    throw new Error(`Error al registrar pago: ${error.message}`);
  }
};

// ============================================================
// OBTENER ESTADÍSTICAS DEL PLAN
// ============================================================
export const getStats = async (schema, planId) => {
  try {
    if (!planId) throw new Error('El ID del plan es obligatorio');
    return await planModel.getStats(schema, planId);
  } catch (error) {
    throw new Error(`Error al obtener estadísticas: ${error.message}`);
  }
};

// ============================================================
// GENERAR CUOTAS (re-generar si es necesario)
// ============================================================
export const generarCuotas = async (schema, planId) => {
  try {
    const plan = await planModel.findById(schema, planId);
    if (!plan) throw new Error('Plan no encontrado');

    // Eliminar cuotas existentes
    await cuotasModel.softDeleteByPlan(schema, planId);

    // Generar nuevas cuotas
    const cuotas = [];
    const fechaInicio = plan.fecha_inicio ? new Date(plan.fecha_inicio) : new Date();
    const montoMensual = plan.monto_mensual || (plan.monto_total / plan.numero_cuotas);

    for (let i = 0; i < plan.numero_cuotas; i++) {
      const fechaVencimiento = new Date(fechaInicio);
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i);

      cuotas.push({
        plan_id: plan.id,
        numero_cuota: i + 1,
        monto: montoMensual,
        fecha_vencimiento: fechaVencimiento,
        estado: 'pendiente',
        notas: `Cuota ${i + 1} de ${plan.numero_cuotas}`,
        created_at: new Date(),
      });
    }

    return await cuotasModel.insertMany(schema, cuotas);
  } catch (error) {
    throw new Error(`Error al generar cuotas: ${error.message}`);
  }
};