-- Migration: tenant/core/0001-schema-migrations.sql
-- Description: Schema migrations tracking table (common for all tenants)

CREATE TABLE IF NOT EXISTS {SCHEMA}.schema_migrations (
  id SERIAL PRIMARY KEY,
  version VARCHAR(50) NOT NULL UNIQUE,
  module VARCHAR(100) NOT NULL,
  description TEXT,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON {SCHEMA}.schema_migrations(version);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_module ON {SCHEMA}.schema_migrations(module);
