-- Electronic invoicing configuration and invoice records for IDON platform billing.
-- These public tables are separate from the equivalent tables inside each tenant.
CREATE TABLE IF NOT EXISTS public.platform_einvoice_config (
  id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ruc                       VARCHAR(13),
  razon_social              VARCHAR(300),
  nombre_comercial          VARCHAR(300),
  direccion_matriz          VARCHAR(300),
  direccion_establecimiento VARCHAR(300),
  contribuyente_especial    VARCHAR(50),
  obligado_contabilidad     BOOLEAN DEFAULT FALSE,
  ambiente                  VARCHAR(2) DEFAULT '1',
  serie_estab               VARCHAR(3) DEFAULT '001',
  serie_pto_emision         VARCHAR(3) DEFAULT '001',
  secuencial_actual         INT DEFAULT 1,
  secuencial_credit_notes   INT DEFAULT 1,
  p12_path                  TEXT,
  p12_password              TEXT,
  p12_base64                TEXT,
  cert_valid_until          DATE,
  has_signature             BOOLEAN DEFAULT FALSE,
  logo_url                  TEXT,
  updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.platform_einvoice_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.platform_einvoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        UUID,
  billing_history_id UUID UNIQUE REFERENCES public.billing_history(id) ON DELETE SET NULL,
  invoice_number  VARCHAR(20),
  access_key      VARCHAR(49),
  auth_number     VARCHAR(49),
  customer_id     UUID,
  customer_name   VARCHAR(300),
  customer_ruc    VARCHAR(20),
  customer_email  VARCHAR(200),
  customer_phone  VARCHAR(20),
  subtotal        NUMERIC(10,2) DEFAULT 0,
  iva_amount      NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  items           JSONB,
  signed_xml      TEXT,
  status          VARCHAR(30) DEFAULT 'pendiente',
  sri_message     TEXT,
  sri_json        JSONB,
  emission_date   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  auth_date       TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  credited_amount NUMERIC(10,2) DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_platform_einvoices_status
  ON public.platform_einvoices(status);
CREATE INDEX IF NOT EXISTS idx_platform_einvoices_created_at
  ON public.platform_einvoices(created_at DESC);

ALTER TABLE public.billing_history
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS period_start TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS period_end TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS months_paid INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS customer_name VARCHAR(300),
  ADD COLUMN IF NOT EXISTS customer_document_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_document_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS customer_email VARCHAR(200),
  ADD COLUMN IF NOT EXISTS invoice_status VARCHAR(30) DEFAULT 'not_issued',
  ADD COLUMN IF NOT EXISTS invoice_error TEXT;
