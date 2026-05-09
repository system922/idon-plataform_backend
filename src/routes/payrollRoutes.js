import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* ================= GENERAR NÓMINA (previsualización) ================== */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end, payment_type = 'hourly' } = req.body;
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    // Obtener empleados activos con sus datos de sueldo
    const employeesRes = await query(`
      SELECT 
        id, 
        full_name, 
        salary, 
        daily_rate,
        CASE 
          WHEN daily_rate IS NULL OR daily_rate = 0 THEN salary / 30
          ELSE daily_rate
        END as effective_daily_rate
      FROM ${schema}.employees
      WHERE status = 'active'
    `);

    const employees = employeesRes.rows;
    const result = [];

    // Calcular días del período
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    for (const emp of employees) {
      if (payment_type === 'daily') {
        // 🔥 PAGO DIARIO - usar el daily_rate del empleado
        const dailyRate = Number(emp.effective_daily_rate) || 0;
        const total_pay = dailyRate * daysInPeriod;
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: 0,
          extra_hours: 0,
          hourly_rate: 0,
          daily_rate: dailyRate,
          total_days: daysInPeriod,
          extra_pay: 0,
          total_pay: total_pay,
          payment_type: 'daily'
        });
      } else {
        // 🔥 PAGO POR HORAS - calcular desde asistencias
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
          
          if (worked > 8) { 
            extra_hours += (worked - 8); 
            total_hours += 8; 
          } else { 
            total_hours += worked; 
          }
        }

        const salary = Number(emp.salary || 0);
        const hourly_rate = salary / 240;
        const normal_pay = total_hours * hourly_rate;
        const extra_pay = extra_hours * hourly_rate * 1.5;
        const total_pay = normal_pay + extra_pay;

        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: total_hours,
          extra_hours: extra_hours,
          hourly_rate: hourly_rate,
          daily_rate: 0,
          total_days: daysInPeriod,
          extra_pay: extra_pay,
          total_pay: total_pay,
          payment_type: 'hourly'
        });
      }
    }

    res.json(result);

  } catch (err) {
    console.error('Error generando nómina:', err);
    res.status(500).json({ error: 'Error generando nómina: ' + err.message });
  }
});

/* ========================= GUARDAR NÓMINA ======================== */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { rows, start, end, type, payment_type = 'hourly' } = req.body;
    
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'rows debe ser array' });

    for (const r of rows) {
      // Calcular días del período
      const startDate = new Date(start);
      const endDate = new Date(end);
      const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

      // 1. Eliminar duplicados del mismo empleado y periodo
      await query(`
        DELETE FROM ${schema}.employee_payrolls
        WHERE employee_id = $1 AND period_start = $2 AND period_end = $3 AND payment_type = $4
      `, [r.employee_id, start, end, payment_type]);

      let base_salary_value;
      let total_pay_value;
      
      if (payment_type === 'daily') {
        // Para pago diario, guardamos el daily_rate como base_salary
        base_salary_value = r.daily_rate || 0;
        total_pay_value = r.total_pay || (base_salary_value * daysInPeriod);
      } else {
        // Para pago por horas, guardamos el hourly_rate
        base_salary_value = r.hourly_rate || 0;
        total_pay_value = r.total_pay || 0;
      }

      // 2. Insertar cabecera
      const insertPayroll = await query(`
        INSERT INTO ${schema}.employee_payrolls (
          employee_id, period_start, period_end, period_type, payment_type,
          base_salary, total_hours, extra_hours, total_days,
          bonuses, deductions, gross_salary, net_salary, status
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          0, 0,
          $10, $10, 'generated'
        ) RETURNING id
      `, [
        r.employee_id,                    // $1
        start,                            // $2
        end,                              // $3
        type || 'monthly',                // $4
        payment_type,                     // $5
        base_salary_value,                // $6
        r.total_hours || 0,               // $7
        r.extra_hours || 0,               // $8
        r.total_days || daysInPeriod,     // $9
        total_pay_value                   // $10
      ]);
      
      const payrollId = insertPayroll.rows[0]?.id;

      // 3. Insertar detalles
      if (payrollId) {
        if (payment_type === 'daily') {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, 'Sueldo diario x ' || $2 || ' días', 'daily_wage', $3)
          `, [payrollId, daysInPeriod, total_pay_value]);
        } else {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, 'Horas normales', 'regular', $2)
          `, [payrollId, (r.total_pay - (r.extra_pay || 0))]);
          
          if (r.extra_pay > 0) {
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
              VALUES ($1, 'Horas extras', 'overtime', $2)
            `, [payrollId, r.extra_pay]);
          }
        }
      }
    }

    res.json({ success: true, message: 'Nómina guardada correctamente' });

  } catch (err) {
    console.error('Error guardando nómina:', err);
    res.status(500).json({ error: 'Error guardando nómina: ' + err.message });
  }
});

/* =============== CONSULTAR NÓMINA GUARDADA ================ */
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end, payment_type = 'hourly' } = req.query;
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    const payrollRes = await query(`
      SELECT 
        p.id as payroll_id, 
        p.employee_id, 
        e.full_name, 
        p.total_hours,
        p.extra_hours, 
        p.total_days,
        p.base_salary,
        p.gross_salary as total_pay,
        p.payment_type
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.period_start = $1 AND p.period_end = $2 AND p.payment_type = $3
    `, [start, end, payment_type]);
    
    // Transformar los datos para que coincidan con lo que espera el frontend
    const transformed = payrollRes.rows.map(row => ({
      payroll_id: row.payroll_id,
      employee_id: row.employee_id,
      full_name: row.full_name,
      total_hours: row.total_hours || 0,
      extra_hours: row.extra_hours || 0,
      total_days: row.total_days || 0,
      hourly_rate: row.payment_type === 'hourly' ? row.base_salary : 0,
      daily_rate: row.payment_type === 'daily' ? row.base_salary : 0,
      total_pay: row.total_pay,
      payment_type: row.payment_type
    }));
    
    res.json(transformed);

  } catch (err) {
    console.error('Error consultando nómina guardada:', err);
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
    console.error('Error consultando detalle:', err);
    res.status(500).json({ error: 'Error consultando detalle' });
  }
});

export default router;