// models/odontologia/planPagosOrtodonciaModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR PLANES DE PAGOS POR PACIENTE
// ============================================================
export const findAllByPatient = async (schema, patientId) => {
  const sql = `
    SELECT 
      p.id,
      p.paciente_id,
      p.ortodoncia_id,
      p.nombre,
      p.descripcion,
      p.monto_total,
      p.monto_mensual,
      p.abono_inicial,
      p.saldo_restante,
      p.tipo_cuota,
      p.numero_cuotas,
      p.cuotas_pagadas,
      p.estado,
      p.fecha_inicio,
      p.fecha_fin_estimada,
      p.fecha_fin_real,
      p.configuracion,
      p.created_at,
      p.updated_at,
      o.doctor as ortodoncia_doctor,
      CONCAT(pac.first_name, ' ', pac.last_name) as paciente_nombre
    FROM "${schema}".plan_pagos_ortodoncia p
    LEFT JOIN "${schema}".ortodoncias o ON p.ortodoncia_id = o.id
    LEFT JOIN "${schema}".pacientes pac ON p.paciente_id = pac.id
    WHERE p.paciente_id = $1 AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `;
  const { rows } = await query(sql, [patientId]);
  return rows;
};

// ============================================================
// LISTAR PLANES DE PAGOS POR ORTODONCIA
// ============================================================
export const findAllByOrtodoncia = async (schema, ortodonciaId) => {
  const sql = `
    SELECT 
      p.id,
      p.paciente_id,
      p.ortodoncia_id,
      p.nombre,
      p.descripcion,
      p.monto_total,
      p.monto_mensual,
      p.abono_inicial,
      p.saldo_restante,
      p.tipo_cuota,
      p.numero_cuotas,
      p.cuotas_pagadas,
      p.estado,
      p.fecha_inicio,
      p.fecha_fin_estimada,
      p.fecha_fin_real,
      p.configuracion,
      p.created_at,
      p.updated_at,
      CONCAT(pac.first_name, ' ', pac.last_name) as paciente_nombre
    FROM "${schema}".plan_pagos_ortodoncia p
    LEFT JOIN "${schema}".pacientes pac ON p.paciente_id = pac.id
    WHERE p.ortodoncia_id = $1 AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
  `;
  const { rows } = await query(sql, [ortodonciaId]);
  return rows;
};

// ============================================================
// OBTENER PLAN POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      p.id,
      p.paciente_id,
      p.ortodoncia_id,
      p.nombre,
      p.descripcion,
      p.monto_total,
      p.monto_mensual,
      p.abono_inicial,
      p.saldo_restante,
      p.tipo_cuota,
      p.numero_cuotas,
      p.cuotas_pagadas,
      p.estado,
      p.fecha_inicio,
      p.fecha_fin_estimada,
      p.fecha_fin_real,
      p.configuracion,
      p.created_at,
      p.updated_at,
      CONCAT(pac.first_name, ' ', pac.last_name) as paciente_nombre
    FROM "${schema}".plan_pagos_ortodoncia p
    LEFT JOIN "${schema}".pacientes pac ON p.paciente_id = pac.id
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// OBTENER PLAN ACTIVO POR PACIENTE
// ============================================================
export const findActiveByPatient = async (schema, patientId) => {
  const sql = `
    SELECT 
      p.id,
      p.paciente_id,
      p.ortodoncia_id,
      p.nombre,
      p.descripcion,
      p.monto_total,
      p.monto_mensual,
      p.abono_inicial,
      p.saldo_restante,
      p.tipo_cuota,
      p.numero_cuotas,
      p.cuotas_pagadas,
      p.estado,
      p.fecha_inicio,
      p.fecha_fin_estimada,
      p.fecha_fin_real,
      p.configuracion,
      p.created_at,
      p.updated_at
    FROM "${schema}".plan_pagos_ortodoncia p
    WHERE p.paciente_id = $1 
      AND p.estado = 'activo' 
      AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT 1
  `;
  const { rows } = await query(sql, [patientId]);
  return rows[0] || null;
};

// ============================================================
// CREAR PLAN
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".plan_pagos_ortodoncia (
      paciente_id,
      ortodoncia_id,
      nombre,
      descripcion,
      monto_total,
      monto_mensual,
      abono_inicial,
      saldo_restante,
      tipo_cuota,
      numero_cuotas,
      cuotas_pagadas,
      estado,
      fecha_inicio,
      fecha_fin_estimada,
      fecha_fin_real,
      configuracion
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `;
  
  const { rows } = await query(sql, [
    data.paciente_id,
    data.ortodoncia_id || null,
    data.nombre || 'Plan de Ortodoncia',
    data.descripcion || '',
    data.monto_total || 0,
    data.monto_mensual || 0,
    data.abono_inicial || 0,
    data.saldo_restante || data.monto_total || 0,
    data.tipo_cuota || 'fija',
    data.numero_cuotas || 0,
    data.cuotas_pagadas || 0,
    data.estado || 'activo',
    data.fecha_inicio || null,
    data.fecha_fin_estimada || null,
    data.fecha_fin_real || null,
    data.configuracion || {},
  ]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR PLAN
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'nombre', 'descripcion', 'monto_total', 'monto_mensual', 
    'abono_inicial', 'saldo_restante', 'tipo_cuota', 'numero_cuotas',
    'cuotas_pagadas', 'estado', 'fecha_inicio', 'fecha_fin_estimada',
    'fecha_fin_real', 'configuracion'
  ];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(data[field]);
    }
  });

  if (updates.length === 0) {
    return findById(schema, id);
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".plan_pagos_ortodoncia 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR SALDO
// ============================================================
export const updateSaldo = async (schema, id, montoPagado) => {
  const sql = `
    UPDATE "${schema}".plan_pagos_ortodoncia 
    SET 
      saldo_restante = saldo_restante - $1,
      cuotas_pagadas = cuotas_pagadas + 1,
      updated_at = NOW()
    WHERE id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, [montoPagado, id]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR PLAN (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".plan_pagos_ortodoncia 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CAMBIAR ESTADO
// ============================================================
export const updateStatus = async (schema, id, estado) => {
  const sql = `
    UPDATE "${schema}".plan_pagos_ortodoncia 
    SET estado = $1, updated_at = NOW()
    WHERE id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, [estado, id]);
  return rows[0] || null;
};

// ============================================================
// ESTADÍSTICAS DEL PLAN
// ============================================================
export const getStats = async (schema, planId) => {
  const sql = `
    SELECT 
      p.monto_total,
      p.saldo_restante,
      p.numero_cuotas,
      p.cuotas_pagadas,
      COUNT(c.id) as total_cuotas,
      SUM(CASE WHEN c.estado = 'pagado' THEN c.monto ELSE 0 END) as total_pagado,
      SUM(CASE WHEN c.estado = 'pendiente' THEN c.monto ELSE 0 END) as total_pendiente,
      COUNT(CASE WHEN c.estado = 'pagado' THEN 1 END) as cuotas_pagadas_count,
      COUNT(CASE WHEN c.estado = 'pendiente' THEN 1 END) as cuotas_pendientes_count,
      COUNT(CASE WHEN c.estado = 'vencido' THEN 1 END) as cuotas_vencidas_count
    FROM "${schema}".plan_pagos_ortodoncia p
    LEFT JOIN "${schema}".cuotas_ortodoncia c ON p.id = c.plan_id AND c.deleted_at IS NULL
    WHERE p.id = $1 AND p.deleted_at IS NULL
    GROUP BY p.id
  `;
  const { rows } = await query(sql, [planId]);
  return rows[0] || null;
};