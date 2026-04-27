CREATE TABLE IF NOT EXISTS {SCHEMA}.worked_hours (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  worked_date  DATE NOT NULL,
  hours        NUMERIC(6,2) NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS worked_hours_employee_idx ON {SCHEMA}.worked_hours (employee_id, worked_date);