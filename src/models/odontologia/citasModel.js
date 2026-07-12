// models/odontologia/citasModel.js
import { query } from '../../config/database.js';

// ============================================================
// LISTAR CITAS CON TODOS LOS DATOS RELACIONADOS
// ============================================================
export const findAll = async (schema) => {
  const sql = `
    SELECT 
      c.id,
      c.patient_id,
      c.especialista_id,
      c.tratamiento_id,
      c.motivo_id,
      c.fecha,
      c.hora_inicio,
      c.hora_fin,
      c.duracion,
      c.status,
      c.notas,
      c.created_at,
      c.updated_at,
      p.first_name,
      p.last_name,
      p.document_number,
      p.phone,
      CONCAT(p.first_name, ' ', p.last_name) AS paciente_nombre,
      e.nombre AS especialista_nombre,
      e.especialidad,
      t.name AS tratamiento_nombre,
      t.duration_minutes,
      m.nombre AS motivo_nombre,
      m.duracion AS motivo_duracion
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.tratamiento_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".motivos_consulta m ON c.motivo_id = m.id AND m.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
    ORDER BY c.fecha DESC, c.hora_inicio ASC
  `;
  const { rows } = await query(sql);
  return rows;
};

// ============================================================
// LISTAR CITAS POR FECHA Y ESPECIALISTA
// ============================================================
export const findByFechaAndEspecialista = async (schema, fecha, especialistaId) => {
  const sql = `
    SELECT 
      c.id,
      c.patient_id,
      c.especialista_id,
      c.tratamiento_id,
      c.motivo_id,
      c.fecha,
      c.hora_inicio,
      c.hora_fin,
      c.duracion,
      c.status,
      c.notas,
      p.first_name,
      p.last_name,
      p.document_number,
      p.phone,
      CONCAT(p.first_name, ' ', p.last_name) AS paciente_nombre,
      e.nombre AS especialista_nombre,
      t.name AS tratamiento_nombre,
      m.nombre AS motivo_nombre
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.tratamiento_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".motivos_consulta m ON c.motivo_id = m.id AND m.deleted_at IS NULL
    WHERE c.deleted_at IS NULL
      AND c.fecha = $1
      AND c.especialista_id = $2
      AND c.status NOT IN ('cancelled')
    ORDER BY c.hora_inicio ASC
  `;
  const { rows } = await query(sql, [fecha, especialistaId]);
  return rows;
};

// ============================================================
// LISTAR CITAS POR PACIENTE
// ============================================================
export const findByPatientId = async (schema, patientId) => {
  const sql = `
    SELECT 
      c.id,
      c.fecha,
      c.hora_inicio,
      c.hora_fin,
      c.status,
      c.notas,
      e.nombre AS especialista_nombre,
      t.name AS tratamiento_nombre,
      m.nombre AS motivo_nombre
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".especialistas e ON c.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.tratamiento_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".motivos_consulta m ON c.motivo_id = m.id AND m.deleted_at IS NULL
    WHERE c.patient_id = $1 AND c.deleted_at IS NULL
    ORDER BY c.fecha DESC, c.hora_inicio ASC
  `;
  const { rows } = await query(sql, [patientId]);
  return rows;
};

