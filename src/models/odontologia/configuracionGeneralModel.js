// src/models/odontologia/configuracionGeneralModel.js
import { query } from '../../config/database.js';

// ============================================================
// OBTENER CONFIGURACIÓN (solo si existe, NO crea por defecto)
// ============================================================
export const findOrCreate = async (schema) => {
  // Intentar obtener la configuración
  const sql = `
    SELECT * FROM "${schema}".configuracion_general
    LIMIT 1
  `;
  const { rows } = await query(sql);
  
  // Solo devolver lo que hay, o null si no existe
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR CONFIGURACIÓN
// ============================================================
export const updateConfig = async (schema, data) => {
  // Verificar si existe la configuración
  const existente = await findOrCreate(schema);
  
  if (!existente) {
    throw new Error('No existe configuración. Debe crearla primero.');
  }

  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'duracion_turno', 
    'intervalo_inicio', 
    'intervalo_fin',
    'tiempo_entre_citas', 
    'recordatorio_horas', 
    'mostrar_fin_semana',
    'notificaciones_email'
  ];

  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${idx}`);
      values.push(data[field]);
      idx++;
    }
  });

  // Si no hay nada que actualizar, devolver la configuración actual
  if (updates.length === 0) {
    return existente;
  }

  // Agregar updated_at
  updates.push(`updated_at = NOW()`);

  const sql = `
    UPDATE "${schema}".configuracion_general
    SET ${updates.join(', ')}
    WHERE id = (SELECT id FROM "${schema}".configuracion_general LIMIT 1)
    RETURNING *
  `;
  
  // IMPORTANTE: NO agregar schema al array de values
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// REINICIAR A VALORES POR DEFECTO
// ============================================================
export const resetToDefaults = async (schema) => {
  // Verificar si existe la configuración
  const existente = await findOrCreate(schema);
  
  if (!existente) {
    throw new Error('No existe configuración para reiniciar.');
  }

  const sql = `
    UPDATE "${schema}".configuracion_general
    SET 
      duracion_turno = 30,
      intervalo_inicio = 8,
      intervalo_fin = 18,
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

// ============================================================
// CREAR CONFIGURACIÓN (nueva función)
// ============================================================
export const createConfig = async (schema, data = {}) => {
  // Verificar si ya existe
  const existente = await findOrCreate(schema);
  if (existente) {
    throw new Error('La configuración ya existe. Use updateConfig para modificarla.');
  }

  const {
    duracion_turno = 30,
    intervalo_inicio = 8,
    intervalo_fin = 18,
    tiempo_entre_citas = 15,
    recordatorio_horas = 24,
    mostrar_fin_semana = false,
    notificaciones_email = true
  } = data;

  const sql = `
    INSERT INTO "${schema}".configuracion_general (
      duracion_turno, 
      intervalo_inicio, 
      intervalo_fin,
      tiempo_entre_citas, 
      recordatorio_horas, 
      mostrar_fin_semana,
      notificaciones_email
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `;
  
  const { rows } = await query(sql, [
    duracion_turno,
    intervalo_inicio,
    intervalo_fin,
    tiempo_entre_citas,
    recordatorio_horas,
    mostrar_fin_semana,
    notificaciones_email
  ]);
  
  return rows[0] || null;
};