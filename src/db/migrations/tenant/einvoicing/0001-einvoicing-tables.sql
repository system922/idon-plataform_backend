-- Migration: tenant/einvoicing/0001-einvoicing-tables.sql
-- Description: Electronic invoicing (SRI Ecuador) tables

-- Firma electrónica y configuración de facturación electrónica por negocio
CREATE TABLE IF NOT EXISTS {SCHEMA}.einvoice_config (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruc                      VARCHAR(13),
  razon_social             VARCHAR(300),
  nombre_comercial         VARCHAR(300),
  direccion_matriz         VARCHAR(300),
  direccion_establecimiento VARCHAR(300),
  contribuyente_especial   VARCHAR(50),
  obligado_contabilidad    BOOLEAN DEFAULT false,
  ambiente                 VARCHAR(2) DEFAULT '1',   -- '1'=pruebas, '2'=produccion
  serie_estab              VARCHAR(3) DEFAULT '001',
  serie_pto_emision        VARCHAR(3) DEFAULT '001',
  secuencial_actual        INT DEFAULT 1,
  p12_path                 TEXT,
  p12_password             TEXT,
  cert_valid_until         DATE,
  updated_at               TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Una sola fila por negocio
INSERT INTO {SCHEMA}.einvoice_config (id) VALUES (gen_random_uuid())
ON CONFLICT DO NOTHING;

-- Facturas electrónicas emitidas
CREATE TABLE IF NOT EXISTS {SCHEMA}.einvoices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID,
  invoice_number    VARCHAR(20),          -- 001-001-000000001
  access_key        VARCHAR(49),          -- clave de acceso SRI (49 dígitos)
  auth_number       VARCHAR(49),          -- número de autorización SRI
  customer_id       UUID,
  customer_name     VARCHAR(300),
  customer_ruc      VARCHAR(20),
  customer_email    VARCHAR(200),
  customer_phone    VARCHAR(20),
  subtotal          NUMERIC(10,2) DEFAULT 0,
  iva_amount        NUMERIC(10,2) DEFAULT 0,
  total             NUMERIC(10,2) DEFAULT 0,
  items             JSONB,
  signed_xml        TEXT,
  status            VARCHAR(30) DEFAULT 'pendiente',  -- pendiente | autorizada | rechazada | error
  sri_message       TEXT,
  sri_json          JSONB,
  emission_date     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  auth_date         TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_einvoices_order_id    ON {SCHEMA}.einvoices(order_id);
CREATE INDEX IF NOT EXISTS idx_einvoices_status      ON {SCHEMA}.einvoices(status);
CREATE INDEX IF NOT EXISTS idx_einvoices_access_key  ON {SCHEMA}.einvoices(access_key);
CREATE INDEX IF NOT EXISTS idx_einvoices_created_at  ON {SCHEMA}.einvoices(created_at);
