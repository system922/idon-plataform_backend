-- Migration: 0007-business-modules-features.sql

CREATE TABLE IF NOT EXISTS public.business_modules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  module_id      UUID NOT NULL REFERENCES public.modules(id)    ON DELETE CASCADE,
  is_active      BOOLEAN DEFAULT TRUE,
  activated_at   TIMESTAMP WITH TIME ZONE,
  deactivated_at TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_business_modules_business_id ON public.business_modules(business_id);
CREATE INDEX IF NOT EXISTS idx_business_modules_module_id   ON public.business_modules(module_id);
CREATE INDEX IF NOT EXISTS idx_business_modules_is_active   ON public.business_modules(is_active);

-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.business_features (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  feature_id     UUID NOT NULL REFERENCES public.features(id)   ON DELETE CASCADE,
  is_active      BOOLEAN DEFAULT TRUE,
  activated_at   TIMESTAMP WITH TIME ZONE,
  deactivated_at TIMESTAMP WITH TIME ZONE,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(business_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_business_features_business_id ON public.business_features(business_id);
CREATE INDEX IF NOT EXISTS idx_business_features_feature_id  ON public.business_features(feature_id);
CREATE INDEX IF NOT EXISTS idx_business_features_is_active   ON public.business_features(is_active);
