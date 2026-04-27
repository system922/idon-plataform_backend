-- Migration: 0015-roles-permissions.sql
-- Agrega campo permissions JSONB a public.roles para definir
-- qué módulos y funcionalidades puede acceder cada rol de plataforma.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '[]'::jsonb;
