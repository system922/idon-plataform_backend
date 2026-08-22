-- Migration: 0017-business-modules-features.sql
-- ============================================================
-- TABLA: business_features
-- ============================================================
-- Relaciona cada negocio con las funcionalidades específicas
-- que tiene activas. Una funcionalidad es una subcaracterística
-- de un módulo (ej: "descuentos" dentro del módulo POS).
--
-- Un negocio puede tener varias funcionalidades activas,
-- y una funcionalidad puede estar activa en varios negocios.
-- La combinación (business_id, feature_id) es única.
--
-- Columnas:
-- - id: UUID PK
-- - business_id: FK al negocio (businesses)
-- - feature_id: FK a la funcionalidad (features)
-- - is_active: si la funcionalidad está actualmente activa
-- - activated_at: fecha de activación
-- - deactivated_at: fecha de desactivación
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Complementa a business_modules: los módulos activos
--   pueden tener funcionalidades específicas activas.
-- - Las funcionalidades activas determinan los permisos
--   y capacidades del negocio.
--
-- Nota: activated_at y deactivated_at permiten auditar
-- cuándo se activaron/desactivaron funcionalidades.

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
