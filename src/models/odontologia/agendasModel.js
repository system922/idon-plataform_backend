// src/models/odontologia/agendasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODOS (con información de días)
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      a.*,
      e.nombre AS especialista_nombre,
      e.especialidad AS especialidad,
      g.nombre AS grupo_nombre,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'dia', ad.dia,
          'activo', ad.is_active,
          'inicio', ad.hora_inicio,
          'fin', ad.hora_fin
        ) ORDER BY 
          CASE ad.dia
            WHEN 'lunes' THEN 1
            WHEN 'martes' THEN 2
            WHEN 'miercoles' THEN 3
            WHEN 'jueves' THEN 4
            WHEN 'viernes' THEN 5
            WHEN 'sabado' THEN 6
            WHEN 'domingo' THEN 7
          END
        ) FROM "${schema}".agenda_dias ad WHERE ad.agenda_id = a.id),
        '[]'::json
      ) AS dias,
      COALESCE(
        (SELECT json_agg(json_build_object('fecha', dl.fecha, 'motivo', dl.motivo))
         FROM "${schema}".agenda_dias_libres dl WHERE dl.agenda_id = a.id),
        '[]'::json
      ) AS dias_libres,
      (SELECT COUNT(*) FROM "${schema}".agenda_dias WHERE agenda_id = a.id AND is_active = true) AS dias_activos
    FROM "${schema}".agendas a
    LEFT JOIN "${schema}".especialistas e ON a.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".grupos_agendas g ON a.grupo_id = g.id AND g.deleted_at IS NULL
    WHERE a.deleted_at IS NULL
    ORDER BY a.nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// OBTENER POR ID (con días y días libres)
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      a.*,
      e.nombre AS especialista_nombre,
      e.especialidad AS especialidad,
      g.nombre AS grupo_nombre,
      COALESCE(
        (SELECT json_agg(json_build_object(
          'dia', ad.dia,
          'activo', ad.is_active,
          'inicio', ad.hora_inicio,
          'fin', ad.hora_fin
        ) ORDER BY 
          CASE ad.dia
            WHEN 'lunes' THEN 1
            WHEN 'martes' THEN 2
            WHEN 'miercoles' THEN 3
            WHEN 'jueves' THEN 4
            WHEN 'viernes' THEN 5
            WHEN 'sabado' THEN 6
            WHEN 'domingo' THEN 7
          END
        ) FROM "${schema}".agenda_dias ad WHERE ad.agenda_id = a.id),
        '[]'::json
      ) AS dias,
      COALESCE(
        (SELECT json_agg(json_build_object('id', dl.id, 'fecha', dl.fecha, 'motivo', dl.motivo))
         FROM "${schema}".agenda_dias_libres dl WHERE dl.agenda_id = a.id),
        '[]'::json
      ) AS dias_libres,
      (SELECT COUNT(*) FROM "${schema}".agenda_dias WHERE agenda_id = a.id AND is_active = true) AS dias_activos
    FROM "${schema}".agendas a
    LEFT JOIN "${schema}".especialistas e ON a.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".grupos_agendas g ON a.grupo_id = g.id AND g.deleted_at IS NULL
    WHERE a.id = $1 AND a.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// INSERTAR (con días)
