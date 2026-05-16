import express from 'express';
import { query } from '../config/database.js';
import { getSchemaName } from '../utils/tenantHelper.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

/* ================= DIAGNÓSTICO - VER EMPLEADOS ================== */
router.get('/test-employees', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    console.log('🔍 Schema para diagnóstico:', schema);
    
    const tableCheck = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = $1 AND table_name = 'employees'
      ) as exists
    `, [schema]);
    
    console.log('📋 Tabla employees existe:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      return res.json([]);
    }
    
    const employees = await query(`
      SELECT id, full_name, status, salary 
      FROM ${schema}.employees
      WHERE status = 'active'
    `);
    
    console.log(`📊 Empleados activos encontrados: ${employees.rows.length}`);
    employees.rows.forEach(emp => {
      console.log(`  - ${emp.full_name}: status=${emp.status}, salary=${emp.salary}`);
    });
    
    res.json(employees.rows);
  } catch (err) {
    console.error('Error diagnóstico:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ================= CREAR TABLAS SI NO EXISTEN ================== */
async function ensureTablesExist(schema) {
  await query(`
    CREATE TABLE IF NOT EXISTS ${schema}.employee_payrolls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id UUID NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      payment_date DATE,
      base_salary DECIMAL(12,2) DEFAULT 0,
      total_hours DECIMAL(10,2) DEFAULT 0,
      extra_hours DECIMAL(10,2) DEFAULT 0,
      bonuses DECIMAL(12,2) DEFAULT 0,
      deductions DECIMAL(12,2) DEFAULT 0,
      gross_salary DECIMAL(12,2) DEFAULT 0,
      net_salary DECIMAL(12,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'generated',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      payment_type VARCHAR(20) DEFAULT 'hourly'
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS ${schema}.employee_payroll_details (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      payroll_id UUID REFERENCES ${schema}.employee_payrolls(id) ON DELETE CASCADE,
      concept VARCHAR(100) NOT NULL,
      type VARCHAR(50) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log(`✅ Tablas aseguradas en schema: ${schema}`);
}

/* ================= GENERAR NÓMINA (previsualización) ================== */
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end, payment_type = 'hourly', employee_ids } = req.body;
    
    console.log('📝 Generando nómina:', { start, end, payment_type, employee_ids, schema });
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    await ensureTablesExist(schema);

    let params = [];
    let whereClause = "WHERE status = 'active'";
    
    if (employee_ids && Array.isArray(employee_ids) && employee_ids.length > 0) {
      whereClause += " AND id = ANY($1)";
      params = [employee_ids];
    }

    const employeesRes = await query(`
      SELECT 
        id, 
        full_name, 
        COALESCE(salary, 0) as salary
      FROM ${schema}.employees
      ${whereClause}
    `, params);
    
    console.log(`📊 Empleados encontrados: ${employeesRes.rows.length}`);

    if (employeesRes.rows.length === 0) {
      console.log('⚠️ No hay empleados activos');
      return res.json([]);
    }

    const result = [];
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`📅 Días en período: ${daysInPeriod}`);
    
    for (const emp of employeesRes.rows) {
      const salary = Number(emp.salary) || 0;
      console.log(`💰 Procesando: ${emp.full_name}, salary=${salary}`);
      
      if (payment_type === 'daily') {
        // Pago diario: usa el sueldo como monto fijo diario
        const total_pay = salary * daysInPeriod;
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: 0,
          extra_hours: 0,
          days_worked: daysInPeriod,
          hourly_rate: 0,
          daily_rate: salary,
          total_days: daysInPeriod,
          extra_pay: 0,
          total_pay: total_pay,
          payment_type: 'daily',
          ordinary_hours: 0,
          night_hours: 0,
          supplementary_hours: 0,
          extraordinary_hours: 0
        });
      } else {
        // Pago por horas: usa el sueldo como sueldo mensual
        // Obtener horas reales trabajadas
        const workedHoursRes = await query(`
          SELECT 
            worked_date,
            SUM(hours) as daily_hours
          FROM ${schema}.worked_hours
          WHERE employee_id = $1 
            AND worked_date >= $2::DATE
            AND worked_date <= $3::DATE
          GROUP BY worked_date
          ORDER BY worked_date
        `, [emp.id, start, end]);

        console.log(`    📊 Horas encontradas para ${emp.full_name}: ${workedHoursRes.rows.length} días`);

        // Calcular horas según el ministerio de trabajo
        const hourlyRate = salary / 240; // SBU / 240 horas mensuales
        
        let ordinary_hours = 0;
        let night_hours = 0;
        let supplementary_hours = 0;
        let extraordinary_hours = 0;
        let total_hours = 0;
        
        // Si no hay horas registradas, usar 8 horas diarias como estándar
        if (workedHoursRes.rows.length === 0) {
          console.log(`    ⚠️ Sin horas registradas. Usando 8h/día x ${daysInPeriod} días = ${8 * daysInPeriod}h`);
          ordinary_hours = 8 * daysInPeriod;
          total_hours = 8 * daysInPeriod;
        } else {
          // Procesar horas registradas
          for (const dayRow of workedHoursRes.rows) {
            const dailyHours = Number(dayRow.daily_hours) || 0;
            total_hours += dailyHours;
            
            // Primeras 8 horas: ordinarias
            if (dailyHours <= 8) {
              ordinary_hours += dailyHours;
            } else {
              // 8 horas ordinarias
              ordinary_hours += 8;
              const extraHours = dailyHours - 8;
              
              // Determinar si es fin de semana/feriado (extraordinarias) o suplementarias
              const dayOfWeek = new Date(dayRow.worked_date).getDay();
              if (dayOfWeek === 0 || dayOfWeek === 6) {
                // Fin de semana: extraordinarias (100% extra)
                extraordinary_hours += extraHours;
              } else {
                // Entre semana: suplementarias (50% extra)
                supplementary_hours += extraHours;
              }
            }
          }
        }

        // Calcular monto por tipo de hora (basado en ministerio de trabajo Ecuador)
        const ordinaryAmount = ordinary_hours * hourlyRate; // $2.01 * 0%
        const nightAmount = night_hours * (hourlyRate * 1.25); // $2.01 * 1.25
        const supplementaryAmount = supplementary_hours * (hourlyRate * 1.50); // $2.01 * 1.5
        const extraordinaryAmount = extraordinary_hours * (hourlyRate * 2.00); // $2.01 * 2
        const total_pay = ordinaryAmount + nightAmount + supplementaryAmount + extraordinaryAmount;
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: total_hours,
          extra_hours: supplementary_hours + extraordinary_hours,
          days_worked: workedHoursRes.rows.length,
          hourly_rate: hourlyRate,
          daily_rate: salary,
          total_days: daysInPeriod,
          extra_pay: nightAmount + supplementaryAmount + extraordinaryAmount,
          total_pay: total_pay,
          payment_type: 'hourly',
          ordinary_hours: ordinary_hours,
          night_hours: night_hours,
          supplementary_hours: supplementary_hours,
          extraordinary_hours: extraordinary_hours
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
  let client = null;
  try {
    const schema = await getSchemaName(req);
    const { rows, start, end, type, payment_type = 'hourly' } = req.body;
    
    console.log('💾 Guardando nómina:', { 
      rowsCount: rows?.length, 
      start, 
      end, 
      period_type: type, 
      payment_type,
      schema
    });
    
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'rows debe ser un array no vacío' });
    }

    await ensureTablesExist(schema);

    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    let savedCount = 0;
    const errors = [];

    for (const r of rows) {
      try {
        if (!r.employee_id) {
          console.error(`  ❌ Fila sin employee_id para: ${r.full_name}`);
          errors.push(`Fila sin employee_id: ${r.full_name}`);
          continue;
        }

        // Eliminar duplicados existentes
        const deleteResult = await query(`
          DELETE FROM ${schema}.employee_payrolls
          WHERE employee_id = $1 AND period_start = $2::DATE AND period_end = $3::DATE AND payment_type = $4
        `, [r.employee_id, start, end, payment_type]);
        console.log(`  🗑️  Eliminados duplicados: ${deleteResult.rowCount} filas`);

        let base_salary_value;
        let total_pay_value;
        let total_hours_value = 0;
        let extra_hours_value = 0;
        
        if (payment_type === 'daily') {
          base_salary_value = Number(r.daily_rate) || 0;
          total_pay_value = Number(r.total_pay) || (base_salary_value * daysInPeriod);
          console.log(`    Pago diario: $${base_salary_value}/día × ${daysInPeriod} días = $${total_pay_value}`);
        } else {
          base_salary_value = Number(r.hourly_rate) || 0;
          total_pay_value = Number(r.total_pay) || 0;
          total_hours_value = Number(r.total_hours) || 0;
          extra_hours_value = Number(r.extra_hours) || 0;
          console.log(`    Pago horario: $${base_salary_value}/h × ${total_hours_value}h = $${total_pay_value}`);
        }

        const insertPayroll = await query(`
          INSERT INTO ${schema}.employee_payrolls (
            employee_id, period_start, period_end, payment_type,
            base_salary, total_hours, extra_hours,
            bonuses, deductions, gross_salary, net_salary, status, notes
          ) VALUES (
            $1, $2::DATE, $3::DATE, $4,
            $5, $6, $7,
            0, 0, $8, $8, 'generated', ''
          ) RETURNING id
        `, [
          r.employee_id,
          start,
          end,
          payment_type,
          base_salary_value,
          total_hours_value,
          extra_hours_value,
          total_pay_value
        ]);
        
        console.log(`  ✅ Insertado payroll para ${r.full_name}, total_pay=${total_pay_value}`);
        
        const payrollId = insertPayroll.rows[0]?.id;
        
        if (!payrollId) {
          console.error(`  ❌ No se pudo obtener ID para: ${r.full_name}`);
          errors.push(`No se pudo obtener ID: ${r.full_name}`);
          continue;
        }

        // Guardar detalles del pago según tipo
        if (payment_type === 'daily') {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, $2, 'daily_wage', $3)
          `, [payrollId, `Sueldo fijo diario x ${daysInPeriod} días @ $${base_salary_value.toFixed(2)}/día`, total_pay_value]);
        } else {
          // Pago por horas: guardar detalles de cada tipo de hora
          const hourlyRate = base_salary_value;
          
          if (Number(r.ordinary_hours) > 0) {
            const ordinaryAmount = Number(r.ordinary_hours) * hourlyRate;
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount, notes)
              VALUES ($1, $2, 'ordinary_hours', $3, $4)
            `, [payrollId, `Horas ordinarias`, ordinaryAmount, `${Number(r.ordinary_hours).toFixed(2)}h @ $${hourlyRate.toFixed(2)}/h`]);
          }
          
          if (Number(r.night_hours) > 0) {
            const nightAmount = Number(r.night_hours) * (hourlyRate * 1.25);
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount, notes)
              VALUES ($1, $2, 'night_hours', $3, $4)
            `, [payrollId, `Horas nocturnas (25% recargo)`, nightAmount, `${Number(r.night_hours).toFixed(2)}h @ $${(hourlyRate * 1.25).toFixed(2)}/h`]);
          }
          
          if (Number(r.supplementary_hours) > 0) {
            const supplementaryAmount = Number(r.supplementary_hours) * (hourlyRate * 1.50);
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount, notes)
              VALUES ($1, $2, 'supplementary_hours', $3, $4)
            `, [payrollId, `Horas suplementarias (50% recargo)`, supplementaryAmount, `${Number(r.supplementary_hours).toFixed(2)}h @ $${(hourlyRate * 1.50).toFixed(2)}/h`]);
          }
          
          if (Number(r.extraordinary_hours) > 0) {
            const extraordinaryAmount = Number(r.extraordinary_hours) * (hourlyRate * 2.00);
            await query(`
              INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount, notes)
              VALUES ($1, $2, 'extraordinary_hours', $3, $4)
            `, [payrollId, `Horas extraordinarias (100% recargo)`, extraordinaryAmount, `${Number(r.extraordinary_hours).toFixed(2)}h @ $${(hourlyRate * 2.00).toFixed(2)}/h`]);
          }
        }
        
        savedCount++;
        
      } catch (rowError) {
        console.error(`  ❌ Error guardando fila para ${r.full_name}:`, rowError.message);
        errors.push(`${r.full_name}: ${rowError.message}`);
      }
    }

    console.log(`✅ Nómina guardada: ${savedCount} de ${rows.length} empleados`);
    
    if (errors.length > 0) {
      console.error('❌ ERRORES DURANTE GUARDADO:', errors);
    }
    
    res.json({ 
      success: true, 
      message: `Nómina guardada correctamente (${savedCount} de ${rows.length} empleados)`,
      savedCount,
      totalRows: rows.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (err) {
    console.error('❌ Error crítico guardando nómina:', err);
    res.status(500).json({ error: 'Error guardando nómina: ' + err.message });
  }
});

