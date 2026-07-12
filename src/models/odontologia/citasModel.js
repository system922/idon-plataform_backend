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
// OBTENER HORARIOS DISPONIBLES (CORREGIDO)
// ============================================================
export const getHorariosDisponibles = async (schema, especialistaId, fecha, duracion = null) => {
  console.log('🔄 [getHorariosDisponibles] Iniciando...');
  console.log('  - especialistaId:', especialistaId);
  console.log('  - fecha:', fecha);
  console.log('  - duracion:', duracion);

  // 1. Obtener el día de la semana
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaSemana = dias[new Date(fecha).getDay()];
  const diaSinAcento = diaSemana
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  
  console.log(`  - Día de la semana: ${diaSemana} (sin acento: ${diaSinAcento})`);

  // 2. Obtener configuración general
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
  
  let config = {
    intervalo_inicio: 8,
    intervalo_fin: 18,
    duracion_turno: 30,
    tiempo_entre_citas: 0,
    mostrar_fin_semana: false
  };
  
  if (configResult.rows.length > 0) {
    config = configResult.rows[0];
  }

  const horaInicioGlobal = config.intervalo_inicio;
  const horaFinGlobal = config.intervalo_fin;
  const duracionTurno = duracion || config.duracion_turno || 30;
  const tiempoEntreCitas = config.tiempo_entre_citas || 0;
  const mostrarFinSemana = config.mostrar_fin_semana || false;

  console.log(`  - Config: ${horaInicioGlobal}h - ${horaFinGlobal}h, duracion: ${duracionTurno}min`);

  // 3. Verificar fin de semana
  const esFinSemana = diaSemana === 'sábado' || diaSemana === 'domingo';
  if (esFinSemana && !mostrarFinSemana) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: 'No se atiende en fines de semana'
    };
  }

  // 4. Obtener agenda del especialista
  const agendaSql = `
    SELECT 
      a.id AS agenda_id,
      a.nombre AS agenda_nombre,
      ad.hora_inicio AS agenda_inicio,
      ad.hora_fin AS agenda_fin,
      EXTRACT(HOUR FROM ad.hora_inicio) + EXTRACT(MINUTE FROM ad.hora_inicio)/60 AS agenda_inicio_hora,
      EXTRACT(HOUR FROM ad.hora_fin) + EXTRACT(MINUTE FROM ad.hora_fin)/60 AS agenda_fin_hora
    FROM "${schema}".agendas a
    JOIN "${schema}".agenda_dias ad ON a.id = ad.agenda_id
    WHERE a.especialista_id = $1
      AND a.is_active = true
      AND a.deleted_at IS NULL
      AND ad.is_active = true
      AND (ad.dia = $2 OR ad.dia = $3)
    LIMIT 1
  `;
  const agendaResult = await query(agendaSql, [especialistaId, diaSemana, diaSinAcento]);
  
  if (agendaResult.rows.length === 0) {
    console.log('  ❌ No tiene agenda para este día');
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

  console.log(`  - Agenda: ${agenda_nombre} (${agenda_inicio} - ${agenda_fin})`);

  // 5. Calcular horario real (intersección)
  const horaInicioReal = Math.max(horaInicioGlobal, agenda_inicio_hora);
  const horaFinReal = Math.min(horaFinGlobal, agenda_fin_hora);

  console.log(`  - Horario real: ${horaInicioReal}h - ${horaFinReal}h`);

  if (horaInicioReal >= horaFinReal) {
    return { 
      disponible: false, 
      horarios: [],
      mensaje: 'El horario del especialista no coincide con el horario global'
    };
  }

  // 6. Verificar días libres
  const diasLibresSql = `
    SELECT fecha, motivo
    FROM "${schema}".agenda_dias_libres
    WHERE agenda_id = $1
      AND fecha = $2
  `;
  const diasLibresResult = await query(diasLibresSql, [agenda_id, fecha]);
  
  if (diasLibresResult.rows.length > 0) {
    console.log(`  ❌ Día libre: ${diasLibresResult.rows[0].motivo}`);
    return { 
      disponible: false, 
      horarios: [],
      mensaje: `El especialista no atiende en esta fecha (día libre)`,
      motivo: diasLibresResult.rows[0].motivo
    };
  }

  // 7. Obtener citas existentes
  const citasSql = `
    SELECT hora_inicio, hora_fin
    FROM "${schema}".citas
    WHERE especialista_id = $1
      AND fecha = $2
      AND deleted_at IS NULL
      AND status NOT IN ('cancelled', 'no_show')
    ORDER BY hora_inicio ASC
  `;
  const citasResult = await query(citasSql, [especialistaId, fecha]);
  const citas = citasResult.rows;
  console.log(`  - ${citas.length} citas existentes`);

  // 8. GENERAR SLOTS - Usando minutos desde medianoche
  const slots = [];
  const duracionMs = duracionTurno * 60000;
  const tiempoEntreMs = tiempoEntreCitas * 60000;

  // Hora de inicio y fin en minutos desde medianoche
  const inicioMinutos = Math.floor(horaInicioReal * 60);
  const finMinutos = Math.floor(horaFinReal * 60);

  let currentMinutos = inicioMinutos;

  console.log(`  - Generando slots desde ${horaInicioReal}h hasta ${horaFinReal}h`);

  let contador = 0;
  while (currentMinutos + duracionTurno <= finMinutos && contador < 100) {
    contador++;
    
    // Formatear horas
    const horasInicio = Math.floor(currentMinutos / 60);
    const minsInicio = currentMinutos % 60;
    const slotInicio = `${String(horasInicio).padStart(2, '0')}:${String(minsInicio).padStart(2, '0')}`;
    
    const finMinutosSlot = currentMinutos + duracionTurno;
    const horasFin = Math.floor(finMinutosSlot / 60);
    const minsFin = finMinutosSlot % 60;
    const slotFin = `${String(horasFin).padStart(2, '0')}:${String(minsFin).padStart(2, '0')}`;

    // Verificar si el slot está ocupado
    const ocupado = citas.some(c => {
      const cInicio = c.hora_inicio;
      const cFin = c.hora_fin;
      return (slotInicio >= cInicio && slotInicio < cFin) || 
             (slotFin > cInicio && slotFin <= cFin) ||
             (slotInicio <= cInicio && slotFin >= cFin);
    });

    if (!ocupado) {
      slots.push({
        hora_inicio: slotInicio,
        hora_fin: slotFin,
        disponible: true
      });
    }

    // Avanzar al siguiente slot
    currentMinutos += duracionTurno + tiempoEntreCitas;
  }

  console.log(`  ✅ ${slots.length} slots generados`);
  if (slots.length > 0) {
    console.log(`  - Primer slot: ${slots[0].hora_inicio} - ${slots[0].hora_fin}`);
    console.log(`  - Último slot: ${slots[slots.length-1].hora_inicio} - ${slots[slots.length-1].hora_fin}`);
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
      inicio: `${Math.floor(horaInicioReal)}:${String(Math.round((horaInicioReal - Math.floor(horaInicioReal)) * 60)).padStart(2, '0')}`,
      fin: `${Math.floor(horaFinReal)}:${String(Math.round((horaFinReal - Math.floor(horaFinReal)) * 60)).padStart(2, '0')}`
    },
    slots
  };
};

