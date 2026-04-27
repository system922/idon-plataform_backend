-- Migration: 0012-registration-requests-provision-cols.sql
-- Adds provisioning-related columns missing from initial migration

ALTER TABLE public.business_registration_requests
  ADD COLUMN IF NOT EXISTS provisioned_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS schema_name VARCHAR(100);
