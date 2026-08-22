-- Migration: 0006-business-types.sql
-- ============================================================
-- TABLA: business_users
-- ============================================================
-- Relación entre usuarios y negocios, con su rol y permisos.
-- Define qué usuarios tienen acceso a qué negocio y con qué
-- nivel de permisos (rol).
--
-- Un usuario puede pertenecer a múltiples negocios, y un negocio
-- puede tener múltiples usuarios. La combinación (business_id, user_id)
-- es única.
--
-- Columnas:
-- - id: UUID PK
-- - business_id: FK al negocio (businesses)
-- - user_id: FK al usuario (users)
-- - role_id: FK al rol (roles) que define permisos dentro del negocio
-- - is_owner: TRUE si el usuario es propietario del negocio
--   (debe coincidir con business_owners para ese negocio)
-- - invited_by: usuario que invitó (FK a users)
-- - invited_at: fecha de invitación
-- - accepted_at: fecha de aceptación de la invitación
-- - is_active: si el usuario tiene acceso activo al negocio
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Un usuario con is_owner = TRUE debe tener un registro
--   en business_owners (aunque no hay FK directa, es lógica de negocio)
-- - roles determina los permisos específicos dentro del tenant
--
-- Nota: Esta tabla es la base para el contexto multi-tenant:
-- al autenticarse, se selecciona el negocio activo y se cargan
-- los permisos según role_id.

CREATE TABLE IF NOT EXISTS public.business_types (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_types_code      ON public.business_types(code);
CREATE INDEX IF NOT EXISTS idx_business_types_is_active ON public.business_types(is_active);
