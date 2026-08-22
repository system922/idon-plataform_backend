-- Migration: 0011-modules.sql
-- ============================================================
-- TABLA: modules
-- ============================================================
-- Módulos del sistema que agrupan funcionalidades relacionadas.
-- Los módulos son la unidad base de activación en los negocios:
-- un negocio puede tener varios módulos activos, y cada módulo
-- contiene múltiples features (funcionalidades).
--
-- Ejemplos:
-- - 'core': Módulo base del sistema (siempre activo)
-- - 'pos': Punto de Venta
-- - 'inventory': Inventario
-- - 'accounting': Contabilidad
--
-- Columnas:
-- - id: UUID PK
-- - code: identificador único del módulo (ej: 'pos', 'inventory')
-- - name: nombre descriptivo (ej: 'Punto de Venta')
-- - description: descripción opcional
-- - price_monthly: precio mensual del módulo (para suscripciones)
-- - price_annual: precio anual del módulo (para suscripciones)
-- - is_active: si el módulo está disponible
-- - icon: nombre del ícono (para UI, ej: 'shopping-cart')
-- - sort_order: orden de visualización en la interfaz
-- - created_at, updated_at: timestamps de auditoría
--
-- Relaciones:
-- - Un módulo tiene muchas features (features.module_id)
-- - Un negocio tiene muchos módulos (business_modules.module_id)
-- - Una solicitud de registro puede seleccionar módulos (business_registration_request_modules.module_id)
-- - Una suscripción puede tener línea de ítems por módulo (subscription_line_items.module_id)

CREATE TABLE IF NOT EXISTS public.modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          VARCHAR(100) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  price_monthly DECIMAL(10,2) DEFAULT 0,
  price_annual  DECIMAL(10,2) DEFAULT 0,
  is_active     BOOLEAN DEFAULT TRUE,
  icon          VARCHAR(100),
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_modules_code      ON public.modules(code);
CREATE INDEX IF NOT EXISTS idx_modules_is_active ON public.modules(is_active);