// ============================================================
// OBTENER CITA POR ID
// ============================================================
export const findById = async (schema, id) => {
  const sql = `
    SELECT 
      c.id,
      c.patient_id,
      c.especialista_id,
      c.tratamiento_id,
      c.motivo_id,
      c.fecha,
      c.hora_inicio,
      c.hora_fin,
      c.duracion,
      c.status,
      c.notas,
      c.created_at,
      c.updated_at,
      p.first_name,
      p.last_name,
      p.document_number,
      p.phone,
      p.email,
      CONCAT(p.first_name, ' ', p.last_name) AS paciente_nombre,
      e.nombre AS especialista_nombre,
      e.especialidad,
      t.name AS tratamiento_nombre,
      t.duration_minutes,
      t.price,
      m.nombre AS motivo_nombre,
      m.duracion AS motivo_duracion
    FROM "${schema}".citas c
    LEFT JOIN "${schema}".pacientes p ON c.patient_id = p.id AND p.deleted_at IS NULL
    LEFT JOIN "${schema}".especialistas e ON c.especialista_id = e.id AND e.deleted_at IS NULL
    LEFT JOIN "${schema}".tratamientos t ON c.tratamiento_id = t.id AND t.deleted_at IS NULL
    LEFT JOIN "${schema}".motivos_consulta m ON c.motivo_id = m.id AND m.deleted_at IS NULL
    WHERE c.id = $1 AND c.deleted_at IS NULL
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// VERIFICAR DISPONIBILIDAD DE HORA
// ============================================================
export const verificarDisponibilidad = async (schema, especialistaId, fecha, horaInicio, horaFin, excludeId = null) => {
  let sql = `
    SELECT COUNT(*) AS count
    FROM "${schema}".citas
    WHERE especialista_id = $1
      AND fecha = $2
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'no_show')
      AND (
        (hora_inicio < $4 AND hora_fin > $3)
        OR (hora_inicio >= $3 AND hora_inicio < $4)
        OR (hora_fin > $3 AND hora_fin <= $4)
      )
  `;
  
  const params = [especialistaId, fecha, horaInicio, horaFin];
  
  if (excludeId) {
    sql += ` AND id != $5`;
    params.push(excludeId);
  }
  
  const { rows } = await query(sql, params);
  return Number(rows[0]?.count || 0) === 0;
};

// ============================================================
// CREAR CITA
// ============================================================
export const insert = async (schema, data) => {
  const sql = `
    INSERT INTO "${schema}".citas (
      patient_id,
      especialista_id,
      tratamiento_id,
      motivo_id,
      fecha,
      hora_inicio,
      hora_fin,
      duracion,
      status,
      notas
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const { rows } = await query(sql, [
    data.patient_id,
    data.especialista_id,
    data.tratamiento_id || null,
    data.motivo_id || null,
    data.fecha,
    data.hora_inicio,
    data.hora_fin,
    data.duracion || 30,
    data.status || 'scheduled',
    data.notas || null
  ]);
  return rows[0] || null;
};

// ============================================================
// ACTUALIZAR CITA
// ============================================================
export const updateById = async (schema, id, data) => {
  const updates = [];
  const values = [];
  let idx = 1;

  const fields = [
    'patient_id', 'especialista_id', 'tratamiento_id', 'motivo_id',
    'fecha', 'hora_inicio', 'hora_fin', 'duracion', 'status', 'notas'
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
    UPDATE "${schema}".citas 
    SET ${updates.join(', ')} 
    WHERE id = $${idx} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, values);
  return rows[0] || null;
};

