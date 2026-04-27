-- Migration: tenant/einvoicing/0003-add-customer-phone.sql
-- Description: Add customer_phone column to einvoices table

ALTER TABLE {SCHEMA}.einvoices
  ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20);
