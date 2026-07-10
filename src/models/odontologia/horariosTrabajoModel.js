// src/models/odontologia/horariosTrabajoModel.js
import { query } from '../../config/database.js';

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

// ============================================================
// LISTAR TODOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT * FROM "${schema}".horarios_trabajo
    WHERE deleted_at IS NULL
    ORDER BY 
      CASE dia
        WHEN 'Lunes' THEN 1
        WHEN 'Martes' THEN 2
        WHEN 'Miércoles' THEN 3
        WHEN 'Jueves' THEN 4
        WHEN 'Viernes' THEN 5
        WHEN 'Sábado' THEN 6
        WHEN 'Domingo' THEN 7
      END
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// OBTENER POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT * FROM "${schema}".horarios_trabajo
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// OBTENER POR DÍA
// ============================================================
export const findByDia = async (schema, dia) => {
  const sql = `
    SELECT * FROM "${schema}".horarios_trabajo
    WHERE dia = $1 AND deleted_at IS NULL
  `;
  const { rows } = await query(sql, [dia]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR
// ============================================================
export const insert = async (schema, data) => {
  // Validar que el día no exista
  const existing = await findByDia(schema, data.dia);
  if (existing) {
    throw new Error(`El día "${data.dia}" ya tiene un horario configurado`);
  }

  const sql = `
    INSERT INTO "${schema}".horarios_trabajo (
      dia, hora_inicio, hora_fin, is_active
    ) VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.dia,
    data.hora_inicio || '08:00',
    data.hora_fin || '17:00',
    data.is_active !== undefined ? data.is_active : true
  ]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  if (data.dia !== undefined) {
    // Verificar que el nuevo día no esté en uso por otro registro
    if (data.dia !== null) {
      const existing = await findByDia(schema, data.dia);
      if (existing && existing.id !== id) {
        throw new Error(`El día "${data.dia}" ya tiene un horario configurado`);
      }
    }
    updates.push(`dia = $${idx++}`);
    values.push(data.dia);
  }
  if (data.hora_inicio !== undefined) {
    updates.push(`hora_inicio = $${idx++}`);
    values.push(data.hora_inicio);
  }
  if (data.hora_fin !== undefined) {
    updates.push(`hora_fin = $${idx++}`);
    values.push(data.hora_fin);
  }
  if (data.is_active !== undefined) {
    updates.push(`is_active = $${idx++}`);
    values.push(data.is_active);
  }

  if (updates.length === 0) return findById(schema, id);

  updates.push('updated_at = NOW()');
  values.push(id);

  const sql = `
    UPDATE "${schema}".horarios_trabajo
    SET ${updates.join(', ')}
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".horarios_trabajo
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// INICIALIZAR HORARIOS POR DEFECTO
// ============================================================
export const initDefaultHorarios = async (schema) => {
  const existing = await findAll(schema);
  if (existing.length > 0) return existing;

  const defaults = DIAS_SEMANA.map((dia, index) => ({
    dia,
    hora_inicio: index < 5 ? '08:00' : '08:00',
    hora_fin: index < 5 ? '17:00' : '13:00',
    is_active: index < 5
  }));

  const results = [];
  for (const data of defaults) {
    const result = await insert(schema, data);
    results.push(result);
  }
  return results;
};