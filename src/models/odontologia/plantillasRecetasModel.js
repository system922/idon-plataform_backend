// models/odontologia/plantillasRecetasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR TODAS LAS PLANTILLAS CON SUS MEDICAMENTOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      p.id,
      p.nombre,
      p.descripcion,
      p.duracion,
      p.instrucciones,
      p.advertencias,
      p.is_active,
      p.created_at,
      p.updated_at,
      (
        SELECT json_agg(
          json_build_object(
            'id', pm.id,
            'medicamento_id', m.id,
            'medicamento_nombre', m.nombre,
            'dosis_especifica', pm.dosis_especifica,
            'frecuencia_especifica', pm.frecuencia_especifica,
            'notas', pm.notas,
            'orden', pm.orden,
            'tipo_id', t.id,
            'tipo_nombre', t.nombre,
            'categoria_id', c.id,
            'categoria_nombre', c.nombre
          )
          ORDER BY pm.orden ASC, m.nombre ASC
        )
        FROM "${schema}".plantilla_medicamentos pm
        LEFT JOIN "${schema}".medicamentos m ON pm.medicamento_id = m.id AND m.deleted_at IS NULL
        LEFT JOIN "${schema}".tipos_medicamento t ON m.tipo_id = t.id AND t.deleted_at IS NULL
        LEFT JOIN "${schema}".categorias_medicamento c ON m.categoria_id = c.id AND c.deleted_at IS NULL
        WHERE pm.plantilla_id = p.id AND pm.deleted_at IS NULL
      ) AS medicamentos
    FROM "${schema}".plantillas_recetas p
    WHERE p.deleted_at IS NULL
    ORDER BY p.nombre ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// OBTENER PLANTILLA POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      p.id,
      p.nombre,
      p.descripcion,
      p.duracion,
      p.instrucciones,
      p.advertencias,
      p.is_active,
      p.created_at,
      p.updated_at,
      (
        SELECT json_agg(
          json_build_object(
            'id', pm.id,
            'medicamento_id', m.id,
            'medicamento_nombre', m.nombre,
            'dosis_especifica', pm.dosis_especifica,
            'frecuencia_especifica', pm.frecuencia_especifica,
            'notas', pm.notas,
            'orden', pm.orden,
            'tipo_id', t.id,
            'tipo_nombre', t.nombre,
            'categoria_id', c.id,
            'categoria_nombre', c.nombre
          )
          ORDER BY pm.orden ASC, m.nombre ASC
        )
        FROM "${schema}".plantilla_medicamentos pm
        LEFT JOIN "${schema}".medicamentos m ON pm.medicamento_id = m.id AND m.deleted_at IS NULL
        LEFT JOIN "${schema}".tipos_medicamento t ON m.tipo_id = t.id AND t.deleted_at IS NULL
        LEFT JOIN "${schema}".categorias_medicamento c ON m.categoria_id = c.id AND c.deleted_at IS NULL
        WHERE pm.plantilla_id = p.id AND pm.deleted_at IS NULL
      ) AS medicamentos
    FROM "${schema}".plantillas_recetas p
    WHERE p.id = $1 AND p.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// CREAR PLANTILLA CON SUS MEDICAMENTOS
// ============================================================
export const insert = async (schema, data) => {
  // Insertar plantilla
  const sqlPlantilla = `
    INSERT INTO "${schema}".plantillas_recetas (
      nombre,
      descripcion,
      duracion,
      instrucciones,
      advertencias,
      is_active
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `;
  const { rows } = await query(sqlPlantilla, [
    data.nombre,
    data.descripcion || null,
    data.duracion || null,
    data.instrucciones || null,
    data.advertencias || null,
    data.is_active !== undefined ? data.is_active : true
  ]);

  const plantilla = rows[0];

  // Insertar medicamentos de la plantilla
  if (data.medicamentos && data.medicamentos.length > 0) {
    for (let i = 0; i < data.medicamentos.length; i++) {
      const med = data.medicamentos[i];
      const sqlMed = `
        INSERT INTO "${schema}".plantilla_medicamentos (
          plantilla_id,
          medicamento_id,
          dosis_especifica,
          frecuencia_especifica,
          notas,
          orden
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await query(sqlMed, [
        plantilla.id,
        med.medicamento_id,
        med.dosis_especifica || null,
        med.frecuencia_especifica || null,
        med.notas || null,
        i
      ]);
    }
  }

  return findById(schema, plantilla.id);
};

// ============================================================
// ACTUALIZAR PLANTILLA
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'nombre', 'descripcion', 'duracion',
    'instrucciones', 'advertencias', 'is_active'
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
    UPDATE "${schema}".plantillas_recetas 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  await query(sql, values);

  // Actualizar medicamentos (eliminar y volver a insertar)
  if (data.medicamentos !== undefined) {
    // Eliminar medicamentos existentes
    const sqlDelete = `
      UPDATE "${schema}".plantilla_medicamentos 
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE plantilla_id = $1 AND deleted_at IS NULL
    `;
    await query(sqlDelete, [id]);

    // Insertar nuevos medicamentos
    for (let i = 0; i < data.medicamentos.length; i++) {
      const med = data.medicamentos[i];
      const sqlInsert = `
        INSERT INTO "${schema}".plantilla_medicamentos (
          plantilla_id,
          medicamento_id,
          dosis_especifica,
          frecuencia_especifica,
          notas,
          orden
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      await query(sqlInsert, [
        id,
        med.medicamento_id,
        med.dosis_especifica || null,
        med.frecuencia_especifica || null,
        med.notas || null,
        i
      ]);
    }
  }

  return findById(schema, id);
};

// ============================================================
// ELIMINAR PLANTILLA (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".plantillas_recetas 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  
  if (rows[0]) {
    // Eliminar medicamentos de la plantilla
    const sqlMed = `
      UPDATE "${schema}".plantilla_medicamentos 
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE plantilla_id = $1 AND deleted_at IS NULL
    `;
    await query(sqlMed, [id]);
  }
  
  return rows[0] || null;
};