// ============================================================
export const insert = async (schema, data) => {
  const client = await query('BEGIN');

  try {
    // Insertar agenda
    const agendaSql = `
      INSERT INTO "${schema}".agendas (
        nombre, descripcion, color, especialista_id, grupo_id, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const agendaResult = await query(agendaSql, [
      data.nombre,
      data.descripcion || null,
      data.color || '#10b981',
      data.especialista_id,
      data.grupo_id || null,
      data.is_active !== undefined ? data.is_active : true
    ]);
    const agenda = agendaResult.rows[0];

    // Insertar días
    if (data.dias && data.dias.length > 0) {
      for (const dia of data.dias) {
        const diaSql = `
          INSERT INTO "${schema}".agenda_dias (
            agenda_id, dia, is_active, hora_inicio, hora_fin
          ) VALUES ($1, $2, $3, $4, $5)
        `;
        await query(diaSql, [
          agenda.id,
          dia.dia,
          dia.activo !== undefined ? dia.activo : true,
          dia.inicio || '08:00',
          dia.fin || '17:00'
        ]);
      }
    }

    // Insertar días libres
    if (data.dias_libres && data.dias_libres.length > 0) {
      for (const dl of data.dias_libres) {
        const dlSql = `
          INSERT INTO "${schema}".agenda_dias_libres (
            agenda_id, fecha, motivo
          ) VALUES ($1, $2, $3)
        `;
        await query(dlSql, [agenda.id, dl.fecha, dl.motivo]);
      }
    }

    await query('COMMIT');
    return findById(schema, agenda.id);
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
};

// ============================================================
// ACTUALIZAR (con días y días libres)
// ============================================================
export const updateById = async (schema, id, data) => {
  const client = await query('BEGIN');

  try {
    const updates = [];
    const values = [];
    let idx = 1;

    if (data.nombre !== undefined) {
      updates.push(`nombre = $${idx++}`);
      values.push(data.nombre);
    }
    if (data.descripcion !== undefined) {
      updates.push(`descripcion = $${idx++}`);
      values.push(data.descripcion || null);
    }
    if (data.color !== undefined) {
      updates.push(`color = $${idx++}`);
      values.push(data.color);
    }
    if (data.especialista_id !== undefined) {
      updates.push(`especialista_id = $${idx++}`);
      values.push(data.especialista_id);
    }
    if (data.grupo_id !== undefined) {
      updates.push(`grupo_id = $${idx++}`);
      values.push(data.grupo_id || null);
    }
    if (data.is_active !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(data.is_active);
    }

    if (updates.length > 0) {
      updates.push('updated_at = NOW()');
      values.push(id);
      const updateSql = `
        UPDATE "${schema}".agendas
        SET ${updates.join(', ')}
        WHERE id = $${idx} AND deleted_at IS NULL
      `;
      await query(updateSql, values);
    }

    // Actualizar días (si se envía)
    if (data.dias && data.dias.length > 0) {
      // Eliminar días existentes
      await query(`DELETE FROM "${schema}".agenda_dias WHERE agenda_id = $1`, [id]);

      // Insertar nuevos días
      for (const dia of data.dias) {
        const diaSql = `
          INSERT INTO "${schema}".agenda_dias (
            agenda_id, dia, is_active, hora_inicio, hora_fin
          ) VALUES ($1, $2, $3, $4, $5)
        `;
        await query(diaSql, [
          id,
          dia.dia,
          dia.activo !== undefined ? dia.activo : true,
          dia.inicio || '08:00',
          dia.fin || '17:00'
        ]);
      }
    }

    // Actualizar días libres (si se envía)
    if (data.dias_libres !== undefined) {
      // Eliminar días libres existentes
      await query(`DELETE FROM "${schema}".agenda_dias_libres WHERE agenda_id = $1`, [id]);

      // Insertar nuevos días libres
      if (data.dias_libres && data.dias_libres.length > 0) {
        for (const dl of data.dias_libres) {
          const dlSql = `
            INSERT INTO "${schema}".agenda_dias_libres (
              agenda_id, fecha, motivo
            ) VALUES ($1, $2, $3)
          `;
          await query(dlSql, [id, dl.fecha, dl.motivo]);
        }
      }
    }

    await query('COMMIT');
    return findById(schema, id);
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
};

// ============================================================
// ELIMINAR (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".agendas
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// AGREGAR DÍA LIBRE
// ============================================================
export const addDiaLibre = async (schema, agendaId, data) => {
  const sql = `
    INSERT INTO "${schema}".agenda_dias_libres (
      agenda_id, fecha, motivo
    ) VALUES ($1, $2, $3)
    ON CONFLICT (agenda_id, fecha) DO UPDATE SET
      motivo = EXCLUDED.motivo,
      updated_at = NOW()
    RETURNING *
  `;
  const { rows } = await query(sql, [agendaId, data.fecha, data.motivo]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR DÍA LIBRE
// ============================================================
export const removeDiaLibre = async (schema, agendaId, diaLibreId) => {
  const sql = `
    DELETE FROM "${schema}".agenda_dias_libres
    WHERE agenda_id = $1 AND id = $2
    RETURNING id
  `;
  const { rows } = await query(sql, [agendaId, diaLibreId]);
  return rows[0] || null;
};

// ============================================================
// OBTENER DÍAS LIBRES POR AGENDA
// ============================================================
export const getDiasLibres = async (schema, agendaId) => {
  const sql = `
    SELECT * FROM "${schema}".agenda_dias_libres
    WHERE agenda_id = $1
    ORDER BY fecha ASC
  `;
  const { rows } = await query(sql, [agendaId]);
  return rows;
};