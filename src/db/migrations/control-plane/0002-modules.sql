-- Migration: 0002-modules.sql

CREATE TABLE IF NOT EXISTS public.modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(100) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  price_monthly DECIMAL(10,2) DEFAULT 0,
  price_annual  DECIMAL(10,2) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  icon          VARCHAR(100),
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modules_code      ON public.modules(code);
CREATE INDEX IF NOT EXISTS idx_modules_is_active ON public.modules(is_active);