/* =============== CONSULTAR NÓMINA GUARDADA (SOLO NO PAGADAS) ================ */
router.get('/saved', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start, end, payment_type = 'hourly' } = req.query;
    
    console.log('📋 Consultando nómina guardada (no pagadas):', { start, end, payment_type });
    
    if (!start || !end) return res.status(400).json({ error: 'Fechas requeridas' });

    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;

    await ensureTablesExist(schema);

    // FILTRO: SOLO status != 'paid'
    const payrollRes = await query(`
      SELECT 
        p.id as payroll_id, 
        p.employee_id, 
        e.full_name, 
        p.total_hours,
        p.extra_hours, 
        p.base_salary,
        p.gross_salary as total_pay,
        p.payment_type,
        p.status
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.period_start = $1 
        AND p.period_end = $2 
        AND p.payment_type = $3
        AND p.status != 'paid'
      ORDER BY e.full_name
    `, [start, end, payment_type]);
    
    const transformed = payrollRes.rows.map(row => ({
      payroll_id: row.payroll_id,
      employee_id: row.employee_id,
      full_name: row.full_name,
      total_hours: Number(row.total_hours) || 0,
      extra_hours: Number(row.extra_hours) || 0,
      days_worked: daysInPeriod,
      total_days: daysInPeriod,
      hourly_rate: row.payment_type === 'hourly' ? Number(row.base_salary) : 0,
      daily_rate: row.payment_type === 'daily' ? Number(row.base_salary) : 0,
      total_pay: Number(row.total_pay) || 0,
      payment_type: row.payment_type,
      status: row.status,
      ordinary_hours: 0,
      night_hours: 0,
      supplementary_hours: 0,
      extraordinary_hours: 0
    }));
    
    console.log(`📊 Nóminas no pagadas encontradas: ${transformed.length}`);
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
    
    console.log('📋 Consultando detalle de nómina:', payroll_id);
    
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

