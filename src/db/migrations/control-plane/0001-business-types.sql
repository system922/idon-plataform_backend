-- Migration: 0001-business-types.sql

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
