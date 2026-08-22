-- Migration: 0008-users-and-owners.sql
-- ============================================================
-- TABLA: users
-- ============================================================
-- Usuarios registrados en la plataforma IDON.
-- Cada usuario tiene credenciales de acceso (email + password)
-- y puede ser propietario, empleado o colaborador en uno o
-- varios negocios a través de business_users.
--
-- Esta tabla es INDEPENDIENTE de los negocios: un usuario puede
-- existir sin estar asociado a ningún negocio aún (ej: cuando
-- completa el registro pero no ha sido aprobado).
--
-- Columnas:
-- - id: UUID PK
-- - email: correo electrónico único y obligatorio (login)
-- - first_name, last_name: nombre y apellido
-- - phone: teléfono de contacto
-- - document_type: tipo de documento (cedula, ruc, pasaporte)
-- - document_number: número de documento (único)
-- - password_hash: hash de la contraseña (bcrypt)
-- - is_active: si el usuario puede iniciar sesión
-- - email_verified: si el correo ha sido confirmado
-- - last_login_at: fecha del último inicio de sesión
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Puede ser propietario de negocios (business_owners.user_id)
-- - Puede tener roles en negocios (business_users.user_id)
-- - Referenciado por business_registration_requests.user_id (FK)

CREATE TABLE IF NOT EXISTS public.users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  phone           VARCHAR(20),
  document_type   VARCHAR(20)  DEFAULT 'cedula',
  document_number VARCHAR(50)  UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  email_verified  BOOLEAN DEFAULT FALSE,
  last_login_at   TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email           ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_document_number ON public.users(document_number);
CREATE INDEX IF NOT EXISTS idx_users_is_active       ON public.users(is_active);