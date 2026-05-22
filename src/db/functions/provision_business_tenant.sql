-- ============================================================================
-- Helper: debe definirse ANTES de la funciÃ³n principal (runtime resolution)
-- ============================================================================
CREATE OR REPLACE FUNCTION ANY_MATCH(arr VARCHAR[], val VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN val = ANY(arr);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- IDON SAAS: PROVISION BUSINESS TENANT
-- Purpose: Create tenant schema + all module tables after business approval
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_business_tenant(
  p_request_id  UUID,
  p_schema_name VARCHAR,
  p_modules     VARCHAR[] DEFAULT ARRAY['pos']
)
RETURNS JSONB AS $$
DECLARE
  v_result      JSONB    := '{}'::jsonb;
  v_table_count INT      := 0;
  v_request     RECORD;
  v_modules     VARCHAR[];
BEGIN

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 1. Validar solicitud aprobada
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  SELECT * INTO v_request
  FROM public.business_registration_requests
  WHERE id = p_request_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Request not found or not in approved status');
  END IF;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 2. Crear schema
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema_name);
    v_result := v_result || jsonb_build_object('schema_created', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Schema creation failed: ' || SQLERRM);
  END;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 3. Resolver dependencias entre mÃ³dulos
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  v_modules := p_modules;

  -- purchases requiere suppliers como FK target
  IF ANY_MATCH(v_modules, 'purchases') AND NOT ANY_MATCH(v_modules, 'suppliers') THEN
    v_modules := array_append(v_modules, 'suppliers');
  END IF;

  -- kitchen, tables, delivery, einvoicing, orders y retail requieren pos (pos_orders FK)
  IF (ANY_MATCH(v_modules, 'kitchen')    OR
      ANY_MATCH(v_modules, 'tables')     OR
      ANY_MATCH(v_modules, 'delivery')   OR
      ANY_MATCH(v_modules, 'einvoicing') OR
      ANY_MATCH(v_modules, 'orders')     OR
      ANY_MATCH(v_modules, 'retail'))
     AND NOT ANY_MATCH(v_modules, 'pos') THEN
    v_modules := array_append(v_modules, 'pos');
  END IF;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 4. ENUMs del tenant (deben existir antes que las tablas que los usan)
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  BEGIN
    EXECUTE format('CREATE TYPE %I.order_status AS ENUM (''draft'',''pending'',''sent'',''completed'',''paid'',''cancelled'')', p_schema_name);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE format('CREATE TYPE %I.payment_status AS ENUM (''pending'',''completed'',''failed'',''refunded'')', p_schema_name);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    EXECUTE format('CREATE TYPE %I.user_role AS ENUM (''admin'',''manager'',''staff'',''viewer'',''client'')', p_schema_name);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 5. TABLAS CORE â€” siempre se crean, ordenadas por dependencia
  --    Orden: sin FK primero â†’ luego las que referencian tablas ya creadas
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  -- â”€ roles (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS roles (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(50)  NOT NULL UNIQUE,
      description TEXT,
      permissions JSONB        DEFAULT ''[]''::jsonb,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ settings (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS settings (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT,
      data_type   VARCHAR(50),
      description TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ business_profile (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS business_profile (
      id                  INT PRIMARY KEY DEFAULT 1,
      legal_name          VARCHAR(255) NOT NULL,
      tax_id              VARCHAR(50),
      email               VARCHAR(255),
      phone               VARCHAR(20),
      address             TEXT,
      city                VARCHAR(100),
      province            VARCHAR(100),
      establishment_code  VARCHAR(20),
      emission_point_code VARCHAR(20),
      sri_environment     VARCHAR(20) DEFAULT ''test'',
      invoice_sequences   JSONB       DEFAULT ''{}''::jsonb,
      logo_url            VARCHAR(500),
      website             VARCHAR(255),
      created_at          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      updated_at          TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT only_one_row CHECK (id = 1)
    )', p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ customers (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS customers (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            VARCHAR(255) NOT NULL,
      email           VARCHAR(255),
      phone           VARCHAR(20),
      document_type   VARCHAR(20)  DEFAULT ''cedula'',
      document_number VARCHAR(50)  UNIQUE,
      address         TEXT,
      notes           TEXT,
      is_active       BOOLEAN   DEFAULT true,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_customers_document_number_idx ON %I.customers (document_number)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_customers_name_idx ON %I.customers (name)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ categories (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS categories (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(250),
      is_active   BOOLEAN   DEFAULT true,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_categories_name_idx ON %I.categories (name)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ users (FK â†’ roles) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      first_name    VARCHAR(100),
      last_name     VARCHAR(100),
      role_id       INT REFERENCES %I.roles(id) ON DELETE RESTRICT,
      is_active     BOOLEAN   DEFAULT true,
      last_login_at TIMESTAMP,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ products (FK â†’ categories) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS products (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code          VARCHAR(50)   NOT NULL UNIQUE,
      name          VARCHAR(255)  NOT NULL,
      description   TEXT,
      category_id   INT REFERENCES %I.categories(id) ON DELETE SET NULL,
      unit_cost     NUMERIC(12,2) DEFAULT 0,
      selling_price NUMERIC(12,2) NOT NULL,
      tax_rate      NUMERIC(5,2)  DEFAULT 15,
      is_taxable    BOOLEAN       DEFAULT true,
      is_active     BOOLEAN       DEFAULT true,
      sku           VARCHAR(100),
      barcode       VARCHAR(100),
      stock         INT DEFAULT 0,
      min_stock     INT DEFAULT 0,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_products_category_id_idx ON %I.products (category_id)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_products_is_active_idx ON %I.products (is_active)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_products_barcode_idx ON %I.products (barcode)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_products_sku_idx ON %I.products (sku)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_products_code_idx ON %I.products (code)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- â”€ audit_logs (user_id sin FK â€” intencional para no bloquear borrado) â”€â”€â”€â”€â”€â”€â”€
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID,
      table_name  VARCHAR(100),
      action      VARCHAR(20),
      record_id   UUID,
      old_values  JSONB,
      new_values  JSONB,
      description TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_audit_logs_table_name_action_idx ON %I.audit_logs (table_name, action)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX IF NOT EXISTS %I_audit_logs_created_at_desc_idx ON %I.audit_logs (created_at DESC)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 6. TABLAS POR MÃ“DULO â€” ordenadas: sin FK â†’ luego sus dependientes
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    -- â”€â”€â”€ POS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'pos') THEN

    -- ========================================================================
    -- TABLA DE CONTADOR DIARIO DE Ã“RDENES (para numeraciÃ³n automÃ¡tica)
    -- ========================================================================
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.daily_order_counter (
        id SERIAL PRIMARY KEY,
        order_date DATE NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil''),
        updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'')
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    -- Ãndice para bÃºsqueda rÃ¡pida por fecha
    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_daily_order_counter_date_idx 
      ON %I.daily_order_counter (order_date DESC)',
      p_schema_name, p_schema_name);

    -- ========================================================================
    -- FUNCIÃ“N PARA ACTUALIZAR updated_at AUTOMÃTICAMENTE
    -- ========================================================================
    EXECUTE format('
      CREATE OR REPLACE FUNCTION %I.update_updated_at_column()
      RETURNS TRIGGER LANGUAGE plpgsql AS $func$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'';
        RETURN NEW;
      END;
      $func$', p_schema_name);

    EXECUTE format('
      DROP TRIGGER IF EXISTS update_daily_order_counter_updated_at ON %I.daily_order_counter', p_schema_name);
    
    EXECUTE format('
      CREATE TRIGGER update_daily_order_counter_updated_at
      BEFORE UPDATE ON %I.daily_order_counter
      FOR EACH ROW
      EXECUTE FUNCTION %I.update_updated_at_column()',
      p_schema_name, p_schema_name);

    -- ========================================================================
    -- FUNCIÃ“N PARA OBTENER EL SIGUIENTE NÃšMERO DE ORDEN (CON HORA ECUADOR)
    -- ========================================================================
    EXECUTE format('
      CREATE OR REPLACE FUNCTION %I.get_next_order_number()
      RETURNS INTEGER LANGUAGE plpgsql AS $func$
      DECLARE
        v_number INTEGER;
        v_today DATE;
      BEGIN
        -- Obtener la fecha actual de Ecuador
        v_today := (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'')::DATE;
        
        -- Insertar o actualizar el contador diario de forma atÃ³mica
        INSERT INTO %I.daily_order_counter (order_date, last_number)
        VALUES (v_today, 1)
        ON CONFLICT (order_date) 
        DO UPDATE SET last_number = %I.daily_order_counter.last_number + 1
        RETURNING last_number INTO v_number;
        
        RETURN v_number;
      END;
      $func$',
      p_schema_name, p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- â”€â”€â”€ pos_discounts (creado ANTES de pos_orders para permitir FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_discounts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name                VARCHAR(100) NOT NULL,
        description         TEXT,
        type                VARCHAR(20) NOT NULL CHECK (type IN (''percentage'', ''fixed'', ''buy_x_get_y'', ''bulk'', ''coupon'')),
        value               NUMERIC(10,2) NOT NULL,
        applies_to          VARCHAR(20) DEFAULT ''order'' CHECK (applies_to IN (''order'', ''product'', ''category'')),
        product_id          UUID REFERENCES %I.products(id) ON DELETE SET NULL,
        category_id         INT REFERENCES %I.categories(id) ON DELETE SET NULL,
        min_amount          NUMERIC(12,2) DEFAULT 0,
        max_discount        NUMERIC(12,2),
        min_quantity        INT DEFAULT 1,
        code                VARCHAR(50) UNIQUE,
        usage_limit         INT,
        used_count          INT DEFAULT 0,
        per_user_limit      INT,
        days_of_week        INT[],
        start_time          TIME,
        end_time            TIME,
        start_date          TIMESTAMP,
        end_date            TIMESTAMP,
        stackable           BOOLEAN DEFAULT FALSE,
        priority            INT DEFAULT 0,
        customer_segment    VARCHAR(20) DEFAULT ''all'' CHECK (customer_segment IN (''all'', ''new'', ''frequent'', ''vip'')),
        is_active           BOOLEAN DEFAULT TRUE,
        created_by          UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name);

    -- Ãndices para pos_discounts
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_type_idx ON %I.pos_discounts (type)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_is_active_idx ON %I.pos_discounts (is_active)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_code_idx ON %I.pos_discounts (code)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_product_id_idx ON %I.pos_discounts (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_category_id_idx ON %I.pos_discounts (category_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_dates_idx ON %I.pos_discounts (start_date, end_date)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_priority_idx ON %I.pos_discounts (priority DESC)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_days_of_week_idx ON %I.pos_discounts USING GIN (days_of_week)', p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;

    -- pos_orders (FK â†’ customers, users, pos_discounts)
    -- Los pagos van en pos_payments; pos_orders solo almacena totales y estado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_orders (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number    VARCHAR(20)     NOT NULL,
        order_type      VARCHAR(20)     NOT NULL DEFAULT ''dine_in'',
        status          %I.order_status NOT NULL DEFAULT ''pending'',
        customer_id     UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        customer_name   VARCHAR(255),
        mesa_numero     INT,
        subtotal        NUMERIC(12,2)   NOT NULL DEFAULT 0,
        tax_rate        NUMERIC(5,2)    NOT NULL DEFAULT 15,
        tax_amount      NUMERIC(12,2)   NOT NULL DEFAULT 0,
        total           NUMERIC(12,2)   NOT NULL DEFAULT 0,
        discount_id     UUID REFERENCES %I.pos_discounts(id) ON DELETE SET NULL,
        discount_amount NUMERIC(12,2)   DEFAULT 0,
        notes           TEXT,
        created_by      UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        printed_at      TIMESTAMP,
        printed         BOOLEAN NOT NULL DEFAULT FALSE
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I_pos_orders_number_date_idx ON %I.pos_orders (order_number, date(created_at))',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_orders_status_idx ON %I.pos_orders (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_orders_order_type_idx ON %I.pos_orders (order_type)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_orders_created_at_desc_idx ON %I.pos_orders (created_at DESC)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_orders_discount_id_idx ON %I.pos_orders (discount_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_order_items â€” almacena precio al momento de la venta (inmutable)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_order_items (
        id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID          NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        product_id   UUID          NOT NULL REFERENCES %I.products(id)   ON DELETE RESTRICT,
        product_name VARCHAR(255)  NOT NULL DEFAULT '''',
        code         VARCHAR(50),
        quantity     INT           NOT NULL DEFAULT 1,
        unit_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
        tax_rate     NUMERIC(10,2) NOT NULL DEFAULT 0,
        iva_amount   NUMERIC(10,2) NOT NULL DEFAULT 0,
        line_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
        notes        TEXT,
        paid         BOOLEAN       DEFAULT FALSE,
        created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_order_items_order_id_idx ON %I.pos_order_items (order_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_order_items_product_id_idx ON %I.pos_order_items (product_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_payments (FK â†’ pos_orders)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE RESTRICT,
        payment_method   VARCHAR(50)       NOT NULL DEFAULT ''cash'',
        amount           NUMERIC(12,2)     NOT NULL,
        reference_number VARCHAR(100),
        status           %I.payment_status NOT NULL DEFAULT ''pending'',
        paid_at          TIMESTAMP,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_pos_payments_order_id_idx ON %I.pos_payments (order_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_receipts (FK â†’ pos_orders)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_receipts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        receipt_number VARCHAR(50) UNIQUE,
        subtotal       NUMERIC(12,2),
        tax_amount     NUMERIC(12,2),
        total          NUMERIC(12,2),
        issued_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- â”€â”€â”€ pos_order_discounts (historial de descuentos aplicados) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS pos_order_discounts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id            UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        discount_id         UUID REFERENCES %I.pos_discounts(id) ON DELETE SET NULL,
        discount_name       VARCHAR(100),
        discount_type       VARCHAR(20),
        discount_value      NUMERIC(10,2),
        amount              NUMERIC(12,2) NOT NULL,
        original_subtotal   NUMERIC(12,2),
        final_subtotal      NUMERIC(12,2),
        coupon_code         VARCHAR(50),
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_order_discounts_order_id_idx ON %I.pos_order_discounts (order_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_order_discounts_discount_id_idx ON %I.pos_order_discounts (discount_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_order_discounts_created_at_idx ON %I.pos_order_discounts (created_at DESC)', p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;

    -- â”€â”€â”€ coupons (cupones especÃ­ficos) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS coupons (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code                VARCHAR(50) UNIQUE NOT NULL,
        discount_id         UUID NOT NULL REFERENCES %I.pos_discounts(id) ON DELETE CASCADE,
        is_single_use       BOOLEAN DEFAULT TRUE,
        max_uses            INT,
        used_count          INT DEFAULT 0,
        expires_at          TIMESTAMP,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by          UUID REFERENCES %I.users(id) ON DELETE SET NULL
      )', p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_coupons_code_idx ON %I.coupons (code)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_coupons_discount_id_idx ON %I.coupons (discount_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_coupons_expires_at_idx ON %I.coupons (expires_at)', p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;

    -- cash_register_openings
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS cash_register_openings (
        id             SERIAL PRIMARY KEY,
        user_id        VARCHAR(100)  NOT NULL,
        user_name      VARCHAR(255),
        date           DATE          NOT NULL,
        moneda_001     INT           NOT NULL DEFAULT 0,
        moneda_005     INT           NOT NULL DEFAULT 0,
        moneda_010     INT           NOT NULL DEFAULT 0,
        moneda_025     INT           NOT NULL DEFAULT 0,
        moneda_050     INT           NOT NULL DEFAULT 0,
        moneda_100     INT           NOT NULL DEFAULT 0,
        billete_1      INT           NOT NULL DEFAULT 0,
        billete_5      INT           NOT NULL DEFAULT 0,
        billete_10     INT           NOT NULL DEFAULT 0,
        billete_20     INT           NOT NULL DEFAULT 0,
        billete_50     INT           NOT NULL DEFAULT 0,
        billete_100    INT           NOT NULL DEFAULT 0,
        total_efectivo NUMERIC(14,2) NOT NULL DEFAULT 0,
        monto_banca    NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_inicial  NUMERIC(14,2) NOT NULL DEFAULT 0,
        observaciones  TEXT,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_opening_date_user UNIQUE (date, user_id)
      )', p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_cash_register_openings_date_idx ON %I.cash_register_openings (date DESC)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- cash_register_closing
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS cash_register_closing (
        id               SERIAL PRIMARY KEY,
        closing_user_id  VARCHAR(50)   NOT NULL,
        closing_date     DATE          NOT NULL,
        closing_time     TIME          NOT NULL DEFAULT CURRENT_TIME,
        cash_counted     NUMERIC(14,2) NOT NULL,
        cash_system      NUMERIC(14,2) NOT NULL,
        diff_cash        NUMERIC(14,2) NOT NULL,
        transfer_counted NUMERIC(14,2) NOT NULL,
        transfer_system  NUMERIC(14,2) NOT NULL,
        diff_transfer    NUMERIC(14,2) NOT NULL,
        card_counted     NUMERIC(14,2) NOT NULL,
        card_system      NUMERIC(14,2) NOT NULL,
        diff_card        NUMERIC(14,2) NOT NULL,
        orders_counted   INT           NOT NULL,
        orders_system    INT           NOT NULL,
        diff_orders      INT           NOT NULL,
        extras           JSONB,
        expenses_total   NUMERIC(14,2) NOT NULL,
        total_counted    NUMERIC(14,2) NOT NULL,
        total_system     NUMERIC(14,2) NOT NULL,
        diff_total       NUMERIC(14,2) NOT NULL,
        net_system       NUMERIC(14,2) NOT NULL,
        net_counted      NUMERIC(14,2) NOT NULL,
        diff_net         NUMERIC(14,2) NOT NULL,
        remarks          TEXT,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_cash_register_closing_closing_date_idx ON %I.cash_register_closing (closing_date)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_cash_register_closing_created_at_desc_idx ON %I.cash_register_closing (created_at DESC)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- incomes_extras (ingresos extras de caja â€” no ventas, sÃ­ afectan cuadre)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS incomes_extras (
        id             SERIAL PRIMARY KEY,
        date           DATE           NOT NULL,
        amount         NUMERIC(10,2)  NOT NULL,
        payment_method VARCHAR(20)    NOT NULL DEFAULT ''cash'',
        description    TEXT,
        user_id        VARCHAR(100),
        user_name      VARCHAR(200),
        created_at     TIMESTAMPTZ    DEFAULT NOW()
      )', p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_incomes_extras_date_idx ON %I.incomes_extras (date DESC)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ INVENTORY â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'inventory') THEN

    -- inventory_physical (sin FK)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS inventory_physical (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(150),
        status        VARCHAR(20) NOT NULL DEFAULT ''open'',
        started_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
        started_time  TIME        NOT NULL DEFAULT CURRENT_TIME,
        closed_date   DATE,
        closed_time   TIME,
        total_items   INT DEFAULT 0,
        counted_items INT DEFAULT 0,
        pending_items INT DEFAULT 0,
        notes         TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_status_idx ON %I.inventory_physical (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_created_at_desc_idx ON %I.inventory_physical (created_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_physical_categories (FK â†’ inventory_physical, categories)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS inventory_physical_categories (
        id           SERIAL PRIMARY KEY,
        inventory_id INT NOT NULL REFERENCES %I.inventory_physical(id) ON DELETE CASCADE,
        category_id  INT NOT NULL REFERENCES %I.categories(id) ON DELETE CASCADE
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_categories_inventory_idx ON %I.inventory_physical_categories (inventory_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_physical_items (FK â†’ inventory_physical, products)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS inventory_physical_items (
        id            SERIAL PRIMARY KEY,
        inventory_id  INT  NOT NULL REFERENCES %I.inventory_physical(id) ON DELETE CASCADE,
        product_id    UUID NOT NULL REFERENCES %I.products(id) ON DELETE CASCADE,
        product_name  VARCHAR(255) NOT NULL,
        system_stock  INT NOT NULL,
        counted_stock INT,
        difference    INT,
        status        VARCHAR(20) NOT NULL DEFAULT ''pending'',
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_items_inventory_idx ON %I.inventory_physical_items (inventory_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_items_product_idx ON %I.inventory_physical_items (product_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_movements (FK â†’ products)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id           SERIAL PRIMARY KEY,
        product_id   UUID NOT NULL REFERENCES %I.products(id) ON DELETE CASCADE,
        type         VARCHAR(20) NOT NULL,
        quantity     INT         NOT NULL,
        unit_cost    NUMERIC(12,2),
        reference_id INT,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_movements_product_idx ON %I.inventory_movements (product_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_movements_type_idx ON %I.inventory_movements (type)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- recipes (FK â†’ categories)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS recipes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        category_id INT REFERENCES %I.categories(id) ON DELETE SET NULL,
        yield_qty   NUMERIC(10,2) NOT NULL DEFAULT 1,
        yield_unit  VARCHAR(50)   DEFAULT ''unidad'',
        total_cost  NUMERIC(12,2) DEFAULT 0,
        is_active   BOOLEAN       DEFAULT true,
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- recipe_ingredients (FK â†’ recipes, products)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipe_id       UUID NOT NULL REFERENCES %I.recipes(id) ON DELETE CASCADE,
        product_id      UUID REFERENCES %I.products(id) ON DELETE SET NULL,
        ingredient_name VARCHAR(255) NOT NULL,
        quantity        NUMERIC(10,3) NOT NULL DEFAULT 1,
        unit            VARCHAR(50),
        unit_cost       NUMERIC(12,2) DEFAULT 0,
        total_cost      NUMERIC(12,2) DEFAULT 0,
        created_at      TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_recipe_ingredients_recipe_idx ON %I.recipe_ingredients (recipe_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ SUPPLIERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'suppliers') THEN

    -- suppliers (sin FK)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS suppliers (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name       VARCHAR(255) NOT NULL,
        tax_id     VARCHAR(50),
        contact    VARCHAR(255),
        phone      VARCHAR(20),
        email      VARCHAR(255),
        address    TEXT,
        is_active  BOOLEAN   DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ PURCHASES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'purchases') THEN

    -- purchase_orders (FK â†’ suppliers)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number VARCHAR(50) UNIQUE,
        supplier_id  UUID REFERENCES %I.suppliers(id) ON DELETE RESTRICT,
        status       VARCHAR(20)   DEFAULT ''draft'',
        subtotal     NUMERIC(12,2) DEFAULT 0,
        tax_amount   NUMERIC(12,2) DEFAULT 0,
        total        NUMERIC(12,2) NOT NULL DEFAULT 0,
        expected_at  TIMESTAMP,
        received_at  TIMESTAMP,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- purchase_order_items (FK â†’ purchase_orders, products)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_id UUID NOT NULL REFERENCES %I.purchase_orders(id) ON DELETE CASCADE,
        product_id        UUID REFERENCES %I.products(id) ON DELETE RESTRICT,
        product_name      VARCHAR(255)  NOT NULL,
        quantity          INT           NOT NULL DEFAULT 1,
        unit_cost         NUMERIC(12,2) NOT NULL,
        line_total        NUMERIC(12,2) NOT NULL,
        received_qty      INT DEFAULT 0,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ ACCOUNTING (gastos operativos + cuentas por cobrar/pagar) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'accounting') THEN

    -- CategorÃ­as de gastos (SERIAL id para compatibilidad con routes)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS expense_categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL UNIQUE,
        color      VARCHAR(7)   DEFAULT ''#95a5a6'',
        is_active  BOOLEAN      DEFAULT true,
        created_at TIMESTAMPTZ  DEFAULT NOW(),
        updated_at TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('
      INSERT INTO %I.expense_categories (name, color) VALUES
        (''Alquiler'',      ''#f39c12''),
        (''Servicios'',     ''#3498db''),
        (''Proveedores'',   ''#2ecc71''),
        (''NÃ³mina'',        ''#e74c3c''),
        (''Publicidad'',    ''#9b59b6''),
        (''Mantenimiento'', ''#1abc9c''),
        (''Transporte'',    ''#e67e22''),
        (''Otros'',         ''#95a5a6'')
      ', p_schema_name);

    -- Gastos operativos
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS expenses (
        id          SERIAL PRIMARY KEY,
        reference   VARCHAR(100),
        description VARCHAR(500),
        amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
        date        DATE          NOT NULL DEFAULT CURRENT_DATE,
        category_id INTEGER REFERENCES %I.expense_categories(id) ON DELETE SET NULL,
        supplier    VARCHAR(255),
        notes       TEXT,
        created_by  UUID,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_expenses_date_idx          ON %I.expenses (date)',         p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_expenses_category_id_idx   ON %I.expenses (category_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_expenses_created_at_idx    ON %I.expenses (created_at DESC)', p_schema_name, p_schema_name);

    -- CategorÃ­as de ingresos
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS income_categories (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(100) NOT NULL UNIQUE,
        color      VARCHAR(7)   DEFAULT ''#27ae60'',
        created_at TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('
      INSERT INTO %I.income_categories (name, color) VALUES
        (''Ventas'',      ''#2ecc71''),
        (''Servicios'',   ''#3498db''),
        (''Reembolsos'',  ''#f1c40f''),
        (''Otros'',       ''#95a5a6'')
      ', p_schema_name);

    -- Ingresos
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS incomes (
        id          SERIAL PRIMARY KEY,
        date        DATE          NOT NULL DEFAULT CURRENT_DATE,
        category_id INTEGER REFERENCES %I.income_categories(id) ON DELETE SET NULL,
        description VARCHAR(500),
        amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
        reference   VARCHAR(100),
        created_by  UUID,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_incomes_date_idx        ON %I.incomes (date)',         p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_incomes_category_id_idx ON %I.incomes (category_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_incomes_created_at_idx  ON %I.incomes (created_at DESC)', p_schema_name, p_schema_name);

    -- Cuentas por pagar
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS accounts_payable (
        id             SERIAL PRIMARY KEY,
        invoice_number VARCHAR(50),
        supplier_name  VARCHAR(255) NOT NULL,
        supplier_id    UUID,
        amount         NUMERIC(10,2) NOT NULL DEFAULT 0,
        paid_amount    NUMERIC(10,2)          DEFAULT 0,
        balance        NUMERIC(10,2)          DEFAULT 0,
        issue_date     DATE         DEFAULT CURRENT_DATE,
        due_date       DATE         NOT NULL,
        paid_date      DATE,
        status         VARCHAR(20)  DEFAULT ''pending'',
        type           VARCHAR(30)  DEFAULT ''purchase'',
        description    TEXT,
        category       VARCHAR(100),
        notes          TEXT,
        created_at     TIMESTAMPTZ  DEFAULT NOW(),
        updated_at     TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_payable_status_idx   ON %I.accounts_payable (status)',   p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_payable_due_date_idx ON %I.accounts_payable (due_date)', p_schema_name, p_schema_name);

    -- Pagos de cuentas por pagar
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS accounts_payable_payments (
        id               SERIAL PRIMARY KEY,
        payable_id       INTEGER NOT NULL REFERENCES %I.accounts_payable(id) ON DELETE CASCADE,
        payment_date     DATE    DEFAULT CURRENT_DATE,
        amount           NUMERIC(10,2) NOT NULL,
        payment_method   VARCHAR(50)   DEFAULT ''cash'',
        reference_number VARCHAR(100),
        created_at       TIMESTAMPTZ   DEFAULT NOW()
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_payable_payments_payable_id_idx ON %I.accounts_payable_payments (payable_id)', p_schema_name, p_schema_name);

    -- Cuentas por cobrar
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS accounts_receivable (
        id           SERIAL PRIMARY KEY,
        order_number VARCHAR(50),
        invoice_number VARCHAR(50),
        customer_id  UUID,
        customer_name VARCHAR(255),
        amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
        paid_amount  NUMERIC(10,2)          DEFAULT 0,
        balance      NUMERIC(10,2)          DEFAULT 0,
        issue_date   DATE          DEFAULT CURRENT_DATE,
        due_date     DATE,
        status       VARCHAR(20)   DEFAULT ''pending'',
        description  TEXT,
        notes        TEXT,
        created_at   TIMESTAMPTZ   DEFAULT NOW(),
        updated_at   TIMESTAMPTZ   DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_receivable_status_idx      ON %I.accounts_receivable (status)',    p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_receivable_customer_id_idx ON %I.accounts_receivable (customer_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_accounts_receivable_due_date_idx    ON %I.accounts_receivable (due_date)',  p_schema_name, p_schema_name);

  END IF;

  -- â”€â”€â”€ TABLES â€” mesas del restaurante (FK â†’ pos_orders) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'tables') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS dining_tables (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_number     INT NOT NULL UNIQUE,
        seats            INT DEFAULT 4,
        location         VARCHAR(100),
        status           VARCHAR(20) DEFAULT ''available'',
        current_order_id UUID REFERENCES %I.pos_orders(id) ON DELETE SET NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_dining_tables_status_idx ON %I.dining_tables (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ KITCHEN (FK â†’ pos_orders) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'kitchen') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS kitchen_tasks (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id    UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        status      VARCHAR(20) NOT NULL DEFAULT ''pending'',
        priority    INT         DEFAULT 0,
        started_at  TIMESTAMP,
        finished_at TIMESTAMP,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_kitchen_tasks_status_idx ON %I.kitchen_tasks (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ RESERVATIONS (FK â†’ customers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'reservations') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS reservations (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id      UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        customer_name    VARCHAR(255),
        party_size       INT         NOT NULL DEFAULT 1,
        reservation_time TIMESTAMP   NOT NULL,
        table_id         UUID,
        status           VARCHAR(20) DEFAULT ''scheduled'',
        notes            TEXT,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_reservations_reservation_time_idx ON %I.reservations (reservation_time)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_reservations_status_idx ON %I.reservations (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ DELIVERY (FK â†’ pos_orders, customers, users) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'delivery') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS delivery_orders (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        customer_id  UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        address      TEXT NOT NULL,
        driver_id    UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        status       VARCHAR(20) DEFAULT ''pending'',
        estimated_at TIMESTAMP,
        delivered_at TIMESTAMP,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_delivery_orders_status_idx ON %I.delivery_orders (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ ROUTES (FK â†’ users) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'routes') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS delivery_routes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id   UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        date        DATE        NOT NULL,
        start_point TEXT,
        end_point   TEXT,
        status      VARCHAR(20) DEFAULT ''planned'',
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ TRACKING (FK â†’ users) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'tracking') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS tracking_gps (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id  UUID REFERENCES %I.users(id) ON DELETE CASCADE,
        latitude   NUMERIC(10,7) NOT NULL,
        longitude  NUMERIC(10,7) NOT NULL,
        speed_kmh  NUMERIC(6,2),
        tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_tracking_gps_driver_id_tracked_at_idx ON %I.tracking_gps (driver_id, tracked_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ APPOINTMENTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'appointments') THEN

    -- services (sin FK)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS services (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name             VARCHAR(255)  NOT NULL,
        description      TEXT,
        price            NUMERIC(12,2) NOT NULL,
        duration_minutes INT           DEFAULT 30,
        is_active        BOOLEAN       DEFAULT true,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    -- appointments (FK â†’ services, customers)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS appointments (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id    UUID NOT NULL REFERENCES %I.services(id) ON DELETE RESTRICT,
        customer_id   UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        customer_name VARCHAR(255),
        scheduled_for TIMESTAMP   NOT NULL,
        status        VARCHAR(20) DEFAULT ''scheduled'',
        notes         TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_appointments_scheduled_for_idx ON %I.appointments (scheduled_for)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_appointments_status_idx ON %I.appointments (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ EMPLOYEES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'employees') THEN

    -- employees (FK â†’ users)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS employees (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        full_name       VARCHAR(255) NOT NULL,
        email           VARCHAR(255),
        phone           VARCHAR(20),
        position        VARCHAR(100),
        department      VARCHAR(100),
        document_number VARCHAR(50),
        salary          NUMERIC(12,2),
        hired_at        DATE,
        status          VARCHAR(20) DEFAULT ''active'',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- worked_hours (FK â†’ employees)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS worked_hours (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        worked_date DATE         NOT NULL,
        hours       NUMERIC(6,2) NOT NULL DEFAULT 0,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_worked_hours_employee_id_worked_date_idx ON %I.worked_hours (employee_id, worked_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- attendance_records (FK â†’ employees)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS attendance_records (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        type        VARCHAR(20) NOT NULL,
        event_time  TIMESTAMP   NOT NULL,
        method      VARCHAR(30),
        location    VARCHAR(100),
        device_info TEXT,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_attendance_records_employee_id_event_time_idx ON %I.attendance_records (employee_id, event_time)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_schedules (FK â†’ employees)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS employee_schedules (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id   UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        schedule_date DATE NOT NULL,
        shift_start   TIME NOT NULL,
        shift_end     TIME NOT NULL,
        type          VARCHAR(30),
        notes         TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_employee_schedules_employee_id_schedule_date_idx ON %I.employee_schedules (employee_id, schedule_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_leaves (FK â†’ employees)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS employee_leaves (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        leave_type  VARCHAR(30) NOT NULL,
        start_date  DATE        NOT NULL,
        end_date    DATE        NOT NULL,
        status      VARCHAR(20) DEFAULT ''pending'',
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_employee_leaves_employee_id_leave_type_start_date_idx ON %I.employee_leaves (employee_id, leave_type, start_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_payrolls (FK â†’ employees)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS employee_payrolls (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id  UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        period_start DATE NOT NULL,
        period_end   DATE NOT NULL,
        payment_date DATE,
        base_salary  NUMERIC(12,2) DEFAULT 0,
        total_hours  NUMERIC(10,2) DEFAULT 0,
        extra_hours  NUMERIC(10,2) DEFAULT 0,
        bonuses      NUMERIC(12,2) DEFAULT 0,
        deductions   NUMERIC(12,2) DEFAULT 0,
        gross_salary NUMERIC(12,2) DEFAULT 0,
        net_salary   NUMERIC(12,2) DEFAULT 0,
        status       VARCHAR(20) DEFAULT ''pending'',
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_employee_payrolls_employee_id_period_idx ON %I.employee_payrolls (employee_id, period_start)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_payroll_details (FK â†’ employee_payrolls)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS employee_payroll_details (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payroll_id UUID NOT NULL REFERENCES %I.employee_payrolls(id) ON DELETE CASCADE,
        concept    VARCHAR(100)  NOT NULL,
        type       VARCHAR(20)   NOT NULL,
        amount     NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_employee_payroll_details_payroll_id_idx ON %I.employee_payroll_details (payroll_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ CRM (FK â†’ customers, users) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'crm') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS crm_interactions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES %I.customers(id) ON DELETE CASCADE,
        type        VARCHAR(50) NOT NULL,
        subject     VARCHAR(255),
        description TEXT,
        created_by  UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_crm_interactions_customer_id_idx ON %I.crm_interactions (customer_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- Segmentos personalizados de clientes
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS crm_custom_segments (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        color       VARCHAR(20)  DEFAULT ''#6842fe'',
        conditions  JSONB        DEFAULT ''{}''::jsonb,
        created_at  TIMESTAMPTZ  DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    -- CampaÃ±as de email
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS email_campaigns (
        id         SERIAL PRIMARY KEY,
        title      VARCHAR(255) NOT NULL,
        subject    VARCHAR(500) NOT NULL,
        content    TEXT         NOT NULL,
        image_url  TEXT,
        is_active  BOOLEAN      DEFAULT true,
        sent_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ  DEFAULT NOW(),
        updated_at TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_campaigns_is_active_idx ON %I.email_campaigns (is_active)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_campaigns_created_at_idx ON %I.email_campaigns (created_at DESC)', p_schema_name, p_schema_name);

  END IF;

  -- â”€â”€â”€ LOYALTY (FK â†’ customers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'loyalty') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS loyalty_points (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id  UUID NOT NULL REFERENCES %I.customers(id) ON DELETE CASCADE,
        points       INT  NOT NULL DEFAULT 0,
        type         VARCHAR(20) NOT NULL,
        reference_id UUID,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_loyalty_points_customer_id_idx ON %I.loyalty_points (customer_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ QUEUE (FK â†’ customers) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'queue') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS service_queue (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        queue_type  VARCHAR(50) NOT NULL DEFAULT ''general'',
        ticket_num  INT         NOT NULL,
        customer_id UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        status      VARCHAR(20) DEFAULT ''waiting'',
        called_at   TIMESTAMP,
        served_at   TIMESTAMP,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_service_queue_status_created_at_idx ON %I.service_queue (status, created_at)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ ECOMMERCE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'ecommerce') THEN

    -- ecommerce_orders (FK â†’ customers)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS ecommerce_orders (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number     VARCHAR(50)   NOT NULL UNIQUE,
        customer_id      UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        status           VARCHAR(20)   DEFAULT ''pending'',
        subtotal         NUMERIC(12,2) DEFAULT 0,
        tax_amount       NUMERIC(12,2) DEFAULT 0,
        total            NUMERIC(12,2) NOT NULL DEFAULT 0,
        shipping_address TEXT,
        notes            TEXT,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_ecommerce_orders_status_idx ON %I.ecommerce_orders (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- ecommerce_order_items (FK â†’ ecommerce_orders, products)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS ecommerce_order_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID NOT NULL REFERENCES %I.ecommerce_orders(id) ON DELETE CASCADE,
        product_id   UUID REFERENCES %I.products(id) ON DELETE RESTRICT,
        product_name VARCHAR(255)  NOT NULL,
        quantity     INT           NOT NULL DEFAULT 1,
        unit_price   NUMERIC(12,2) NOT NULL,
        line_total   NUMERIC(12,2) NOT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ NOTIFICATIONS (FK â†’ users) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'notifications') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS notifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID REFERENCES %I.users(id) ON DELETE CASCADE,
        type       VARCHAR(50) NOT NULL,
        title      VARCHAR(255),
        content    TEXT,
        is_read    BOOLEAN     DEFAULT false,
        sent_at    TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_notifications_user_id_is_read_idx ON %I.notifications (user_id, is_read)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- Plantillas de email
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS email_templates (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        subject    VARCHAR(500) NOT NULL,
        body       TEXT         NOT NULL,
        category   VARCHAR(50)  DEFAULT ''general'',
        is_active  BOOLEAN      DEFAULT true,
        created_at TIMESTAMPTZ  DEFAULT NOW(),
        updated_at TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_templates_is_active_idx  ON %I.email_templates (is_active)',   p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_templates_created_at_idx ON %I.email_templates (created_at DESC)', p_schema_name, p_schema_name);

    -- Registro de emails enviados
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS email_logs (
        id               SERIAL PRIMARY KEY,
        template_id      INTEGER,
        recipient        VARCHAR(500),
        recipients       JSONB,
        subject          VARCHAR(500),
        type             VARCHAR(20)  DEFAULT ''single'',
        status           VARCHAR(20)  DEFAULT ''pending'',
        sent_at          TIMESTAMPTZ,
        error_message    TEXT,
        invoice_id       INTEGER,
        invoice_number   VARCHAR(100),
        recipient_count  INTEGER,
        created_at       TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_logs_status_idx     ON %I.email_logs (status)',          p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_email_logs_created_at_idx ON %I.email_logs (created_at DESC)', p_schema_name, p_schema_name);

    -- Suscripciones push (WebPush)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id          SERIAL PRIMARY KEY,
        endpoint    TEXT        NOT NULL UNIQUE,
        p256dh      VARCHAR(500) NOT NULL,
        auth        VARCHAR(500) NOT NULL,
        user_agent  TEXT,
        user_id     UUID,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_push_subscriptions_user_id_idx ON %I.push_subscriptions (user_id)', p_schema_name, p_schema_name);

    -- Historial de notificaciones push enviadas
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS push_notifications_history (
        id           SERIAL PRIMARY KEY,
        title        VARCHAR(255) NOT NULL,
        body         TEXT,
        icon         VARCHAR(500),
        url          VARCHAR(500),
        sent_count   INTEGER      DEFAULT 0,
        failed_count INTEGER      DEFAULT 0,
        created_by   UUID,
        created_at   TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_push_history_created_at_idx ON %I.push_notifications_history (created_at DESC)', p_schema_name, p_schema_name);

    -- Notificaciones programadas
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS scheduled_notifications (
        id          SERIAL PRIMARY KEY,
        title       VARCHAR(255) NOT NULL,
        message     TEXT         NOT NULL,
        type        VARCHAR(50)  NOT NULL,
        schedule_at TIMESTAMPTZ  NOT NULL,
        sent_at     TIMESTAMPTZ,
        status      VARCHAR(20)  DEFAULT ''pending'',
        error       TEXT,
        created_by  UUID,
        created_at  TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_scheduled_notif_schedule_at_idx ON %I.scheduled_notifications (schedule_at)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_scheduled_notif_status_idx      ON %I.scheduled_notifications (status)',      p_schema_name, p_schema_name);

  END IF;

  -- â”€â”€â”€ EINVOICING (SRI Ecuador) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'einvoicing') THEN

    -- einvoice_config (sin FK; INT id + CHECK garantiza una sola fila)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS einvoice_config (
        id                        INT PRIMARY KEY DEFAULT 1,
        ruc                       VARCHAR(13),
        razon_social              VARCHAR(300),
        nombre_comercial          VARCHAR(300),
        direccion_matriz          VARCHAR(300),
        direccion_establecimiento VARCHAR(300),
        contribuyente_especial    VARCHAR(50),
        obligado_contabilidad     BOOLEAN   DEFAULT false,
        ambiente                  VARCHAR(2) DEFAULT ''1'',
        serie_estab               VARCHAR(3) DEFAULT ''001'',
        serie_pto_emision         VARCHAR(3) DEFAULT ''001'',
        secuencial_actual         INT        DEFAULT 1,
        p12_path                  TEXT,
        p12_password              TEXT,
        cert_valid_until          DATE,
        has_signature             BOOLEAN   DEFAULT false,
        logo_url                  TEXT,
        updated_at                TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT only_one_row CHECK (id = 1)
      )', p_schema_name);
    EXECUTE format(
      'INSERT INTO %I.einvoice_config (id) VALUES (1) ON CONFLICT DO NOTHING',
      p_schema_name);
    v_table_count := v_table_count + 1;

    -- einvoices (FKs sueltos â€” no bloquear si pos/customers no estÃ¡n activos)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS einvoices (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       UUID,
        invoice_number VARCHAR(20),
        access_key     VARCHAR(49),
        auth_number    VARCHAR(49),
        customer_id    UUID,
        customer_name  VARCHAR(300),
        customer_ruc   VARCHAR(20),
        customer_email VARCHAR(200),
        customer_phone VARCHAR(20),
        subtotal       NUMERIC(10,2) DEFAULT 0,
        iva_amount     NUMERIC(10,2) DEFAULT 0,
        total          NUMERIC(10,2) DEFAULT 0,
        discount_amount NUMERIC(10,2) DEFAULT 0,
        items          JSONB,
        signed_xml     TEXT,
        status         VARCHAR(30) DEFAULT ''pendiente'',
        sri_message    TEXT,
        sri_json       JSONB,
        emission_date  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        auth_date      TIMESTAMP WITH TIME ZONE,
        created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )', p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_einvoices_order_id_idx ON %I.einvoices (order_id)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_einvoices_status_idx ON %I.einvoices (status)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_einvoices_access_key_idx ON %I.einvoices (access_key)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_einvoices_created_at_desc_idx ON %I.einvoices (created_at DESC)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_einvoices_discount_amount_idx ON %I.einvoices (discount_amount)',
      p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;

    -- Notas de crÃ©dito
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS credit_notes (
        id                SERIAL PRIMARY KEY,
        invoice_id        UUID REFERENCES %I.einvoices(id) ON DELETE SET NULL,
        reference_invoice VARCHAR(50),
        reason            TEXT NOT NULL,
        items             JSONB        DEFAULT ''[]'',
        subtotal          NUMERIC(10,2) DEFAULT 0,
        iva_amount        NUMERIC(10,2) DEFAULT 0,
        discount_amount   NUMERIC(10,2) DEFAULT 0,
        total             NUMERIC(10,2) DEFAULT 0,
        customer_name     VARCHAR(255),
        customer_ruc      VARCHAR(20),
        customer_email    VARCHAR(255),
        status            VARCHAR(20)  DEFAULT ''emitida'',
        created_at        TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_invoice_id_idx ON %I.credit_notes (invoice_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_created_at_idx ON %I.credit_notes (created_at DESC)', p_schema_name, p_schema_name);

  END IF;



  -- â”€â”€â”€ RETAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  -- El mÃ³dulo retail extiende pos con sesiones de caja y configuraciÃ³n
  -- especÃ­fica de tienda (modo escaneo, precios en visor, etc.)
  IF ANY_MATCH(v_modules, 'retail') THEN

    -- retail_settings (una fila por negocio, extiende settings con opciones retail)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS retail_settings (
        id                       INT PRIMARY KEY DEFAULT 1,
        barcode_scan_enabled     BOOLEAN       DEFAULT true,
        show_stock_in_pos        BOOLEAN       DEFAULT true,
        require_customer_on_sale BOOLEAN       DEFAULT false,
        auto_open_cash_drawer    BOOLEAN       DEFAULT true,
        default_payment_method   VARCHAR(50)   DEFAULT ''cash'',
        price_display_mode       VARCHAR(20)   DEFAULT ''with_tax'',
        low_stock_threshold      INT           DEFAULT 5,
        allow_negative_stock     BOOLEAN       DEFAULT false,
        updated_at               TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT retail_only_one_row CHECK (id = 1)
      )', p_schema_name);
    EXECUTE format(
      'INSERT INTO %I.retail_settings (id) VALUES (1) ON CONFLICT DO NOTHING',
      p_schema_name);
    v_table_count := v_table_count + 1;

    -- retail_sessions (turno de cajero: apertura â†’ cierre, agrupa ventas del turno)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS retail_sessions (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        cashier_id      UUID          REFERENCES %I.users(id) ON DELETE SET NULL,
        cashier_name    VARCHAR(255),
        opening_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
        closing_amount  NUMERIC(14,2),
        cash_sales      NUMERIC(14,2) DEFAULT 0,
        card_sales      NUMERIC(14,2) DEFAULT 0,
        transfer_sales  NUMERIC(14,2) DEFAULT 0,
        total_sales     NUMERIC(14,2) DEFAULT 0,
        orders_count    INT           DEFAULT 0,
        items_sold      INT           DEFAULT 0,
        discounts_total NUMERIC(14,2) DEFAULT 0,
        status          VARCHAR(20)   DEFAULT ''open'',
        opened_at       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at       TIMESTAMP,
        notes           TEXT
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_retail_sessions_status_idx ON %I.retail_sessions (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_retail_sessions_cashier_id_idx ON %I.retail_sessions (cashier_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_retail_sessions_opened_at_idx ON %I.retail_sessions (opened_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- retail_session_orders (vincula ventas retail con su sesiÃ³n de turno)
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS retail_session_orders (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL REFERENCES %I.retail_sessions(id) ON DELETE CASCADE,
        order_id   UUID NOT NULL REFERENCES %I.pos_orders(id)      ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_session_order UNIQUE (order_id)
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_retail_session_orders_session_id_idx ON %I.retail_session_orders (session_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â”€â”€â”€ REPORTS (sin FK) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  IF ANY_MATCH(v_modules, 'reports') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS reports_cache (
        id           SERIAL PRIMARY KEY,
        report_type  VARCHAR(100) NOT NULL,
        params       JSONB,
        payload      JSONB,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at   TIMESTAMP
      )', p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_reports_cache_report_type_generated_at_idx ON %I.reports_cache (report_type, generated_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 7. Datos iniciales
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  EXECUTE format(
    'INSERT INTO %I.business_profile (id, legal_name) VALUES (1, %L) ON CONFLICT DO NOTHING',
    p_schema_name, v_request.business_name);

  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  -- 8. Resultado
  -- â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  v_result := v_result || jsonb_build_object(
    'success',         true,
    'schema_name',     p_schema_name,
    'tables_created',  v_table_count,
    'modules_enabled', v_modules,
    'provisioned_at',  CURRENT_TIMESTAMP
  );
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM,
    'hint',    SQLSTATE
  );
END;
$$ LANGUAGE plpgsql;



