CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id TEXT NOT NULL UNIQUE,
  client_transaction_id TEXT,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  status TEXT NOT NULL,
  status_code INTEGER,
  transaction_status TEXT,
  store_id TEXT,
  raw_payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_subscription_id
  ON public.payments(subscription_id);
