-- Migration: 0001-roles.sql
-- ============================================================
-- TABLA: roles
-- ============================================================
-- Roles del sistema que definen permisos y niveles de acceso
-- dentro de cada negocio (tenant). Los roles pueden ser
-- predefinidos (is_system = true) o personalizados por el negocio.
--
-- Columnas:
-- - id: UUID PK
-- - code: identificador único del rol (ej: 'admin', 'cashier')
-- - name: nombre descriptivo del rol
-- - description: descripción opcional
-- - is_system: indica si es un rol base del sistema (no editable)
-- - permissions: JSONB con lista de permisos específicos
--   (ej: ["pos.sales", "inventory.view"])
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Referenciado por users.role_id (FK)

CREATE TABLE IF NOT EXISTS public.roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  is_system   BOOLEAN DEFAULT FALSE,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_code ON public.roles(code);
