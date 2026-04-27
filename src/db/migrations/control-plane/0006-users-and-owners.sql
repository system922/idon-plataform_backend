-- Migration: 0006-users-and-owners.sql

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

-- ─────────────────────────────────────────────────────────────

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

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.users(id)      ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES public.roles(id),
  is_owner    BOOLEAN DEFAULT FALSE,
  invited_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  invited_at  TIMESTAMP WITH TIME ZONE,
  accepted_at TIMESTAMP WITH TIME ZONE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_users_business_id ON public.business_users(business_id);
CREATE INDEX IF NOT EXISTS idx_business_users_user_id     ON public.business_users(user_id);
CREATE INDEX IF NOT EXISTS idx_business_users_role_id     ON public.business_users(role_id);
CREATE INDEX IF NOT EXISTS idx_business_users_is_owner    ON public.business_users(is_owner);
