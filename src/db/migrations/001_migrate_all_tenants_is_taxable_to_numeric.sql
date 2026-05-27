-- =============================================================================
-- MIGRACIÓN GLOBAL: Convertir is_taxable de BOOLEAN a NUMERIC(5, 2)
-- Propósito: Permitir almacenar tasas IVA (0, 5, 8, 12, 15) por producto
-- 
-- Esta migración:
-- 1. Itera sobre TODOS los esquemas tenant (excepto public, information_schema, pg_*)
-- 2. Para cada schema que tenga tabla products:
--    a. Migra is_taxable: BOOLEAN → NUMERIC(5, 2)
--    b. Actualiza datos: true → 15, false → 0
--    c. Cambia tax_rate DEFAULT: 15 → 0
-- =============================================================================

DO $$
DECLARE
  v_schema_name TEXT;
  v_schema_count INT := 0;
  v_migrated_count INT := 0;
  v_error_msg TEXT;
BEGIN
  RAISE NOTICE '🔄 Iniciando migración de todos los tenants...';
  
  -- Iterar sobre todos los esquemas tenant (no public ni sistema)
  FOR v_schema_name IN 
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('public', 'information_schema', 'pg_catalog', 'pg_toast')
    ORDER BY schema_name
  LOOP
    v_schema_count := v_schema_count + 1;
    
    -- Verificar si el schema tiene tabla products
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = v_schema_name AND table_name = 'products'
    ) THEN
      
      BEGIN
        RAISE NOTICE '📦 Procesando schema: %', v_schema_name;
        
        -- 1. Crear columna temporal con nuevo tipo
        EXECUTE format('
          ALTER TABLE %I.products
          ADD COLUMN is_taxable_new NUMERIC(5, 2)', v_schema_name);
        
        -- 2. Migrar datos: true → 15, false → 0
        EXECUTE format('
          UPDATE %I.products
          SET is_taxable_new = CASE 
            WHEN is_taxable = true  THEN 15
            WHEN is_taxable = false THEN 0
            ELSE 15
          END', v_schema_name);
        
        -- 3. Eliminar columna vieja
        EXECUTE format('
          ALTER TABLE %I.products
          DROP COLUMN is_taxable', v_schema_name);
        
        -- 4. Renombrar columna nueva
        EXECUTE format('
          ALTER TABLE %I.products
          RENAME COLUMN is_taxable_new TO is_taxable', v_schema_name);
        
        -- 5. Establecer DEFAULT correcto
        EXECUTE format('
          ALTER TABLE %I.products
          ALTER COLUMN is_taxable SET DEFAULT 15', v_schema_name);
        
        -- 6. Hacer NOT NULL
        EXECUTE format('
          ALTER TABLE %I.products
          ALTER COLUMN is_taxable SET NOT NULL', v_schema_name);
        
        -- 7. Cambiar DEFAULT de tax_rate a 0 (será calculado)
        EXECUTE format('
          ALTER TABLE %I.products
          ALTER COLUMN tax_rate SET DEFAULT 0', v_schema_name);
        
        v_migrated_count := v_migrated_count + 1;
        RAISE NOTICE '✅ Schema % migrado exitosamente', v_schema_name;
        
      EXCEPTION WHEN OTHERS THEN
        v_error_msg := SQLERRM;
        RAISE NOTICE '❌ Error en schema %: %', v_schema_name, v_error_msg;
        -- Continuar con el siguiente schema sin abortar
      END;
    ELSE
      RAISE NOTICE '⚠️ Schema % no tiene tabla products (saltar)', v_schema_name;
    END IF;
    
  END LOOP;
  
  -- Resumen
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ MIGRACIÓN COMPLETADA';
  RAISE NOTICE '   • Esquemas encontrados: %', v_schema_count;
  RAISE NOTICE '   • Esquemas migrados: %', v_migrated_count;
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  
END $$;

-- VERIFICACIÓN: Mostrar estado actual de todos los productos
RAISE NOTICE '';
RAISE NOTICE '📊 VERIFICACIÓN - Estado actual de products.is_taxable:';
RAISE NOTICE '';

DO $$
DECLARE
  v_schema_name TEXT;
  v_count INT;
BEGIN
  FOR v_schema_name IN 
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT IN ('public', 'information_schema', 'pg_catalog', 'pg_toast')
    ORDER BY schema_name
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = v_schema_name AND table_name = 'products'
    ) THEN
      EXECUTE format('
        SELECT COUNT(*)::TEXT FROM %I.products WHERE is_taxable IS NOT NULL
      ', v_schema_name) INTO v_count;
      
      RAISE NOTICE '  % : % productos con is_taxable', v_schema_name, v_count;
    END IF;
  END LOOP;
END $$;
