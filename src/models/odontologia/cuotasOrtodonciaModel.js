// models/odontologia/cuotasOrtodonciaModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR CUOTAS DE UN PLAN
// ============================================================
export const findAllByPlan = async (schema, planId) => {
  const sql = `
    SELECT 
      id,
      plan_id,
      numero_cuota,
      monto,
      fecha_vencimiento,
      fecha_pago,
      estado,
      pago_id,
      notas,
      created_at,
      updated_at
    FROM "${schema}".cuotas_ortodoncia
    WHERE plan_id = $1 AND deleted_at IS NULL
    ORDER BY numero_cuota ASC
  `;
  const { rows } = await query(sql, [planId]);
  return rows;
};

// ============================================================
// OBTENER CUOTA POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      id,
      plan_id,
      numero_cuota,
      monto,
      fecha_vencimiento,
      fecha_pago,
      estado,
      pago_id,
      notas,
      created_at,
      updated_at
    FROM "${schema}".cuotas_ortodoncia
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CREAR CUOTA
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".cuotas_ortodoncia (
      plan_id,
      numero_cuota,
      monto,
      fecha_vencimiento,
      fecha_pago,
      estado,
      pago_id,
      notas
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING *
  `;
  
  const { rows } = await query(sql, [
    data.plan_id,
    data.numero_cuota,
    data.monto || 0,
    data.fecha_vencimiento || null,
    data.fecha_pago || null,
    data.estado || 'pendiente',
    data.pago_id || null,
    data.notas || '',
  ]);
  return rows[0] || null;
};

// ============================================================
// CREAR MÚLTIPLES CUOTAS
// ============================================================
export const insertMany = async (schema, cuotas) => {
  if (!cuotas || cuotas.length === 0) return [];

  const values = [];
  const placeholders = [];
  let idx = 1;

  cuotas.forEach((c) => {
    placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6})`);
    values.push(
      c.plan_id,
      c.numero_cuota,
      c.monto || 0,
      c.fecha_vencimiento || null,
      c.estado || 'pendiente',
      c.notas || '',
      c.created_at || new Date()
    );
    idx += 7;
  });

  const sql = `
    INSERT INTO "${schema}".cuotas_ortodoncia (
      plan_id, numero_cuota, monto, fecha_vencimiento, estado, notas, created_at
    ) VALUES ${placeholders.join(', ')}
    RETURNING *
  `;
  
  const { rows } = await query(sql, values);
  return rows;
};

// ============================================================
// ACTUALIZAR ESTADO DE CUOTA
// ============================================================
export const updateEstado = async (schema, id, estado, pagoId = null) => {
  const sql = `
    UPDATE "${schema}".cuotas_ortodoncia 
    SET 
      estado = $1,
      pago_id = COALESCE($2, pago_id),
      fecha_pago = CASE WHEN $1 = 'pagado' THEN NOW() ELSE fecha_pago END,
      updated_at = NOW()
    WHERE id = $3 AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, [estado, pagoId, id]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR MÚLTIPLES CUOTAS
// ============================================================
export const updateManyEstado = async (schema, cuotaIds, estado, pagoId = null) => {
  if (!cuotaIds || cuotaIds.length === 0) return [];

  const placeholders = cuotaIds.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `
    UPDATE "${schema}".cuotas_ortodoncia 
    SET 
      estado = $${cuotaIds.length + 1},
      pago_id = COALESCE($${cuotaIds.length + 2}, pago_id),
      fecha_pago = CASE WHEN $${cuotaIds.length + 1} = 'pagado' THEN NOW() ELSE fecha_pago END,
      updated_at = NOW()
    WHERE id IN (${placeholders}) AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, [...cuotaIds, estado, pagoId]);
  return rows;
};

// ============================================================
// ELIMINAR CUOTA (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".cuotas_ortodoncia 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR TODAS LAS CUOTAS DE UN PLAN
// ============================================================
export const softDeleteByPlan = async (schema, planId) => {
  const sql = `
    UPDATE "${schema}".cuotas_ortodoncia 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE plan_id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [planId]);
  return rows;
};