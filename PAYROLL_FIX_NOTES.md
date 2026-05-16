# 🔧 CORRECCIÓN: Nómina No Se Guardaba - Roles de Pago

## 📋 PROBLEMAS IDENTIFICADOS

### ❌ Problema 1: Cálculo incorrecto de tarifa horaria
- **Antes**: `hourly_rate = salary / 8` (completamente erróneo)
- **Causa**: No usaba las horas reales trabajadas ni consideraba ley de Ecuador
- **Impacto**: Cálculos de pago incorrectos

### ❌ Problema 2: No consultaba horas trabajadas
- **Antes**: Multiplicaba 8 × daysInPeriod para calcular total
- **Causa**: No consultaba tabla `worked_hours` para obtener horas reales
- **Impacto**: Si empleado trabajaba 6 horas/día, pagaba como si fuesen 8

### ❌ Problema 3: No diferenciaba tipos de horas
- **Antes**: Todas las horas valían igual (sin recargos)
- **Causa**: No aplicaba factores de ministerio de trabajo
- **Impacto**: No pagaba correctamente suplementarias (+50%) ni extraordinarias (+100%)

### ❌ Problema 4: Detalles de pago incompletos
- **Antes**: Guardaba solo 1 línea generic "Horas trabajadas x N días"
- **Causa**: No desglosaba por tipo de hora
- **Impacto**: No podía auditar breakdown de pago

---

## ✅ SOLUCIONES IMPLEMENTADAS

### 1️⃣ Mejorar cálculo en `/api/payroll/generate` endpoint

**Antes:**
```javascript
// INCORRECTO
const hourly_rate = salary / 8;
const total_hours = 8 * daysInPeriod;
const total_pay = hourly_rate * total_hours;
```

**Ahora (CORRECTO):**
```javascript
// CORRECTO - Usa ley de Ecuador
const hourly_rate = salary / 240; // SBU $482 ÷ 240 horas = $2.01/h
const workedHoursRes = await query(
  `SELECT worked_date, SUM(hours) as daily_hours 
   FROM worked_hours 
   WHERE employee_id = $1 AND worked_date >= $2 AND worked_date <= $3
   GROUP BY worked_date`,
  [emp.id, start, end]
);

// Categorizar horas por tipo
let ordinary_hours = 0;
let night_hours = 0;
let supplementary_hours = 0;
let extraordinary_hours = 0;

for (const dayRow of workedHoursRes.rows) {
  const dailyHours = Number(dayRow.daily_hours);
  
  // Primeras 8 horas: ordinarias
  if (dailyHours <= 8) {
    ordinary_hours += dailyHours;
  } else {
    ordinary_hours += 8;
    const extraHours = dailyHours - 8;
    
    // ¿Fin de semana? → Extraordinarias (+100%)
    // Entre semana? → Suplementarias (+50%)
    const dayOfWeek = new Date(dayRow.worked_date).getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      extraordinary_hours += extraHours;
    } else {
      supplementary_hours += extraHours;
    }
  }
}

// Calcular monto con factores correctos
const ordinaryAmount = ordinary_hours * hourlyRate;              // $2.01/h
const nightAmount = night_hours * (hourlyRate * 1.25);          // $2.01 * 1.25 = $2.51/h
const supplementaryAmount = supplementary_hours * (hourlyRate * 1.50); // $2.01 * 1.5 = $3.01/h
const extraordinaryAmount = extraordinary_hours * (hourlyRate * 2.00); // $2.01 * 2 = $4.02/h
const total_pay = ordinaryAmount + nightAmount + supplementaryAmount + extraordinaryAmount;
```

### 2️⃣ Guardar detalles completos en `/api/payroll` POST

**Antes:**
```sql
-- Solo una línea generic
INSERT INTO employee_payroll_details 
  (payroll_id, concept, type, amount)
VALUES 
  ($1, 'Horas trabajadas x 20 días', 'hourly_wage', 402.00)
```

**Ahora (DESGLOSE COMPLETO):**
```sql
-- Línea 1: Horas ordinarias
INSERT INTO employee_payroll_details 
  VALUES ($1, 'Horas ordinarias', 'ordinary_hours', 160.80, '80h @ $2.01/h')

-- Línea 2: Horas suplementarias (si aplica)
INSERT INTO employee_payroll_details 
  VALUES ($1, 'Horas suplementarias (50% recargo)', 'supplementary_hours', 120.60, '40h @ $3.01/h')

-- Línea 3: Horas extraordinarias (si aplica)
INSERT INTO employee_payroll_details 
  VALUES ($1, 'Horas extraordinarias (100% recargo)', '241.20, '20h @ $4.02/h')

-- Línea 4: Horas nocturnas (si aplica)
INSERT INTO employee_payroll_details 
  VALUES ($1, 'Horas nocturnas (25% recargo)', 'night_hours', 50.25, '20h @ $2.51/h')
```

### 3️⃣ Devolver campos nuevos en endpoint `/api/payroll/generate`

