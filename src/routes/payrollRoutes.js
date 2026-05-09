import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* ================= CREAR TABLAS SI NO EXISTEN ================== */
async function ensureTablesExist(schema) {
  // Crear tabla de nóminas
  await query(`
    CREATE TABLE IF NOT EXISTS ${schema}.employee_payrolls (
      id SERIAL PRIMARY KEY,
      employee_id UUID NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      period_type VARCHAR(20) DEFAULT 'monthly',
      payment_type VARCHAR(20) DEFAULT 'hourly',
      base_salary DECIMAL(12,2) DEFAULT 0,
      total_hours DECIMAL(10,2) DEFAULT 0,
      extra_hours DECIMAL(10,2) DEFAULT 0,
      days_worked INTEGER DEFAULT 0,
      total_days INTEGER DEFAULT 0,
      bonuses DECIMAL(12,2) DEFAULT 0,
      deductions DECIMAL(12,2) DEFAULT 0,
      gross_salary DECIMAL(12,2) DEFAULT 0,
      net_salary DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'generated',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Crear tabla de detalles de nómina
  await query(`
    CREATE TABLE IF NOT EXISTS ${schema}.employee_payroll_details (
      id SERIAL PRIMARY KEY,
      payroll_id INTEGER REFERENCES ${schema}.employee_payrolls(id) ON DELETE CASCADE,
      concept VARCHAR(100) NOT NULL,
      type VARCHAR(50) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Crear índice para búsquedas rápidas
  await query(`
    CREATE INDEX IF NOT EXISTS idx_employee_payrolls_period 
    ON ${schema}.employee_payrolls(period_start, period_end, payment_type)
  `);
}

/* ================= GENERAR NÓMINA (previsualización) ================== */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end, payment_type = 'hourly' } = req.body;
    
    console.log('📝 Generando nómina:', { start, end, payment_type, schema });
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    // Asegurar que las tablas existen
    await ensureTablesExist(schema);

    // Obtener empleados activos
    const employeesRes = await query(`
      SELECT 
        id, 
        full_name, 
        salary
      FROM ${schema}.employees
      WHERE status = 'active'
    `);
    
    console.log(`📊 Empleados encontrados: ${employeesRes.rows.length}`);

    const employees = employeesRes.rows;
    
    if (employees.length === 0) {
      return res.json([]);
    }

    const result = [];

    // Calcular días del período
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    
    for (const emp of employees) {
      // OBTENER ASISTENCIAS
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
      let daysWorked = 0;
      
      for (const d of Object.values(days)) {
        if (!d.check_in || !d.check_out) continue;
        daysWorked++;
        
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

      const salary = Number(emp.salary) || 0;
      
      if (payment_type === 'daily') {
        // PAGO DIARIO: Paga el sueldo fijo de la BD
        const total_pay = salary;
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: total_hours,
          extra_hours: extra_hours,
          days_worked: daysWorked,
          hourly_rate: 0,
          daily_rate: salary,
          total_days: daysInPeriod,
          extra_pay: 0,
          total_pay: total_pay,
          payment_type: 'daily'
        });
      } else {
        // PAGO POR HORAS: Calcula pago basado en horas trabajadas
        const hourly_rate = salary / 240;
        const normal_pay = total_hours * hourly_rate;
        const extra_pay = extra_hours * hourly_rate * 1.5;
        const total_pay = normal_pay + extra_pay;
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: total_hours,
          extra_hours: extra_hours,
          days_worked: daysWorked,
          hourly_rate: hourly_rate,
          daily_rate: salary,
          total_days: daysInPeriod,
          extra_pay: extra_pay,
          total_pay: total_pay,
          payment_type: 'hourly'
        });
      }
    }

    console.log(`✅ Resultado: ${result.length} empleados procesados`);
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
    
    console.log('💾 Guardando nómina:', { rowsCount: rows?.length, start, end, type, payment_type });
    
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows debe ser un array no vacío' });
    }

    // Asegurar que las tablas existen
    await ensureTablesExist(schema);

    // Calcular días del período
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    let savedCount = 0;

    for (const r of rows) {
      try {
        // 1. Eliminar duplicados
        await query(`
          DELETE FROM ${schema}.employee_payrolls
          WHERE employee_id = $1 AND period_start = $2 AND period_end = $3 AND payment_type = $4
        `, [r.employee_id, start, end, payment_type]);

        let base_salary_value;
        let total_pay_value;
        
        if (payment_type === 'daily') {
          base_salary_value = r.daily_rate || 0;
          total_pay_value = r.total_pay || base_salary_value;
        } else {
          base_salary_value = r.hourly_rate || 0;
          total_pay_value = r.total_pay || 0;
        }

        // 2. Insertar cabecera
        const insertPayroll = await query(`
          INSERT INTO ${schema}.employee_payrolls (
            employee_id, period_start, period_end, period_type, payment_type,
            base_salary, total_hours, extra_hours, days_worked, total_days,
            bonuses, deductions, gross_salary, net_salary, status
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            0, 0,
            $11, $11, 'generated'
          ) RETURNING id
        `, [
          r.employee_id,
          start,
          end,
          type || 'monthly',
          payment_type,
          base_salary_value,
          r.total_hours || 0,
          r.extra_hours || 0,
          r.days_worked || 0,
          daysInPeriod,
          total_pay_value
        ]);
        
        const payrollId = insertPayroll.rows[0]?.id;
        
        if (!payrollId) {
          console.error('❌ No se pudo obtener ID para:', r.full_name);
          continue;
        }

        // 3. Insertar detalles
        if (payment_type === 'daily') {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, 'Sueldo fijo diario', 'daily_wage', $2)
          `, [payrollId, total_pay_value]);
          
          if (r.total_hours > 0) {
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount, notes)
              VALUES ($1, 'Horas trabajadas (referencia)', 'reference', $2, $3)
            `, [payrollId, 0, `Total horas: ${r.total_hours.toFixed(2)}, Días: ${r.days_worked}`]);
          }
        } else {
          const normalPay = (r.total_pay || 0) - (r.extra_pay || 0);
          if (normalPay > 0) {
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
              VALUES ($1, 'Horas normales', 'regular', $2)
            `, [payrollId, normalPay]);
          }
          
          if (r.extra_pay > 0) {
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
              VALUES ($1, 'Horas extras', 'overtime', $2)
            `, [payrollId, r.extra_pay]);
          }
        }
        
        savedCount++;
        console.log(`✅ Guardado: ${r.full_name} - $${total_pay_value.toFixed(2)}`);
        
      } catch (rowError) {
        console.error(`❌ Error guardando fila para ${r.full_name}:`, rowError.message);
        // Continuar con la siguiente fila
      }
    }

    console.log(`✅ Nómina guardada: ${savedCount} de ${rows.length} empleados`);
    res.json({ success: true, message: `Nómina guardada correctamente (${savedCount} empleados)` });

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
    
    console.log('📋 Consultando nómina guardada:', { start, end, payment_type });
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    // Asegurar que las tablas existen
    await ensureTablesExist(schema);

    const payrollRes = await query(`
      SELECT 
        p.id as payroll_id, 
        p.employee_id, 
        e.full_name, 
        p.total_hours,
        p.extra_hours, 
        p.days_worked,
        p.total_days,
        p.base_salary,
        p.gross_salary as total_pay,
        p.payment_type
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.period_start = $1 AND p.period_end = $2 AND p.payment_type = $3
      ORDER BY e.full_name
    `, [start, end, payment_type]);
    
    const transformed = payrollRes.rows.map(row => ({
      payroll_id: row.payroll_id,
      employee_id: row.employee_id,
      full_name: row.full_name,
      total_hours: Number(row.total_hours) || 0,
      extra_hours: Number(row.extra_hours) || 0,
      days_worked: Number(row.days_worked) || 0,
      total_days: Number(row.total_days) || 0,
      hourly_rate: row.payment_type === 'hourly' ? Number(row.base_salary) : 0,
      daily_rate: row.payment_type === 'daily' ? Number(row.base_salary) : 0,
      total_pay: Number(row.total_pay) || 0,
      payment_type: row.payment_type
    }));
    
    console.log(`📊 Nóminas encontradas: ${transformed.length}`);
    res.json(transformed);

  } catch (err) {
    console.error('Error consultando nómina guardada:', err);
    res.status(500).json({ error: 'Error consultando nómina guardada: ' + err.message });
  }
});

/* =============== CONSULTAR DETALLE DE UNA NÓMINA ================ */
router.get('/details/:payroll_id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { payroll_id } = req.params;
    
    if (!payroll_id) return res.status(400).json({ error: 'payroll_id requerido' });

    const detailsRes = await query(`
      SELECT concept, type, amount, notes
      FROM ${schema}.employee_payroll_details
      WHERE payroll_id = $1
      ORDER BY created_at ASC
    `, [payroll_id]);
    
    res.json(detailsRes.rows || []);

  } catch (err) {
    console.error('Error consultando detalle:', err);
    res.json([]);
  }
});

export default router;