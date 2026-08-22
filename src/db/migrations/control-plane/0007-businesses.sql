-- Migration: 0007-businesses.sql
-- ============================================================
-- TABLA: businesses
-- ============================================================
-- Negocios registrados en la plataforma IDON.
-- Cada negocio tiene un esquema de base de datos propio (tenant)
-- y está asociado a un tipo de negocio (business_types).
--
-- Un negocio se crea una vez que una solicitud de registro es
-- aprobada y provisionada. La tabla `businesses` es la entidad
-- principal del control-plane.
--
-- Columnas:
-- - id: UUID PK
-- - slug: identificador único para URL (ej: 'mi-restaurante')
-- - name: nombre comercial del negocio
-- - business_type_id: FK al tipo de negocio (restaurante, tienda, etc.)
-- - schema_name: nombre del esquema PostgreSQL (ej: 'tenant_mirestaurante')
--   Es único y se usa para aislar los datos del tenant.
-- - is_active: si el negocio está activo (puede operar)
-- - is_verified: si el negocio ha sido verificado (ej: documentación revisada)
-- - admin_notes: notas internas del administrador
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Referenciado por business_registration_requests.provisioned_business_id (FK)
-- - Referenciado por business_users.business_id (FK)
-- - Referenciado por business_modules.business_id (FK)
-- - Referenciado por business_features.business_id (FK)
-- - Referenciado por subscriptions.business_id (FK)
--
-- Nota: `schema_name` es la clave para el multi-tenant: al autenticar
-- un usuario, se determina a qué negocio pertenece y se usa este
-- nombre de esquema para todas las consultas de ese tenant.

CREATE TABLE IF NOT EXISTS public.businesses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             VARCHAR(100) NOT NULL UNIQUE,
  name             VARCHAR(255) NOT NULL,
  business_type_id UUID NOT NULL REFERENCES public.business_types(id),
  schema_name      VARCHAR(100) UNIQUE,
  is_active        BOOLEAN DEFAULT TRUE,
  is_verified      BOOLEAN DEFAULT FALSE,
  admin_notes      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at       TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_businesses_slug             ON public.businesses(slug);
CREATE INDEX IF NOT EXISTS idx_businesses_business_type_id ON public.businesses(business_type_id);
CREATE INDEX IF NOT EXISTS idx_businesses_schema_name      ON public.businesses(schema_name);
CREATE INDEX IF NOT EXISTS idx_businesses_is_active        ON public.businesses(is_active);