// ============================================================
// CAMBIAR ESTADO DE CITA
// ============================================================
export const updateStatus = async (schema, id, status) => {
  const sql = `
    UPDATE "${schema}".citas 
    SET status = $1, updated_at = NOW()
    WHERE id = $2 AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await query(sql, [status, id]);
  return rows[0] || null;
};

// ============================================================
// ELIMINAR CITA (SOFT DELETE)
// ============================================================
export const softDelete = async (schema, id) => {
  const sql = `
    UPDATE "${schema}".citas 
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = $1 AND deleted_at IS NULL
    RETURNING id
  `;
  const { rows } = await query(sql, [id]);
  return rows[0] || null;
};

// ============================================================
// OBTENER HORARIOS DISPONIBLES (CON CONFIGURACIÓN GENERAL)
// ============================================================
export const getHorariosDisponibles = async (schema, especialistaId, fecha, duracion = null) => {
  // 1. Obtener el día de la semana
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaSemana = dias[new Date(fecha).getDay()];
  
  // 2. Obtener configuración general (horario global)
  const configSql = `
    SELECT 
      intervalo_inicio,
      intervalo_fin,
      duracion_turno,
      tiempo_entre_citas,
      mostrar_fin_semana
    FROM "${schema}".configuracion_general
    LIMIT 1
  `;
  const configResult = await query(configSql);
  
  // Si no hay configuración, usar valores por defecto
  let config = {
    intervalo_inicio: 8,
    intervalo_fin: 20,
    duracion_turno: 30,
    tiempo_entre_citas: 0,
    mostrar_fin_semana: false
  };
  
  if (configResult.rows.length > 0) {
    config = configResult.rows[0];
  }

  const horaInicioGlobal = config.intervalo_inicio; // 8
  const horaFinGlobal = config.intervalo_fin; // 20
  const duracionTurno = duracion || config.duracion_turno || 30;
  const tiempoEntreCitas = config.tiempo_entre_citas || 0;
  const mostrarFinSemana = config.mostrar_fin_semana || false;

  // 3. Verificar si es fin de semana y si está habilitado
  const esFinSemana = diaSemana === 'sábado' || diaSemana === 'domingo';
  if (esFinSemana && !mostrarFinSemana) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: 'No se atiende en fines de semana'
    };
  }

  // 4. Obtener la agenda del especialista para ese día
  const agendaSql = `
    SELECT 
      a.id AS agenda_id,
      a.nombre AS agenda_nombre,
      EXTRACT(HOUR FROM ad.hora_inicio) AS agenda_inicio_hora,
      EXTRACT(HOUR FROM ad.hora_fin) AS agenda_fin_hora,
      ad.hora_inicio AS agenda_inicio,
      ad.hora_fin AS agenda_fin
    FROM "${schema}".agendas a
    JOIN "${schema}".agenda_dias ad ON a.id = ad.agenda_id
    WHERE a.especialista_id = $1
      AND a.is_active = true
      AND a.deleted_at IS NULL
      AND ad.is_active = true
      AND ad.dia = $2
    LIMIT 1
  `;
  const agendaResult = await query(agendaSql, [especialistaId, diaSemana]);
  
  if (agendaResult.rows.length === 0) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: 'El especialista no tiene agenda configurada para este día'
    };
  }

  const { 
    agenda_id, 
    agenda_nombre, 
    agenda_inicio, 
    agenda_fin,
    agenda_inicio_hora,
    agenda_fin_hora
  } = agendaResult.rows[0];

  // 5. Calcular el rango de horario real (intersección entre global y agenda)
  // Convertir todo a horas (números) para comparar
  const horaInicioReal = Math.max(horaInicioGlobal, agenda_inicio_hora);
  const horaFinReal = Math.min(horaFinGlobal, agenda_fin_hora);

  console.log('📊 [getHorariosDisponibles] Debug:');
  console.log('  - Hora global:', horaInicioGlobal, '-', horaFinGlobal);
  console.log('  - Hora agenda:', agenda_inicio_hora, '-', agenda_fin_hora);
  console.log('  - Hora real:', horaInicioReal, '-', horaFinReal);

  if (horaInicioReal >= horaFinReal) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: 'El horario del especialista no coincide con el horario global'
    };
  }

  // 6. Verificar si hay días libres
  const diasLibresSql = `
    SELECT fecha, motivo
    FROM "${schema}".agenda_dias_libres
    WHERE agenda_id = $1
      AND fecha = $2
      AND deleted_at IS NULL
  `;
  const diasLibresResult = await query(diasLibresSql, [agenda_id, fecha]);
  
  if (diasLibresResult.rows.length > 0) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: `El especialista no atiende en esta fecha (día libre)`,
      motivo: diasLibresResult.rows[0].motivo
    };
  }

  // 7. Obtener citas existentes para ese día
  const citasSql = `
    SELECT hora_inicio, hora_fin, status
    FROM "${schema}".citas
    WHERE especialista_id = $1
      AND fecha = $2
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'no_show')
    ORDER BY hora_inicio ASC
  `;
  const citasResult = await query(citasSql, [especialistaId, fecha]);
  const citas = citasResult.rows;

  // 8. Generar slots disponibles
  const slots = [];
  const duracionMs = duracionTurno * 60000;
  const tiempoEntreMs = tiempoEntreCitas * 60000;
  
  // Crear fechas para los cálculos
  let currentTime = new Date();
  currentTime.setHours(horaInicioReal, 0, 0, 0);
  const endTime = new Date();
  endTime.setHours(horaFinReal, 0, 0, 0);

  // Formatear hora para comparación
  const formatTime = (date) => {
    return date.toTimeString().slice(0, 5);
  };

  let contador = 0;
  const maxSlots = 100;
  while (currentTime < endTime && contador < maxSlots) {
    contador++;
    const slotInicio = formatTime(currentTime);
    const slotFin = formatTime(new Date(currentTime.getTime() + duracionMs));
    
    // Verificar si el slot está dentro del horario de trabajo
    const slotFinDate = new Date(currentTime.getTime() + duracionMs);
    if (slotFinDate > endTime) {
      break;
    }

    // Verificar si el slot está ocupado
    const ocupado = citas.some(c => {
      const cInicio = c.hora_inicio;
      const cFin = c.hora_fin;
      return (slotInicio >= cInicio && slotInicio < cFin) || 
             (slotFin > cInicio && slotFin <= cFin) ||
             (slotInicio <= cInicio && slotFin >= cFin);
    });

    // Verificar tiempo entre citas
    let tieneTiempoEntre = true;
    if (tiempoEntreMs > 0) {
      const slotFinConTiempo = new Date(currentTime.getTime() + duracionMs + tiempoEntreMs);
      tieneTiempoEntre = !citas.some(c => {
        const cInicio = c.hora_inicio;
        return slotFinConTiempo > new Date(`1970-01-01T${cInicio}`);
      });
    }

    if (!ocupado && tieneTiempoEntre) {
      slots.push({
        hora_inicio: slotInicio,
        hora_fin: slotFin,
        disponible: true
      });
    }

    // Avanzar al siguiente slot (duración + tiempo entre citas)
    currentTime = new Date(currentTime.getTime() + duracionMs + tiempoEntreMs);
  }

  return {
    disponible: slots.length > 0,
    agenda_id,
    agenda_nombre,
    configuracion: {
      hora_inicio_global: horaInicioGlobal,
      hora_fin_global: horaFinGlobal,
      duracion_turno: duracionTurno,
      tiempo_entre_citas: tiempoEntreCitas
    },
    horario_especialista: {
      inicio: agenda_inicio,
      fin: agenda_fin
    },
    horario_real: {
      inicio: horaInicioReal + ':00',
      fin: horaFinReal + ':00'
    },
    slots
  };
};

// ============================================================
// ESTADÍSTICAS DE CITAS
// ============================================================
export const getStats = async (schema) => {
  const sql = `
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'scheduled' THEN 1 END) AS scheduled,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN status = 'in_progress' THEN 1 END) AS in_progress,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled,
      COUNT(CASE WHEN status = 'no_show' THEN 1 END) AS no_show
    FROM "${schema}".citas
    WHERE deleted_at IS NULL
  `;
  const { rows } = await query(sql);
  return {
    total: Number(rows[0]?.total || 0),
    scheduled: Number(rows[0]?.scheduled || 0),
    confirmed: Number(rows[0]?.confirmed || 0),
    in_progress: Number(rows[0]?.in_progress || 0),
    completed: Number(rows[0]?.completed || 0),
    cancelled: Number(rows[0]?.cancelled || 0),
    no_show: Number(rows[0]?.no_show || 0)
  };
};