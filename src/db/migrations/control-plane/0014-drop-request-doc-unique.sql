-- Migration: 0014-drop-request-doc-unique.sql
-- Allow one owner (same document number) to register multiple businesses.
-- The UNIQUE constraint on owner_document_number is too restrictive.

ALTER TABLE public.business_registration_requests
  DROP CONSTRAINT IF EXISTS business_registration_requests_owner_document_number_key;
