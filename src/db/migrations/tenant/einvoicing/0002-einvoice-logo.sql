-- Migration: tenant/einvoicing/0002-einvoice-logo.sql
-- Description: Add logo_url to einvoice_config for RIDE PDF branding

ALTER TABLE {SCHEMA}.einvoice_config
  ADD COLUMN IF NOT EXISTS logo_url TEXT;