/* ================= DIAGNOSTICAR NÓMINA ================== */
router.post('/diagnostic', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { rows, start, end, payment_type } = req.body;
    
    console.log('🔍 DIAGNÓSTICO DE NÓMINA:');
    console.log('Schema:', schema);
    console.log('Rows recibidas:', rows?.length);
    console.log('Start:', start);
    console.log('End:', end);
    console.log('Payment type:', payment_type);
    
    if (rows && rows.length > 0) {
      console.log('Primera fila:', JSON.stringify(rows[0], null, 2));
      
      const employeeCheck = await query(`
        SELECT id, full_name, status FROM ${schema}.employees WHERE id = $1
      `, [rows[0].employee_id]);
      
      console.log('Empleado en BD:', employeeCheck.rows[0]);
    }
    
    res.json({ message: 'Diagnóstico completado, revisa la consola del servidor' });
  } catch (err) {
    console.error('Error diagnóstico:', err);
    res.status(500).json({ error: err.message });
  }
});

/* =============== OBTENER TODAS LAS NÓMINAS GUARDADAS AGRUPADAS (SOLO NO PAGADAS) ================ */
router.get('/all-saved', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    console.log('📋 Consultando todas las nóminas guardadas no pagadas en schema:', schema);
    
    await ensureTablesExist(schema);
    
    // FILTRO: SOLO status != 'paid'
    const payrollsRes = await query(`
      SELECT 
        p.id as payroll_id,
        p.employee_id,
        p.period_start as start_date,
        p.period_end as end_date,
        p.payment_type,
        p.base_salary,
        p.total_hours,
        p.extra_hours,
        p.gross_salary as total_pay,
        p.status,
        p.created_at,
        e.full_name,
        e.salary
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.status != 'paid'
      ORDER BY p.period_start DESC, p.created_at DESC
    `);
    
    console.log(`📊 Nóminas no pagadas encontradas: ${payrollsRes.rows.length}`);
    
    const groupedPayrolls = new Map();
    
    payrollsRes.rows.forEach(payroll => {
      const key = `${payroll.start_date}|${payroll.end_date}`;
      
      if (!groupedPayrolls.has(key)) {
        groupedPayrolls.set(key, {
          start_date: payroll.start_date,
          end_date: payroll.end_date,
          payment_type: payroll.payment_type,
          total_amount: 0,
          total_employees: 0,
          employees: []
        });
      }
      
      const group = groupedPayrolls.get(key);
      group.total_amount += Number(payroll.total_pay) || 0;
      group.total_employees += 1;
      group.employees.push({
        payroll_id: payroll.payroll_id,
        employee_id: payroll.employee_id,
        full_name: payroll.full_name,
        total_hours: Number(payroll.total_hours) || 0,
        extra_hours: Number(payroll.extra_hours) || 0,
        total_pay: Number(payroll.total_pay) || 0,
        base_salary: Number(payroll.base_salary) || 0,
        payment_type: payroll.payment_type,
        daily_rate: payroll.payment_type === 'daily' ? (Number(payroll.base_salary) || 0) : 0,
        hourly_rate: payroll.payment_type === 'hourly' ? (Number(payroll.base_salary) || 0) : 0,
        status: payroll.status
      });
    });
    
    const result = Array.from(groupedPayrolls.values());
    console.log(`📊 Grupos de nóminas no pagadas: ${result.length}`);
    
    res.json(result);
    
  } catch (err) {
    console.error('Error obteniendo todas las nóminas:', err);
    res.status(500).json({ error: 'Error obteniendo nóminas: ' + err.message });
  }
});

