CREATE TABLE IF NOT EXISTS {SCHEMA}.employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID,
  full_name       VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(20),
  position        VARCHAR(100),
  department      VARCHAR(100),
  document_number VARCHAR(50),
  salary          NUMERIC(12,2),
  hired_at        DATE,
  status          VARCHAR(20) DEFAULT 'active',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);