CREATE TABLE IF NOT EXISTS public.payphone_payment_links (
  client_transaction_id VARCHAR(15) PRIMARY KEY,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_url TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payphone_payment_links_subscription_id
  ON public.payphone_payment_links(subscription_id);
