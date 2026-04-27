-- Migration: tenant/core/0002-basic-settings.sql
-- Description: Basic settings and configuration for tenant

CREATE TABLE IF NOT EXISTS {SCHEMA}.settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value TEXT,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_settings_key ON {SCHEMA}.settings(key);

-- Default settings
INSERT INTO {SCHEMA}.settings (key, value, description)
VALUES
  ('company_name', '', 'Nombre de la empresa'),
ON CONFLICT (key) DO NOTHING;
