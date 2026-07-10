// src/models/odontologia/configuracionGeneralModel.js
import { query } from '../../config/database.js';

// ============================================================
// OBTENER CONFIGURACIÓN (si no existe, crea una por defecto)
// ============================================================
export const findOrCreate = async (schema) => {
  // Intentar obtener la configuración
  let sql = `
    SELECT * FROM "${schema}".configuracion_general
    LIMIT 1
  `;
  let { rows } = await query(sql);
  
  if (rows.length === 0) {
    // Crear configuración por defecto
    sql = `
      INSERT INTO "${schema}".configuracion_general (
        duracion_turno, intervalo_inicio, intervalo_fin,
        tiempo_entre_citas, recordatorio_horas, mostrar_fin_semana,
        notificaciones_email
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    const result = await query(sql, [30, 8, 20, 15, 24, false, true]);
    return result.rows[0];
  }
  
  return rows[0];
};

// ============================================================
// ACTUALIZAR CONFIGURACIÓN
// ============================================================
export const updateConfig = async (schema, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'duracion_turno', 'intervalo_inicio', 'intervalo_fin',
    'tiempo_entre_citas', 'recordatorio_horas', 'mostrar_fin_semana',
    'notificaciones_email'
  ];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(data[field]);
    }
  });

  if (updates.length === 0) return findOrCreate(schema);

  updates.push('updated_at = NOW()');
  values.push(schema);

  const sql = `
    UPDATE "${schema}".configuracion_general
    SET ${updates.join(', ')}
    WHERE id = (SELECT id FROM "${schema}".configuracion_general LIMIT 1)
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// REINICIAR A VALORES POR DEFECTO
// ============================================================
export const resetToDefaults = async (schema) => {
  const sql = `
    UPDATE "${schema}".configuracion_general
    SET 
      duracion_turno = 30,
      intervalo_inicio = 8,
      intervalo_fin = 20,
      tiempo_entre_citas = 15,
      recordatorio_horas = 24,
      mostrar_fin_semana = false,
      notificaciones_email = true,
      updated_at = NOW()
    WHERE id = (SELECT id FROM "${schema}".configuracion_general LIMIT 1)
    RETURNING *
  `;
  const { rows } = await query(sql);
  return rows[0] || null;
};