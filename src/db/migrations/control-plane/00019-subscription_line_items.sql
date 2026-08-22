-- Migration: 0019-subscription_line_items.sql
-- ============================================================
-- TABLA: subscription_line_items
-- ============================================================
-- Líneas de ítems de una suscripción. Cada ítem corresponde a
-- un módulo que el negocio ha contratado. El precio unitario y
-- total se almacenan aquí para tener un registro histórico.
--
-- Columnas:
-- - id: UUID PK
-- - subscription_id: FK a la suscripción
-- - module_id: FK al módulo contratado
-- - quantity: cantidad (generalmente 1, pero puede ser mayor)
-- - unit_price: precio unitario del módulo en el momento de la contratación
-- - total_price: unit_price * quantity
-- - created_at: timestamp de creación
--
-- Relaciones:
-- - Una suscripción tiene muchos ítems.
-- - Un módulo puede aparecer en muchas líneas de ítems.
--
-- Nota: La combinación (subscription_id, module_id) es única.

CREATE TABLE IF NOT EXISTS public.subscription_line_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  module_id       UUID NOT NULL REFERENCES public.modules(id)       ON DELETE CASCADE,
  quantity        INT          DEFAULT 1,
  unit_price      DECIMAL(12,2),
  total_price     DECIMAL(12,2),
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(subscription_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_items_subscription_id ON public.subscription_line_items(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_items_module_id       ON public.subscription_line_items(module_id);