-- Migration: 0016-registration-requests.sql
-- ============================================================
-- TABLA: business_registration_request_features
-- ============================================================
-- Relaciona solicitudes con funcionalidades específicas seleccionadas.
-- Las funcionalidades son subcaracterísticas de los módulos.
-- Ej: "descuentos" dentro del módulo POS.
--
-- Columnas:
-- - id: UUID PK
-- - request_id: FK a business_registration_requests
-- - feature_id: FK a features
-- - created_at: timestamp de creación
--
-- Restricción UNIQUE(request_id, feature_id) evita duplicados.
CREATE TABLE IF NOT EXISTS public.business_registration_request_features (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.business_registration_requests(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(request_id, feature_id)
);

CREATE INDEX IF NOT EXISTS idx_req_features_request_id ON public.business_registration_request_features(request_id);
CREATE INDEX IF NOT EXISTS idx_req_features_feature_id ON public.business_registration_request_features(feature_id);