/* =============== OBTENER DETALLE DE NÓMINA POR FECHA (SOLO NO PAGADAS) ================ */
router.get('/saved-by-date', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { start_date, end_date } = req.query;
    
    console.log('📋 Consultando detalle de nómina por fecha (solo no pagadas):', { start_date, end_date, schema });
    
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date y end_date son requeridos' });
    }
    
    await ensureTablesExist(schema);
    
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    
    // FILTRO: SOLO status != 'paid'
    const payrollsRes = await query(`
      SELECT 
        p.id as payroll_id,
        p.employee_id,
        p.period_start as start_date,
        p.period_end as end_date,
        p.payment_type,
        p.base_salary,
        p.total_hours,
        p.extra_hours,
        p.gross_salary as total_pay,
        p.status,
        p.created_at,
        e.full_name,
        e.salary
      FROM ${schema}.employee_payrolls p
      JOIN ${schema}.employees e ON e.id = p.employee_id
      WHERE p.period_start = $1 
        AND p.period_end = $2
        AND p.status != 'paid'
      ORDER BY e.full_name
    `, [start_date, end_date]);
    
    console.log(`📊 Detalles no pagados encontrados: ${payrollsRes.rows.length}`);
    
    const transformed = payrollsRes.rows.map(row => ({
      payroll_id: row.payroll_id,
      employee_id: row.employee_id,
      full_name: row.full_name,
      total_hours: Number(row.total_hours) || 0,
      extra_hours: Number(row.extra_hours) || 0,
      days_worked: daysInPeriod,
      total_days: daysInPeriod,
      hourly_rate: row.payment_type === 'hourly' ? (Number(row.base_salary) || 0) : 0,
      daily_rate: row.payment_type === 'daily' ? (Number(row.base_salary) || 0) : Number(row.salary) || 0,
      total_pay: Number(row.total_pay) || 0,
      payment_type: row.payment_type,
      status: row.status
    }));
    
    res.json(transformed);
    
  } catch (err) {
    console.error('Error consultando detalle por fecha:', err);
    res.status(500).json({ error: 'Error consultando detalle: ' + err.message });
  }
});

