-- Migration: 0014-registration-requests.sql
-- ============================================================
-- TABLA: business_registration_request_modules
-- ============================================================
-- Relaciona solicitudes con los módulos seleccionados por el negocio.
-- Un módulo = POS, Inventario, Contabilidad, etc.
--
-- Columnas:
-- - id: UUID PK
-- - request_id: FK a business_registration_requests
-- - module_id: FK a modules
-- - created_at: timestamp de creación
--
-- Restricción UNIQUE(request_id, module_id) evita duplicados.

CREATE TABLE IF NOT EXISTS public.business_registration_request_modules (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES public.business_registration_requests(id) ON DELETE CASCADE,
  module_id  UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(request_id, module_id)
);

CREATE INDEX IF NOT EXISTS idx_req_modules_request_id ON public.business_registration_request_modules(request_id);
CREATE INDEX IF NOT EXISTS idx_req_modules_module_id  ON public.business_registration_request_modules(module_id);