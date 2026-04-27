-- Migration: 0010-admin-users.sql

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
