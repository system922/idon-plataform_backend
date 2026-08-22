-- Migration: 0004-platform_settings.sql
-- ============================================================
-- TABLA: platform_settings
-- ============================================================
-- Configuración global de la plataforma IDON.
-- Almacena pares clave-valor para parámetros del sistema que
-- aplican a toda la plataforma (no a un negocio específico).
--
-- Ejemplos de uso:
-- - 'whatsapp_support_number': número de WhatsApp de soporte
-- - 'maintenance_mode': activar/desactivar modo mantenimiento
-- - 'max_retries_whatsapp': número de reintentos para envíos
--
-- Columnas:
-- - key: VARCHAR(100) PRIMARY KEY — identificador único de la configuración
-- - value: TEXT NOT NULL DEFAULT '' — valor almacenado (puede ser texto, JSON, etc.)
-- - label: VARCHAR(200) — descripción legible del parámetro (opcional)
-- - updated_at: TIMESTAMPTZ NOT NULL DEFAULT NOW() — última fecha de actualización
--
-- Relaciones:
-- - Ninguna. Es una tabla independiente.
--
-- Nota: Al ser una tabla de configuración global, se espera que
-- solo tenga un número reducido de registros (< 100).

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT         NOT NULL DEFAULT '',
  label      VARCHAR(200),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

