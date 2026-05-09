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
    
    // Verificar si la tabla existe
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
  // Crear tabla de nóminas
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
      status VARCHAR(20) DEFAULT 'pending',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      payment_type VARCHAR(20) DEFAULT 'hourly'
    )
  `);

  // Crear tabla de detalles de nómina
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
        COALESCE(salary, 0) as salary
      FROM ${schema}.employees
      WHERE status = 'active'
    `);
    
    console.log(`📊 Empleados encontrados: ${employeesRes.rows.length}`);

    if (employeesRes.rows.length === 0) {
      console.log('⚠️ No hay empleados activos');
      return res.json([]);
    }

    const result = [];

    // Calcular días del período
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`📅 Días en período: ${daysInPeriod}`);
    
    for (const emp of employeesRes.rows) {
      const salary = Number(emp.salary) || 0;
      console.log(`💰 Procesando: ${emp.full_name}, salary=${salary}`);
      
      if (payment_type === 'daily') {
        // PAGO DIARIO: Paga el sueldo fijo de la BD (por día)
        const total_pay = salary * daysInPeriod;
        
        console.log(`  - Pago Diario: $${total_pay} (${daysInPeriod} días x $${salary})`);
        
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
          payment_type: 'daily'
        });
      } else {
        // PAGO POR HORAS: Calcula valor hora y multiplica
        // Asumiendo jornada de 8 horas diarias
        const hourly_rate = salary / 8;
        const total_hours = 8 * daysInPeriod;
        const total_pay = hourly_rate * total_hours;
        
        console.log(`  - Pago por Horas: $${total_pay.toFixed(2)} (${total_hours} horas x $${hourly_rate.toFixed(2)})`);
        
        result.push({
          employee_id: emp.id,
          full_name: emp.full_name,
          total_hours: total_hours,
          extra_hours: 0,
          days_worked: daysInPeriod,
          hourly_rate: hourly_rate,
          daily_rate: salary,
          total_days: daysInPeriod,
          extra_pay: 0,
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

    // Mostrar datos de la primera fila para debug
    console.log('📋 Primera fila a guardar:', JSON.stringify(rows[0], null, 2));

    // Asegurar que las tablas existen
    await ensureTablesExist(schema);

    // Calcular días del período
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysInPeriod = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`📅 Días en período: ${daysInPeriod}`);

    let savedCount = 0;
    const errors = [];

    for (const r of rows) {
      try {
        console.log(`  💾 Procesando fila ${savedCount + 1}: ${r.full_name}`, {
          employee_id: r.employee_id,
          total_pay: r.total_pay,
          daily_rate: r.daily_rate,
          hourly_rate: r.hourly_rate
        });
        
        // Validar que tenemos employee_id
        if (!r.employee_id) {
          console.error(`  ❌ Fila sin employee_id para: ${r.full_name}`);
          errors.push(`Fila sin employee_id: ${r.full_name}`);
          continue;
        }

        // 1. Eliminar duplicados
        const deleteResult = await query(`
          DELETE FROM ${schema}.employee_payrolls
          WHERE employee_id = $1 AND period_start = $2 AND period_end = $3 AND payment_type = $4
        `, [r.employee_id, start, end, payment_type]);
        
        console.log(`     ✅ Eliminados: ${deleteResult.rowCount} registros duplicados`);

        let base_salary_value;
        let total_pay_value;
        
        if (payment_type === 'daily') {
          base_salary_value = Number(r.daily_rate) || 0;
          total_pay_value = Number(r.total_pay) || (base_salary_value * daysInPeriod);
        } else {
          base_salary_value = Number(r.hourly_rate) || 0;
          total_pay_value = Number(r.total_pay) || 0;
        }
        
        console.log(`     Base salary: ${base_salary_value}, Total pay: ${total_pay_value}`);

        // 2. Insertar cabecera
        const insertPayroll = await query(`
          INSERT INTO ${schema}.employee_payrolls (
            employee_id, period_start, period_end, payment_type,
            base_salary, total_hours, extra_hours,
            bonuses, deductions, gross_salary, net_salary, status, notes
          ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            0, 0, $8, $8, 'generated', ''
          ) RETURNING id
        `, [
          r.employee_id,
          start,
          end,
          payment_type,
          base_salary_value,
          Number(r.total_hours) || 0,
          Number(r.extra_hours) || 0,
          total_pay_value
        ]);
        
        const payrollId = insertPayroll.rows[0]?.id;
        
        if (!payrollId) {
          console.error(`  ❌ No se pudo obtener ID para: ${r.full_name}`);
          errors.push(`No se pudo obtener ID: ${r.full_name}`);
          continue;
        }
        
        console.log(`     ✅ Insertado payroll_id: ${payrollId}`);

        // 3. Insertar detalles
        if (payment_type === 'daily') {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, $2, 'daily_wage', $3)
          `, [payrollId, `Sueldo fijo diario x ${daysInPeriod} días`, total_pay_value]);
          console.log(`     ✅ Insertado detalle pago diario`);
        } else {
          await query(`
            INSERT INTO ${schema}.employee_payroll_details (payroll_id, concept, type, amount)
            VALUES ($1, $2, 'hourly_wage', $3)
          `, [payrollId, `Horas trabajadas x ${daysInPeriod} días`, total_pay_value]);
          console.log(`     ✅ Insertado detalle pago por horas`);
        }
        
        savedCount++;
        console.log(`  ✅ Guardado exitoso: ${r.full_name} - $${total_pay_value.toFixed(2)}`);
        
      } catch (rowError) {
        console.error(`  ❌ Error guardando fila para ${r.full_name}:`, rowError.message);
        errors.push(`${r.full_name}: ${rowError.message}`);
      }
    }

    console.log(`✅ Nómina guardada: ${savedCount} de ${rows.length} empleados`);
    
    if (errors.length > 0) {
      console.log('⚠️ Errores encontrados:', errors);
    }
    
    res.json({ 
      success: true, 
      message: `Nómina guardada correctamente (${savedCount} de ${rows.length} empleados)`,
      savedCount,
      totalRows: rows.length,
      errors: errors.length > 0 ? errors : undefined
    });

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

    await ensureTablesExist(schema);

    const payrollRes = await query(`
      SELECT 
        p.id as payroll_id, 
        p.employee_id, 
        e.full_name, 
        p.total_hours,
        p.extra_hours, 
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
      days_worked: daysInPeriod,
      total_days: daysInPeriod,
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
      
      // Verificar si el empleado existe en la BD
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

export default router;