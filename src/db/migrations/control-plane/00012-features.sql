-- Migration: 0012-features.sql
-- ============================================================
-- TABLA: features
-- ============================================================
-- Funcionalidades específicas que pueden ser activadas en un negocio.
-- Cada funcionalidad pertenece a un módulo (module_id) y puede ser
-- premium (de pago) o gratuita (is_premium = false).
--
-- Ejemplos:
-- - Módulo POS: 'pos.sales', 'pos.discounts', 'pos.retail'
-- - Módulo Inventory: 'inventory.adjustments', 'inventory.recipes'
--
-- Columnas:
-- - id: UUID PK
-- - code: identificador único (ej: 'pos.sales')
-- - name: nombre descriptivo (ej: 'Ventas en caja')
-- - description: descripción opcional
-- - module_id: FK al módulo padre
-- - is_active: disponible o no
-- - is_premium: true = requiere pago
-- - created_at, updated_at: auditoría
--
-- Relaciones:
-- - business_features (qué funcionalidades tiene cada negocio)
-- - business_registration_request_features (solicitudes)

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
