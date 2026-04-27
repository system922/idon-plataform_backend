import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* ================= GENERAR NÓMINA (previsualización) ================== */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    const employeesRes = await query(`
      SELECT id, full_name, salary
      FROM ${schema}.employees
      WHERE status = 'active'
    `);

    const employees = employeesRes.rows;
    const result = [];

    for (const emp of employees) {
      const attendanceRes = await query(`
        SELECT type, event_time::date as day, event_time
        FROM ${schema}.attendance_records
        WHERE employee_id = $1
          AND event_time::date BETWEEN $2 AND $3
        ORDER BY event_time ASC
      `, [emp.id, start, end]);

      const records = attendanceRes.rows;
      const days = {};
      for (const r of records) {
        if (!days[r.day]) {
          days[r.day] = { check_in: null, check_out: null, lunch_in: null, lunch_out: null };
        }
        days[r.day][r.type] = r.event_time;
      }

      let total_hours = 0, extra_hours = 0;
      for (const d of Object.values(days)) {
        if (!d.check_in || !d.check_out) continue;
        const checkIn = new Date(d.check_in);
        const checkOut = new Date(d.check_out);
        let worked = (checkOut - checkIn) / 1000 / 60 / 60;
        if (d.lunch_in && d.lunch_out) {
          const lunchIn = new Date(d.lunch_in);
          const lunchOut = new Date(d.lunch_out);
          worked -= (lunchOut - lunchIn) / 1000 / 60 / 60;
        }
        if (worked > 8) { extra_hours += (worked - 8); total_hours += 8; }
        else { total_hours += worked; }
      }

      const salary = Number(emp.salary || 0);
      const hourly_rate = salary / 240;
      const normal_pay = total_hours * hourly_rate;
      const extra_pay = extra_hours * hourly_rate * 1.5;
      const total_pay = normal_pay + extra_pay;

      result.push({
        employee_id: emp.id,
        full_name: emp.full_name,
        total_hours,
        extra_hours,
        hourly_rate,
        extra_pay,
        total_pay
      });
    }

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error generando nómina' });
  }
});

/* ========================= GUARDAR NÓMINA (cabecera y detalle, sin duplicados) ======================== */

router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { rows, start, end } = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows debe ser array' });

    for (const r of rows) {
      // 1. Eliminar duplicados del mismo empleado y periodo
      await query(`
        DELETE FROM ${schema}.employee_payrolls
        WHERE employee_id = $1 AND period_start = $2 AND period_end = $3
      `, [r.employee_id, start, end]);

      // 2. Insertar cabecera y obtener id generado
      const insertPayroll = await query(`
        INSERT INTO ${schema}.employee_payrolls (
          employee_id, period_start, period_end, base_salary,
          total_hours, extra_hours, bonuses, deductions,
          gross_salary, net_salary, status
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6, 0, 0,
          $7, $7, 'generated'
        ) RETURNING id
      `, [
        r.employee_id,            // $1
        start,                    // $2
        end,                      // $3
        r.hourly_rate,            // $4 -- base_salary! (valor hora)
        r.total_hours,            // $5
        r.extra_hours,            // $6
        r.total_pay               // $7 (gross_salary y net_salary)
      ]);
      const payrollId = insertPayroll.rows[0]?.id;

      // 3. Detalle -- puedes expandir esto como gustes, aquí agrego normales y extras
      if (payrollId) {
        await query(`
          INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
          VALUES ($1, 'Horas normales', 'regular', $2)
        `, [payrollId, r.total_pay - r.extra_pay]);
        if (r.extra_pay > 0) {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, 'Horas extras', 'overtime', $2)
          `, [payrollId, r.extra_pay]);
        }
      }
    }

    res.json({ ok: true });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error guardando nómina: ' + err.message });
  }
});

/* =============== CONSULTAR NÓMINA GUARDADA ================ */
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    const payrollRes = await query(`
      SELECT p.id as payroll_id, p.employee_id, e.full_name, p.total_hours,
          p.extra_hours, p.base_salary as hourly_rate, p.gross_salary as total_pay
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.period_start = $1 AND p.period_end = $2
    `, [start, end]);
    res.json(payrollRes.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando nómina guardada' });
  }
});

/* =============== CONSULTAR DETALLE DE UNA NÓMINA ================ */
router.get('/details/:payroll_id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { payroll_id } = req.params;
    if (!payroll_id) return res.status(400).json({ error: 'payroll_id requerido' });

    const detailsRes = await query(`
      SELECT concept, type, amount
      FROM ${schema}.employee_payroll_details
      WHERE payroll_id = $1
      ORDER BY created_at ASC
    `, [payroll_id]);
    res.json(detailsRes.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error consultando detalle' });
  }
});

export default router;