-- Migration: 0002-admin-users.sql
-- ============================================================
-- TABLA: admin_users
-- ============================================================
-- Administradores de la plataforma IDON.
-- Son usuarios con acceso al panel de administración general
-- (control-plane) para gestionar solicitudes, negocios, módulos,
-- configuraciones globales y auditoría del sistema.
--
-- Esta tabla es INDEPENDIENTE de users y business_users,
-- ya que los administradores NO pertenecen a un negocio específico,
-- sino que tienen acceso a toda la plataforma.
--
-- Columnas:
-- - id: UUID PK
-- - email: correo electrónico único y obligatorio (login)
-- - first_name, last_name: nombre y apellido del administrador
-- - password_hash: hash de la contraseña (bcrypt)
-- - role: rol del administrador (admin, super_admin, support, auditor, viewer)
--   DEFAULT 'admin'
-- - permissions: JSONB con permisos específicos adicionales
--   (ej: ["manage_users", "view_audit", "manage_modules"])
-- - is_active: si el administrador puede iniciar sesión
-- - last_login_at: fecha del último inicio de sesión
-- - login_attempts: contador de intentos fallidos (para bloqueo)
-- - locked_until: fecha hasta que la cuenta está bloqueada
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Referenciado por business_registration_requests.reviewed_by (FK)
--
-- Nota: La restricción CHECK en role es opcional pero recomendada
-- para mantener datos consistentes. Si se agrega, los valores
-- válidos son: admin, super_admin, support, auditor, viewer.

CREATE TABLE IF NOT EXISTS public.admin_users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  first_name     VARCHAR(100) NOT NULL,
  last_name      VARCHAR(100) NOT NULL,
  password_hash  VARCHAR(255) NOT NULL,
  role           VARCHAR(50)  DEFAULT 'admin',
  permissions    JSONB        DEFAULT '[]',
  is_active      BOOLEAN      DEFAULT TRUE,
  last_login_at  TIMESTAMP WITH TIME ZONE,
  login_attempts INTEGER      DEFAULT 0,
  locked_until   TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email     ON public.admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_role      ON public.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_is_active ON public.admin_users(is_active);
