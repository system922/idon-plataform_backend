-- Migration: 0003-fiscal-config.sql
-- ============================================================
-- TABLA: fiscal_config
-- ============================================================
-- Configuración fiscal global del sistema (Ecuador).
-- Almacena parámetros como tasas de IVA, configuración SRI,
-- retenciones y moneda. Solo debe existir una fila activa.
--
-- Columnas principales:
-- - id: UUID PK
-- - country_code: código del país (EC)
-- - country_name: nombre del país
-- - currency_*: configuración de moneda (USD)
-- - iva_rate: tasa de IVA general (15%)
-- - iva_rate_reduced: tasa de IVA reducida (0% por defecto)
-- - iva_effective_from: fecha desde la que aplica la tasa
-- - iva_effective_until: fecha hasta la que aplica (NULL = vigente)
-- - ice_enabled: si aplica impuesto a consumos especiales
-- - sri_environment: 'pruebas' | 'produccion'
-- - sri_wsdl_url: URL del servicio de recepción SRI
-- - sri_auth_wsdl_url: URL del servicio de autorización SRI
-- - retention_ir_goods: retención de IR por bienes (1%)
-- - retention_ir_services: retención de IR por servicios (2%)
-- - retention_iva: retención de IVA (30%)
-- - is_active: si esta configuración está activa

CREATE TABLE IF NOT EXISTS public.fiscal_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code          VARCHAR(5)     NOT NULL DEFAULT 'EC',
  country_name          VARCHAR(100)   NOT NULL DEFAULT 'Ecuador',
  currency_code         VARCHAR(5)     NOT NULL DEFAULT 'USD',
  currency_name         VARCHAR(100)   NOT NULL DEFAULT 'Dólar Estadounidense',
  currency_symbol       VARCHAR(5)     NOT NULL DEFAULT '$',

  -- IVA
  iva_rate              DECIMAL(5,2)   NOT NULL DEFAULT 15.00,
  iva_rate_reduced      DECIMAL(5,2)   DEFAULT 0.00,
  iva_effective_from    DATE           NOT NULL DEFAULT '2024-04-01',
  iva_effective_until   DATE,

  -- ICE (Impuesto a Consumos Especiales)
  ice_enabled           BOOLEAN        DEFAULT FALSE,

  -- SRI
  sri_environment       VARCHAR(20)    NOT NULL DEFAULT 'produccion'
                        CHECK (sri_environment IN ('pruebas', 'produccion')),
  sri_wsdl_url          TEXT           DEFAULT 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl',
  sri_auth_wsdl_url     TEXT           DEFAULT 'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl',

  -- Retenciones por defecto
  retention_ir_goods    DECIMAL(5,2)   DEFAULT 1.00,
  retention_ir_services DECIMAL(5,2)   DEFAULT 2.00,
  retention_iva         DECIMAL(5,2)   DEFAULT 30.00,

  -- Auditoría
  is_active             BOOLEAN        DEFAULT TRUE,
  created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_config_country_code ON public.fiscal_config(country_code);
CREATE INDEX IF NOT EXISTS idx_fiscal_config_is_active    ON public.fiscal_config(is_active);
