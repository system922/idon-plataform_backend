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
   REGISTRAR EVENTO
========================= */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { employee_id, type } = req.body;

    await query(`
      INSERT INTO ${schema}.attendance_records
      (employee_id, type, event_time)
      VALUES ($1, $2, NOW())
    `, [employee_id, type]);

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error registrando asistencia' });
  }
});


export default router;
