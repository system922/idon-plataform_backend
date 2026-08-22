-- Migration: 0020-billing_history
-- ============================================================
-- TABLA: billing_history
-- ============================================================
-- Historial de facturación de una suscripción. Cada registro
-- representa un ciclo de facturación (mes o año) con su fecha,
-- monto, estado y número de factura.
--
-- Columnas:
-- - id: UUID PK
-- - subscription_id: FK a la suscripción
-- - billing_date: fecha de emisión de la factura
-- - due_date: fecha de vencimiento
-- - amount: monto a pagar
-- - status: pending, paid, overdue, cancelled
-- - invoice_number: número de factura (puede ser generado externamente)
-- - notes: observaciones
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Pertenece a una suscripción.
-- - El historial permite llevar el registro de pagos y deudas.

CREATE TABLE IF NOT EXISTS public.billing_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  billing_date    TIMESTAMP WITH TIME ZONE,
  due_date        TIMESTAMP WITH TIME ZONE,
  amount          DECIMAL(12,2),
  status          VARCHAR(50) DEFAULT 'pending',
  invoice_number  VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_history_subscription_id ON public.billing_history(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_history_status          ON public.billing_history(status);
CREATE INDEX IF NOT EXISTS idx_billing_history_billing_date    ON public.billing_history(billing_date);
