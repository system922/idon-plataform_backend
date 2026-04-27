CREATE TABLE IF NOT EXISTS {SCHEMA}.attendance_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES {SCHEMA}.employees(id) ON DELETE CASCADE,
  type          VARCHAR(20) NOT NULL,         -- in|out|break|return_from_break ...
  event_time    TIMESTAMP NOT NULL,
  method        VARCHAR(30),                  -- manual, biometric, app, etc.
  location      VARCHAR(100),
  device_info   TEXT,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS attendance_employee_idx ON {SCHEMA}.attendance_records (employee_id, event_time);