-- Migration: 0003-features.sql

CREATE TABLE IF NOT EXISTS public.features (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        VARCHAR(100) NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  module_id   UUID    NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  is_active   BOOLEAN DEFAULT TRUE,
  is_premium  BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_features_code      ON public.features(code);
CREATE INDEX IF NOT EXISTS idx_features_module_id ON public.features(module_id);
CREATE INDEX IF NOT EXISTS idx_features_is_active ON public.features(is_active);