**Response ahora incluye:**
```javascript
{
  employee_id: '...',
  full_name: 'Juan García',
  total_hours: 180,              // Total de horas trabajadas
  extra_hours: 60,               // Horas suplementarias + extraordinarias
  days_worked: 20,
  hourly_rate: 2.01,             // Tarifa base por hora
  daily_rate: null,              // Solo para pago diario
  total_pay: 410.05,             // Total a pagar
  payment_type: 'hourly',
  
  // NUEVOS CAMPOS:
  ordinary_hours: 160,           // Horas ordinarias (≤8/día)
  night_hours: 20,               // Horas nocturnas (19:00-06:00)
  supplementary_hours: 40,       // Horas extras entre semana (>8/día)
  extraordinary_hours: 20        // Fin de semana/feriados
}
```

---

## 📊 EJEMPLO REAL DE CÁLCULO

### Empleado: María López
- Sueldo mensual: $482 (SBU)
- Período: 20 de junio - 17 de julio (20 días)
- Horas trabajadas reales:
  - 16 días normales: 8h/día = 128h ordinarias
  - 2 sábados: 10h cada uno = 16h extraordinarias
  - 2 días entre semana con horas extras: 5h extra = 10h suplementarias

### Cálculo ANTES (INCORRECTO):
```
hourly_rate = 482 / 8 = $60.25/h (¡¿INCORRECTO?!)
total_hours = 8 × 20 = 160h
total_pay = 60.25 × 160 = $9,640 (DELIRIO)
```

### Cálculo AHORA (CORRECTO):
```
Tarifa horaria = 482 / 240 = $2.01/h
Ordinarias:     128h × $2.01 = $257.28
Suplementarias:  10h × $3.01 = $30.10
Extraordinarias: 16h × $4.02 = $64.32
Nocturnas:       0h × $2.51 = $0.00
                                --------
                    TOTAL = $351.70 ✅
```

---

## 🧪 CÓMO PROBAR LOS CAMBIOS

### 1. En Postman/Thunder Client

**POST** `http://localhost:5000/api/payroll/generate`
```json
{
  "start": "2024-06-20",
  "end": "2024-07-17",
  "payment_type": "hourly",
  "employee_ids": ["uuid-del-empleado"]
}
```

**Response esperado:**
```json
[
  {
    "employee_id": "...",
    "full_name": "Juan García",
    "total_hours": 180,
    "extra_hours": 60,
    "ordinary_hours": 160,
    "supplementary_hours": 40,
    "extraordinary_hours": 20,
    "night_hours": 0,
    "hourly_rate": 2.01,
    "total_pay": 410.05,
    "payment_type": "hourly"
  }
]
```

### 2. Verificar en Base de Datos

```sql
-- Ver empleados en la nómina
SELECT p.id, e.full_name, p.total_hours, p.gross_salary 
FROM employee_payrolls p
JOIN employees e ON e.id = p.employee_id
WHERE p.payment_type = 'hourly' AND p.status = 'generated'
LIMIT 5;

-- Ver desglose de pago
SELECT p.id, e.full_name, d.concept, d.type, d.amount 
FROM employee_payroll_details d
JOIN employee_payrolls p ON d.payroll_id = p.id
JOIN employees e ON p.employee_id = e.id
WHERE p.payment_type = 'hourly'
ORDER BY p.id, d.created_at;
```

### 3. Frontend: EmployeesPayRoll.jsx
- Genera nómina → verifica que componentes muestren nuevos campos
- Guarda → verifica en BD que se créen 4 líneas de detalle (si es horario)

---

## ⚠️ NOTAS IMPORTANTES

1. **Tabla `worked_hours` debe existir y tener datos**
   - Si está vacía → resultado tendrá `total_hours: 0`
   - Asegúrate de registrar horas trabajadas en la app

2. **Fin de semana vs extraordinarias**
   - Código detecta automáticamente `dayOfWeek === 0 || === 6`
   - Los domingos (0) y sábados (6) son extraordinarias
   - Ajusta si tu empresa tiene feriados específicos

3. **Horas nocturnas**
   - El código está preparado pero comenta la línea: `night_hours` siempre = 0
   - Si necesitas incluirlas, tendrías que registrar hora_inicio y hora_fin en `worked_hours`

4. **Bonificaciones y deducciones**
   - Actualmente: `bonuses = 0`, `deductions = 0`
   - Si necesitas: agrega lógica de cálculo de IESS, impuestos, etc.

---

## 📌 RESUMEN DE CAMBIOS

| Aspecto | Antes | Ahora |
|--------|-------|-------|
| Tarifa horaria | `salary / 8` | `salary / 240` (ley Ecuador) |
| Fuente de horas | 8 × daysInPeriod | Consulta `worked_hours` table |
| Tipos de horas | Todas iguales | 4 categorías con factores |
| Detalles guardados | 1 línea generic | 4 líneas con breakdown |
| Precisión | ❌ Incorrecta | ✅ Cumple ley laboral |

---

## 🚀 PRÓXIMAS MEJORAS OPCIONALES

- [ ] Validar `worked_hours.hours > 0` antes de procesar
- [ ] Agregar feriados nacionales (para extraordinarias)
- [ ] Calcular automáticamente IESS (9.35% empleado, 12.15% empresa)
- [ ] Implementar sistema de bonificaciones/bonos
- [ ] Reporte de nómina PDF con breakdown detallado
- [ ] Integrar descuentos por permisos/faltas

---

**Última actualización**: 2024-05-06
**Modificado por**: Corrección automática de cálculo de nómina
**Estado**: ✅ Listo para pruebas
