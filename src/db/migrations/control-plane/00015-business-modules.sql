-- Migration: 0015-business-modules-features.sql
-- ============================================================
-- TABLA: business_modules
-- ============================================================
-- Relaciona cada negocio con los módulos que tiene activos.
-- Un negocio puede tener varios módulos activos, y un módulo
-- puede estar activo en varios negocios.
-- La combinación (business_id, module_id) es única.
--
-- Columnas:
-- - id: UUID PK
-- - business_id: FK al negocio (businesses)
-- - module_id: FK al módulo (modules)
-- - is_active: si el módulo está actualmente activo para el negocio
-- - activated_at: fecha de activación (cuando se activó por primera vez)
-- - deactivated_at: fecha de desactivación (si fue desactivado)
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Un negocio puede tener varios módulos activos
-- - Los módulos activos determinan las funcionalidades disponibles
--   y el costo de la suscripción.
--
-- Nota: activated_at puede usarse para calcular el tiempo de uso,
-- y deactivated_at para auditoría de cambios.

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
