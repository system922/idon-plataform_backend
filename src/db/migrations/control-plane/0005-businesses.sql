-- Migration: 0005-businesses.sql

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
