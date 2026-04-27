CREATE TABLE IF NOT EXISTS {SCHEMA}.employee_leaves (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id  UUID NOT NULL REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  leave_type   VARCHAR(30) NOT NULL,   -- vacation, sickness, permission, parental, etc.
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  status       VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected
  notes        TEXT,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS leaves_employee_idx ON {SCHEMA}.employee_leaves (employee_id, leave_type, start_date);