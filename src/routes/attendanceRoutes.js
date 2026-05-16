import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* =========================
   GET ATTENDANCE (HOY)
========================= */
router.get('/today', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);

    const result = await query(`
      SELECT 
        e.id as employee_id,
        e.full_name,
        e.position,
        e.document_number as cedula,

        MAX(CASE WHEN ar.type = 'check_in' THEN ar.event_time END) as entrada,
        MAX(CASE WHEN ar.type = 'lunch_out' THEN ar.event_time END) as salida_almuerzo,
        MAX(CASE WHEN ar.type = 'lunch_in' THEN ar.event_time END) as entrada_almuerzo,
        MAX(CASE WHEN ar.type = 'check_out' THEN ar.event_time END) as salida

      FROM ${schema}.employees e

      LEFT JOIN ${schema}.attendance_records ar 
        ON e.id = ar.employee_id
        AND DATE(ar.event_time) = CURRENT_DATE

      GROUP BY e.id
      ORDER BY e.full_name ASC
    `);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo asistencia' });
  }
});


/* =========================
   REGISTRAR EVENTO + CALCULAR HORAS
========================= */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { employee_id, type } = req.body;

    // Insertar la marcación
    await query(`
      INSERT INTO ${schema}.attendance_records
      (employee_id, type, event_time)
      VALUES ($1, $2, NOW())
    `, [employee_id, type]);

    // Si es check_out (última marcación), calcular y guardar horas trabajadas
    if (type === 'check_out') {
      await calculateAndSaveWorkedHours(schema, employee_id);
    }

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error registrando asistencia' });
  }
});

/* =========================
   CALCULAR Y GUARDAR HORAS TRABAJADAS
========================= */
async function calculateAndSaveWorkedHours(schema, employee_id) {
  try {
    // Obtener todas las marcaciones de hoy para este empleado
    const recordsResult = await query(`
      SELECT type, event_time
      FROM ${schema}.attendance_records
      WHERE employee_id = $1 
        AND DATE(event_time) = CURRENT_DATE
      ORDER BY event_time ASC
    `, [employee_id]);

    const records = recordsResult.rows;

    // Clasificar marcaciones por tipo
    const recordsByType = {};
    records.forEach(r => {
      if (!recordsByType[r.type]) recordsByType[r.type] = [];
      recordsByType[r.type].push(r.event_time);
    });

    let hoursWorked = 0;

    // Caso 1: Solo 2 marcaciones (check_in + check_out, sin almuerzo)
    if (recordsByType['check_in'] && recordsByType['check_out'] && 
        !recordsByType['lunch_out'] && !recordsByType['lunch_in']) {
      const entrada = new Date(recordsByType['check_in'][0]);
      const salida = new Date(recordsByType['check_out'][recordsByType['check_out'].length - 1]);
      hoursWorked = (salida - entrada) / (1000 * 60 * 60); // Convertir ms a horas
      console.log(`✅ Caso 1 (2 marcaciones - Sin almuerzo): ${hoursWorked.toFixed(2)} horas`);
    }
    
    // Caso 2: 4 marcaciones (check_in + lunch_out + lunch_in + check_out)
    else if (recordsByType['check_in'] && recordsByType['lunch_out'] && 
             recordsByType['lunch_in'] && recordsByType['check_out']) {
      const entrada = new Date(recordsByType['check_in'][0]);
      const salidaAlmuerzo = new Date(recordsByType['lunch_out'][recordsByType['lunch_out'].length - 1]);
      const entradaAlmuerzo = new Date(recordsByType['lunch_in'][0]);
      const salida = new Date(recordsByType['check_out'][recordsByType['check_out'].length - 1]);

      const mañana = (salidaAlmuerzo - entrada) / (1000 * 60 * 60);
      const tarde = (salida - entradaAlmuerzo) / (1000 * 60 * 60);
      hoursWorked = mañana + tarde;
      console.log(`✅ Caso 2 (4 marcaciones - Con almuerzo): ${mañana.toFixed(2)}h (mañana) + ${tarde.toFixed(2)}h (tarde) = ${hoursWorked.toFixed(2)} horas`);
    }
    
    // Caso 3: 3 marcaciones (check_in + lunch_out + check_out, sin entrada almuerzo)
    else if (recordsByType['check_in'] && recordsByType['lunch_out'] && 
             recordsByType['check_out'] && !recordsByType['lunch_in']) {
      const entrada = new Date(recordsByType['check_in'][0]);
      const salidaAlmuerzo = new Date(recordsByType['lunch_out'][recordsByType['lunch_out'].length - 1]);
      const salida = new Date(recordsByType['check_out'][recordsByType['check_out'].length - 1]);
      
      const mañana = (salidaAlmuerzo - entrada) / (1000 * 60 * 60);
      const tarde = (salida - salidaAlmuerzo) / (1000 * 60 * 60);
      hoursWorked = mañana + tarde;
      console.log(`✅ Caso 3 (3 marcaciones - Sin entrada almuerzo): ${mañana.toFixed(2)}h + ${tarde.toFixed(2)}h = ${hoursWorked.toFixed(2)} horas`);
    }

    // Guardar en tabla worked_hours si hay horas calculadas
    if (hoursWorked > 0) {
      // Primero, verificar si ya existe registro para hoy
      const existingResult = await query(`
        SELECT id FROM ${schema}.worked_hours
        WHERE employee_id = $1 AND worked_date = CURRENT_DATE
      `, [employee_id]);

      if (existingResult.rows.length > 0) {
        // Actualizar si existe
        await query(`
          UPDATE ${schema}.worked_hours
          SET hours = $1
          WHERE employee_id = $2 AND worked_date = CURRENT_DATE
        `, [hoursWorked, employee_id]);
        console.log(`🔄 Actualizado worked_hours: ${hoursWorked.toFixed(2)} horas`);
      } else {
        // Insertar si no existe
        await query(`
          INSERT INTO ${schema}.worked_hours (employee_id, worked_date, hours)
          VALUES ($1, CURRENT_DATE, $2)
        `, [employee_id, hoursWorked]);
        console.log(`✅ Guardado en worked_hours: ${hoursWorked.toFixed(2)} horas`);
      }
    } else {
      console.log('⚠️ No se pudo calcular horas (marcaciones incompletas)');
    }

  } catch (err) {
    console.error('❌ Error calculando horas trabajadas:', err);
    // No lanzar error para que no falle el POST de asistencia
  }
}

export default router;
