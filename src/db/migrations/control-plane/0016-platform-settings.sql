-- Tabla de configuración global de la plataforma IDON
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL DEFAULT '',
  label      VARCHAR(200),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Valor inicial: número de WhatsApp soporte IDON
INSERT INTO public.platform_settings (key, value, label)
VALUES ('whatsapp_support_number', '', 'Número WhatsApp Soporte IDON')
ON CONFLICT (key) DO NOTHING;