// ============================================================
// OBTENER ESPECIALISTAS DISPONIBLES
// ============================================================
export const findEspecialistasDisponibles = async (schema, fecha, horaInicio, horaFin) => {
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const diaSemana = dias[new Date(fecha).getDay()];
  const diaSinAcento = diaSemana
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  
  const sql = `
    SELECT DISTINCT
      e.id,
      e.nombre,
      e.especialidad,
      a.id AS agenda_id,
      a.nombre AS agenda_nombre,
      ad.hora_inicio AS agenda_inicio,
      ad.hora_fin AS agenda_fin
    FROM "${schema}".especialistas e
    JOIN "${schema}".agendas a ON e.id = a.especialista_id 
      AND a.is_active = true 
      AND a.deleted_at IS NULL
    JOIN "${schema}".agenda_dias ad ON a.id = ad.agenda_id 
      AND ad.is_active = true
    WHERE e.is_active = true
      AND e.deleted_at IS NULL
      AND (ad.dia = $1 OR ad.dia = $2)
      AND ad.hora_inicio <= $3::time
      AND ad.hora_fin >= $4::time
      AND NOT EXISTS (
        SELECT 1 FROM "${schema}".agenda_dias_libres adl
        WHERE adl.agenda_id = a.id
          AND adl.fecha = $5
      )
      AND NOT EXISTS (
        SELECT 1 FROM "${schema}".citas c
        WHERE c.especialista_id = e.id
          AND c.fecha = $5
          AND c.deleted_at IS NULL
          AND c.status NOT IN ('cancelled', 'no_show')
          AND (
            (c.hora_inicio < $4 AND c.hora_fin > $3)
            OR (c.hora_inicio >= $3 AND c.hora_inicio < $4)
            OR (c.hora_fin > $3 AND c.hora_fin <= $4)
          )
      )
    ORDER BY e.nombre
  `;
  
  const { rows } = await query(sql, [diaSemana, diaSinAcento, horaInicio, horaFin, fecha]);
  return rows;
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