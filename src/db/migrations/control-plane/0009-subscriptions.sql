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
