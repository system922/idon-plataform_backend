-- Migration: 0018-subscriptions.sql
-- ============================================================
-- TABLA: subscriptions
-- ============================================================
-- Suscripción activa de un negocio. Cada negocio tiene una
-- única suscripción (business_id UNIQUE). La suscripción define
-- el plan de pago, el período de facturación, los montos y el estado.
--
-- Columnas:
-- - id: UUID PK
-- - business_id: FK al negocio (UNIQUE, un negocio solo tiene una suscripción)
-- - status: estado de la suscripción
--   (pending_activation, active, suspended, cancelled, expired)
-- - billing_period: monthly | annual
-- - billing_day: día del mes para facturación (por defecto 1)
-- - amount_monthly: costo mensual total
-- - amount_annual: costo anual total
-- - total_amount: monto total de la suscripción (con descuentos)
-- - discount_percentage: porcentaje de descuento aplicado
-- - next_billing_at: fecha de la próxima facturación
-- - activated_at: fecha de activación
-- - suspended_at: fecha de suspensión
-- - cancelled_at: fecha de cancelación
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Un negocio tiene una sola suscripción.
-- - La suscripción tiene líneas de ítems (subscription_line_items)
-- - La suscripción genera facturas (billing_history)
--
-- Nota: Los montos (amount_monthly, amount_annual, total_amount)
-- se calculan a partir de los ítems de la suscripción.

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id         UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  status              VARCHAR(50)              DEFAULT 'pending_activation',
  billing_period      VARCHAR(20)              DEFAULT 'monthly',
  billing_day         INT                      DEFAULT 1,
  amount_monthly      DECIMAL(12,2),
  amount_annual       DECIMAL(12,2),
  total_amount        DECIMAL(12,2),
  discount_percentage DECIMAL(5,2)             DEFAULT 0,
  next_billing_at     TIMESTAMP WITH TIME ZONE,
  activated_at        TIMESTAMP WITH TIME ZONE,
  suspended_at        TIMESTAMP WITH TIME ZONE,
  cancelled_at        TIMESTAMP WITH TIME ZONE,
  created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_business_id     ON public.subscriptions(business_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status          ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing_at ON public.subscriptions(next_billing_at);