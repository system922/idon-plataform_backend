CREATE TABLE IF NOT EXISTS {SCHEMA}.employee_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  shift_start   TIME NOT NULL,
  shift_end     TIME NOT NULL,
  type          VARCHAR(30),      -- regular, extra, holiday
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS schedules_employee_idx ON {SCHEMA}.employee_schedules (employee_id, schedule_date);