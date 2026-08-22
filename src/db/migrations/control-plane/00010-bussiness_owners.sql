-- Migration: 0010-bussiness_owners.sql
-- ============================================================
-- TABLA: business_owners
-- ============================================================
-- Propietarios de negocios registrados en la plataforma.
-- Cada propietario está vinculado a un usuario (users) y puede
-- ser dueño de múltiples negocios (a través de business_users).
--
-- Esta tabla almacena información específica del propietario
-- que puede diferir de los datos del usuario (ej: nombre legal
-- vs nombre de usuario).
--
-- Columnas:
-- - id: UUID PK
-- - user_id: FK a users (único: un usuario solo puede ser
--   propietario una vez, aunque puede tener múltiples negocios)
-- - first_name, last_name: nombre y apellido del propietario
-- - email: correo electrónico (único)
-- - phone: teléfono de contacto
-- - document_type: tipo de documento (cedula, ruc, pasaporte)
-- - document_number: número de documento (único)
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Referenciado por business_registration_requests.business_owner_id (FK)
-- - Un propietario puede estar asociado a varios negocios
--   a través de business_users (con is_owner = true)

CREATE TABLE IF NOT EXISTS public.business_owners (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100),
  email           VARCHAR(255) NOT NULL UNIQUE,
  phone           VARCHAR(20),
  document_type   VARCHAR(20) DEFAULT 'cedula',
  document_number VARCHAR(50) UNIQUE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_owners_user_id         ON public.business_owners(user_id);
CREATE INDEX IF NOT EXISTS idx_business_owners_email           ON public.business_owners(email);
CREATE INDEX IF NOT EXISTS idx_business_owners_document_number ON public.business_owners(document_number);