/* =============== ELIMINAR NÓMINA ================ */
router.delete('/:payroll_id', authMiddleware, async (req, res) => {
  try {
    const schema = await getSchemaName(req);
    const { payroll_id } = req.params;
    
    console.log('🗑️ Eliminando nómina:', payroll_id);
    
    if (!payroll_id) {
      return res.status(400).json({ error: 'payroll_id requerido' });
    }
    
    await ensureTablesExist(schema);
    
    const result = await query(`
      DELETE FROM ${schema}.employee_payrolls
      WHERE id = $1
      RETURNING id
    `, [payroll_id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Nómina no encontrada' });
    }
    
    console.log(`✅ Nómina eliminada: ${payroll_id}`);
    res.json({ success: true, message: 'Nómina eliminada correctamente' });
    
  } catch (err) {
    console.error('Error eliminando nómina:', err);
    res.status(500).json({ error: 'Error eliminando nómina: ' + err.message });
  }
});

/* =============== REGISTRAR PAGO DE NÓMINA ================ */
router.post('/pay', authMiddleware, async (req, res) => {
  let client = null;
  try {
    const schema = await getSchemaName(req);
    const { payroll_id, employee_id, employee_name, amount, payment_method, user_id } = req.body;
    
    console.log('💰 Registrando pago de nómina:', { payroll_id, employee_name, amount, payment_method });
    
    if (!payroll_id || !amount || amount <= 0) {
      return res.status(400).json({ error: 'payroll_id y amount válido son requeridos' });
    }
    
    let payrollCategoryId = null;
    
    const catResult = await query(`
      SELECT id FROM "${schema}".expense_categories 
      WHERE LOWER(name) = 'nómina' OR LOWER(name) = 'nomina'
      LIMIT 1
    `);
    
    if (catResult.rows.length > 0) {
      payrollCategoryId = catResult.rows[0].id;
    } else {
      const insertCat = await query(`
        INSERT INTO "${schema}".expense_categories (name, description, color)
        VALUES ('Nómina', 'Pagos de nómina a empleados', '#10b981')
        RETURNING id
      `);
      payrollCategoryId = insertCat.rows[0].id;
    }
    
    const expenseResult = await query(`
      INSERT INTO "${schema}".expenses (amount, description, reference, category_id, created_by, date)
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
      RETURNING id
    `, [
      amount,
      `Pago de nómina a ${employee_name} - ${payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}`,
      `Payroll ID: ${payroll_id}`,
      payrollCategoryId,
      user_id || null
    ]);
    
    await query(`
      UPDATE "${schema}".employee_payrolls 
      SET status = 'paid', payment_date = CURRENT_DATE
      WHERE id = $1
    `, [payroll_id]);

    await query(`
      INSERT INTO "${schema}".audit_logs (
        user_id, action, table_name, description, new_values, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, NOW()
      )
    `, [
      user_id || null,
      'payroll_payment',
      'expenses',
      `Pago de nómina a ${employee_name} por $${amount} - Método: ${payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}`,
      JSON.stringify({ amount, employee_id, employee_name, payment_method, payroll_id })
    ]);
    
    res.json({ 
      success: true, 
      message: `Pago de nómina a ${employee_name} por $${amount} registrado correctamente`,
      expense_id: expenseResult.rows[0].id
    });
    
  } catch (err) {
    console.error('Error registrando pago de nómina:', err);
    res.status(500).json({ error: 'Error registrando pago: ' + err.message });
  }
});

export default router;