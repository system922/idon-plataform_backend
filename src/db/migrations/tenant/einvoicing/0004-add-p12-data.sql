-- Migration: tenant/einvoicing/0004-add-p12-data.sql
-- Description: Store p12 certificate as base64 in DB to survive Render redeploys

ALTER TABLE {SCHEMA}.einvoice_config
  ADD COLUMN IF NOT EXISTS p12_base64 TEXT;
