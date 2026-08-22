-- Migration: 0013-registration-requests.sql

-- ============================================================
-- TABLA: business_registration_requests
-- ============================================================
-- Solicitudes de registro de nuevos negocios en la plataforma.
-- Flujo: pending → approved/rejected → provisioned.
-- Almacena datos del negocio, del propietario y estado de la solicitud.
--
-- Columnas principales:
-- - id: UUID PK
-- - slug: identificador único para URL
-- - business_name: nombre comercial
-- - business_type_id: FK a business_types
-- - user_id: FK a users (dueño que crea la solicitud)
-- - business_owner_id: FK a business_owners
-- - owner_*: datos del propietario (nombre, email, documento, teléfono)
-- - status: pending | approved | rejected | provisioned
-- - reviewed_by: FK a admin_users (quien revisó)
-- - provisioned_business_id: FK a businesses (negocio creado)
-- - schema_name: nombre del esquema tenant creado
--
-- Nota: owner_document_number NO tiene UNIQUE para permitir que una
-- misma persona registre múltiples negocios.

CREATE TABLE IF NOT EXISTS public.business_registration_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    VARCHAR(100) NOT NULL UNIQUE,
  business_name           VARCHAR(255) NOT NULL,
  business_type_id        UUID NOT NULL REFERENCES public.business_types(id),
  user_id                 UUID NOT NULL REFERENCES public.users(id)           ON DELETE CASCADE,
  business_owner_id       UUID NOT NULL REFERENCES public.business_owners(id) ON DELETE CASCADE,
  owner_first_name        VARCHAR(100) NOT NULL,
  owner_last_name         VARCHAR(100),
  owner_email             VARCHAR(255) NOT NULL,
  owner_document_type     VARCHAR(20)  DEFAULT 'cedula',
  owner_document_number   VARCHAR(50)  NOT NULL,
  owner_phone             VARCHAR(20),
  status                  VARCHAR(50)  DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','provisioned')),
  rejection_reason        TEXT,
  requested_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reviewed_by             UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,  
  provisioned_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL,
  schema_name             VARCHAR(100),
  reviewed_at             TIMESTAMP WITH TIME ZONE,
  provisioned_at          TIMESTAMP WITH TIME ZONE,
  created_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at              TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status                 ON public.business_registration_requests(status);
CREATE INDEX IF NOT EXISTS idx_reg_requests_business_type_id       ON public.business_registration_requests(business_type_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_owner_email            ON public.business_registration_requests(owner_email);
CREATE INDEX IF NOT EXISTS idx_reg_requests_user_id                ON public.business_registration_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_business_owner_id      ON public.business_registration_requests(business_owner_id);
CREATE INDEX IF NOT EXISTS idx_reg_requests_requested_at_desc      ON public.business_registration_requests(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_requests_status_created_at_desc ON public.business_registration_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_requests_owner_document_number  ON public.business_registration_requests(owner_document_number);