-- ============================================================================
-- Helper: debe definirse ANTES de la función principal (runtime resolution)
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

  -- ══════════════════════════════════════════════════════════════════════════
  -- 1. Validar solicitud aprobada
  -- ══════════════════════════════════════════════════════════════════════════
  SELECT * INTO v_request
  FROM public.business_registration_requests
  WHERE id = p_request_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Request not found or not in approved status');
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 2. Crear schema
  -- ══════════════════════════════════════════════════════════════════════════
  BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema_name);
    v_result := v_result || jsonb_build_object('schema_created', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Schema creation failed: ' || SQLERRM);
  END;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 3. Resolver dependencias entre módulos
  -- ══════════════════════════════════════════════════════════════════════════
  v_modules := p_modules;

  -- purchases requiere suppliers como FK target
  IF ANY_MATCH(v_modules, 'purchases') AND NOT ANY_MATCH(v_modules, 'suppliers') THEN
    v_modules := array_append(v_modules, 'suppliers');
  END IF;

  -- kitchen, tables, delivery, einvoicing y orders requieren pos (pos_orders FK)
  IF (ANY_MATCH(v_modules, 'kitchen')    OR
      ANY_MATCH(v_modules, 'tables')     OR
      ANY_MATCH(v_modules, 'delivery')   OR
      ANY_MATCH(v_modules, 'einvoicing') OR
      ANY_MATCH(v_modules, 'orders'))
     AND NOT ANY_MATCH(v_modules, 'pos') THEN
    v_modules := array_append(v_modules, 'pos');
  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 4. ENUMs del tenant (deben existir antes que las tablas que los usan)
  -- ══════════════════════════════════════════════════════════════════════════
  EXECUTE format('CREATE TYPE %I.order_status   AS ENUM (''draft'',''pending'',''sent'',''completed'',''paid'',''cancelled'')', p_schema_name);
  EXECUTE format('CREATE TYPE %I.payment_status AS ENUM (''pending'',''completed'',''failed'',''refunded'')', p_schema_name);
  EXECUTE format('CREATE TYPE %I.user_role      AS ENUM (''admin'',''manager'',''staff'',''viewer'',''client'')', p_schema_name);

  -- ══════════════════════════════════════════════════════════════════════════
  -- 5. TABLAS CORE — siempre se crean, ordenadas por dependencia
  --    Orden: sin FK primero → luego las que referencian tablas ya creadas
  -- ══════════════════════════════════════════════════════════════════════════

  -- ─ roles (sin FK) ──────────────────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.roles (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(50)  NOT NULL UNIQUE,
      description TEXT,
      permissions JSONB        DEFAULT ''[]''::jsonb,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;

  -- ─ settings (sin FK) ───────────────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.settings (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT,
      data_type   VARCHAR(50),
      description TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;

  -- ─ business_profile (sin FK) ───────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.business_profile (
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

  -- ─ customers (sin FK) ──────────────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.customers (
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
    'CREATE INDEX %I_customers_document_number_idx ON %I.customers (document_number)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX %I_customers_name_idx ON %I.customers (name)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- ─ categories (sin FK) ─────────────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.categories (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(250),
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  EXECUTE format(
    'CREATE INDEX %I_categories_name_idx ON %I.categories (name)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- ─ users (FK → roles) ──────────────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.users (
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

  -- ─ products (FK → categories) ──────────────────────────────────────────────
  EXECUTE format('
    CREATE TABLE %I.products (
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
    'CREATE INDEX %I_products_category_id_idx ON %I.products (category_id)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX %I_products_is_active_idx ON %I.products (is_active)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- ─ pos_discounts (descuentos avanzados: cupones, horarios, producto) ───────
  EXECUTE format('
    CREATE TABLE %I.pos_discounts (
      id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name           VARCHAR(100) NOT NULL,
      type           VARCHAR(20)  NOT NULL, -- percentage | fixed
      value          NUMERIC(10,2) NOT NULL,
      applies_to     VARCHAR(20) DEFAULT ''order'', -- order | product
      product_id     UUID REFERENCES %I.products(id) ON DELETE SET NULL,
      min_amount     NUMERIC(12,2) DEFAULT 0,
      -- cupones
      code           VARCHAR(50),
      usage_limit    INT,
      used_count     INT DEFAULT 0,
      -- reglas de tiempo
      days_of_week   INT[], -- 0=domingo ... 6=sábado
      start_time     TIME,
      end_time       TIME,
      start_date     TIMESTAMP,
      end_date       TIMESTAMP,
      is_active      BOOLEAN DEFAULT true,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name, p_schema_name);

  v_table_count := v_table_count + 1;

  EXECUTE format(
  'CREATE INDEX %I_pos_discounts_is_active_idx ON %I.pos_discounts (is_active)',
    p_schema_name, p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX %I_pos_discounts_code_idx ON %I.pos_discounts (code)',
    p_schema_name, p_schema_name
  );

  EXECUTE format(
    'CREATE INDEX %I_pos_discounts_product_id_idx ON %I.pos_discounts (product_id)',
    p_schema_name, p_schema_name
  );

  -- ─ pos_order_discounts (historial de descuentos aplicados) ────────────────
  EXECUTE format('
    CREATE TABLE %I.pos_order_discounts (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id      UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
      discount_id   UUID,
      discount_name VARCHAR(100),
      amount        NUMERIC(12,2) NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name, p_schema_name);

  EXECUTE format(
    'CREATE INDEX %I_pos_order_discounts_order_id_idx ON %I.pos_order_discounts (order_id)',
    p_schema_name, p_schema_name
  );

  v_table_count := v_table_count + 1;

  -- ─ audit_logs (user_id sin FK — intencional para no bloquear borrado) ───────
  EXECUTE format('
    CREATE TABLE %I.audit_logs (
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
    'CREATE INDEX %I_audit_logs_table_name_action_idx ON %I.audit_logs (table_name, action)',
    p_schema_name, p_schema_name);
  EXECUTE format(
    'CREATE INDEX %I_audit_logs_created_at_desc_idx ON %I.audit_logs (created_at DESC)',
    p_schema_name, p_schema_name);
  v_table_count := v_table_count + 1;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 6. TABLAS POR MÓDULO — ordenadas: sin FK → luego sus dependientes
  -- ══════════════════════════════════════════════════════════════════════════

  -- ─── POS ────────────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'pos') THEN

    -- pos_orders (FK → customers, users)
    EXECUTE format('
      CREATE TABLE %I.pos_orders (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number  VARCHAR(20)     NOT NULL UNIQUE,
        order_type    VARCHAR(20)     NOT NULL DEFAULT ''dine_in'',
        status        %I.order_status NOT NULL DEFAULT ''pending'',
        customer_id   UUID REFERENCES %I.customers(id) ON DELETE SET NULL,
        customer_name VARCHAR(255),
        mesa_numero   INT,
        subtotal      NUMERIC(12,2)   NOT NULL DEFAULT 0,
        tax_rate      NUMERIC(5,2)    NOT NULL DEFAULT 15,
        tax_amount    NUMERIC(12,2)   NOT NULL DEFAULT 0,
        total         NUMERIC(12,2)   NOT NULL DEFAULT 0,
        notes         TEXT,
        created_by    UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_pos_orders_status_idx ON %I.pos_orders (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_pos_orders_order_type_idx ON %I.pos_orders (order_type)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_pos_orders_created_at_desc_idx ON %I.pos_orders (created_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_order_items (FK → pos_orders, products)
    EXECUTE format('
      CREATE TABLE %I.pos_order_items (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id     UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        product_id   UUID REFERENCES %I.products(id) ON DELETE RESTRICT,
        product_name VARCHAR(255)  NOT NULL,
        product_code VARCHAR(50),
        quantity     INT           NOT NULL DEFAULT 1,
        unit_price   NUMERIC(12,2) NOT NULL,
        line_total   NUMERIC(12,2) NOT NULL,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_pos_order_items_order_id_idx ON %I.pos_order_items (order_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_payments (FK → pos_orders)
    EXECUTE format('
      CREATE TABLE %I.pos_payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE RESTRICT,
        payment_method   VARCHAR(50)      NOT NULL DEFAULT ''cash'',
        amount           NUMERIC(12,2)    NOT NULL,
        reference_number VARCHAR(100),
        status           %I.payment_status NOT NULL DEFAULT ''pending'',
        paid_at          TIMESTAMP,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_pos_payments_order_id_idx ON %I.pos_payments (order_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- pos_receipts (FK → pos_orders)
    EXECUTE format('
      CREATE TABLE %I.pos_receipts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id       UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE CASCADE,
        receipt_number VARCHAR(50) UNIQUE,
        subtotal       NUMERIC(12,2),
        tax_amount     NUMERIC(12,2),
        total          NUMERIC(12,2),
        issued_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- cash_register_closing (sin FK)
    EXECUTE format('
      CREATE TABLE %I.cash_register_closing (
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
    EXECUTE format(
      'CREATE INDEX %I_cash_register_closing_closing_date_idx ON %I.cash_register_closing (closing_date)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_cash_register_closing_created_at_desc_idx ON %I.cash_register_closing (created_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- cash_register_openings (apertura de caja con denominaciones)
    EXECUTE format('
      CREATE TABLE %I.cash_register_openings (
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
    EXECUTE format(
      'CREATE INDEX %I_cash_register_openings_date_idx ON %I.cash_register_openings (date DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── INVENTORY ──────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'inventory') THEN

    -- inventory_physical (sin FK)
    EXECUTE format('
      CREATE TABLE %I.inventory_physical (
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
      'CREATE INDEX %I_inventory_physical_status_idx ON %I.inventory_physical (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_inventory_physical_created_at_desc_idx ON %I.inventory_physical (created_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_physical_categories (FK → inventory_physical, categories)
    EXECUTE format('
      CREATE TABLE %I.inventory_physical_categories (
        id           SERIAL PRIMARY KEY,
        inventory_id INT NOT NULL REFERENCES %I.inventory_physical(id) ON DELETE CASCADE,
        category_id  INT NOT NULL REFERENCES %I.categories(id) ON DELETE CASCADE
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_inventory_physical_categories_inventory_idx ON %I.inventory_physical_categories (inventory_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_physical_items (FK → inventory_physical, products)
    EXECUTE format('
      CREATE TABLE %I.inventory_physical_items (
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
      'CREATE INDEX %I_inventory_physical_items_inventory_idx ON %I.inventory_physical_items (inventory_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_inventory_physical_items_product_idx ON %I.inventory_physical_items (product_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- inventory_movements (FK → products)
    EXECUTE format('
      CREATE TABLE %I.inventory_movements (
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
      'CREATE INDEX %I_inventory_movements_product_idx ON %I.inventory_movements (product_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_inventory_movements_type_idx ON %I.inventory_movements (type)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- recipes (FK → categories)
    EXECUTE format('
      CREATE TABLE %I.recipes (
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

    -- recipe_ingredients (FK → recipes, products)
    EXECUTE format('
      CREATE TABLE %I.recipe_ingredients (
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
      'CREATE INDEX %I_recipe_ingredients_recipe_idx ON %I.recipe_ingredients (recipe_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── SUPPLIERS ──────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'suppliers') THEN

    -- suppliers (sin FK)
    EXECUTE format('
      CREATE TABLE %I.suppliers (
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

  -- ─── PURCHASES ──────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'purchases') THEN

    -- purchase_orders (FK → suppliers)
    EXECUTE format('
      CREATE TABLE %I.purchase_orders (
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

    -- purchase_order_items (FK → purchase_orders, products)
    EXECUTE format('
      CREATE TABLE %I.purchase_order_items (
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

  -- ─── ACCOUNTING ─────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'accounting') THEN

    -- expenses (sin FK relevante)
    EXECUTE format('
      CREATE TABLE %I.expenses (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date        DATE          NOT NULL,
        category    VARCHAR(100),
        description TEXT,
        amount      NUMERIC(12,2) NOT NULL,
        reference   VARCHAR(100),
        created_by  UUID,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    -- incomes (sin FK relevante)
    EXECUTE format('
      CREATE TABLE %I.incomes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        date        DATE          NOT NULL,
        source      VARCHAR(100),
        description TEXT,
        amount      NUMERIC(12,2) NOT NULL,
        reference   VARCHAR(100),
        created_by  UUID,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── TABLES — mesas del restaurante (FK → pos_orders) ───────────────────
  IF ANY_MATCH(v_modules, 'tables') THEN

    EXECUTE format('
      CREATE TABLE %I.dining_tables (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        table_number     INT NOT NULL UNIQUE,
        seats            INT DEFAULT 4,
        location         VARCHAR(100),
        status           VARCHAR(20) DEFAULT ''available'',
        current_order_id UUID REFERENCES %I.pos_orders(id) ON DELETE SET NULL,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_dining_tables_status_idx ON %I.dining_tables (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── KITCHEN (FK → pos_orders) ──────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'kitchen') THEN

    EXECUTE format('
      CREATE TABLE %I.kitchen_tasks (
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
      'CREATE INDEX %I_kitchen_tasks_status_idx ON %I.kitchen_tasks (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── RESERVATIONS (FK → customers) ──────────────────────────────────────
  IF ANY_MATCH(v_modules, 'reservations') THEN

    EXECUTE format('
      CREATE TABLE %I.reservations (
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
      'CREATE INDEX %I_reservations_reservation_time_idx ON %I.reservations (reservation_time)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_reservations_status_idx ON %I.reservations (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── DELIVERY (FK → pos_orders, customers, users) ───────────────────────
  IF ANY_MATCH(v_modules, 'delivery') THEN

    EXECUTE format('
      CREATE TABLE %I.delivery_orders (
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
      'CREATE INDEX %I_delivery_orders_status_idx ON %I.delivery_orders (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── ROUTES (FK → users) ────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'routes') THEN

    EXECUTE format('
      CREATE TABLE %I.delivery_routes (
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

  -- ─── TRACKING (FK → users) ──────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'tracking') THEN

    EXECUTE format('
      CREATE TABLE %I.tracking_gps (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        driver_id  UUID REFERENCES %I.users(id) ON DELETE CASCADE,
        latitude   NUMERIC(10,7) NOT NULL,
        longitude  NUMERIC(10,7) NOT NULL,
        speed_kmh  NUMERIC(6,2),
        tracked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_tracking_gps_driver_id_tracked_at_idx ON %I.tracking_gps (driver_id, tracked_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── APPOINTMENTS ───────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'appointments') THEN

    -- services (sin FK)
    EXECUTE format('
      CREATE TABLE %I.services (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name             VARCHAR(255)  NOT NULL,
        description      TEXT,
        price            NUMERIC(12,2) NOT NULL,
        duration_minutes INT           DEFAULT 30,
        is_active        BOOLEAN       DEFAULT true,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    -- appointments (FK → services, customers)
    EXECUTE format('
      CREATE TABLE %I.appointments (
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
      'CREATE INDEX %I_appointments_scheduled_for_idx ON %I.appointments (scheduled_for)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_appointments_status_idx ON %I.appointments (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── EMPLOYEES ──────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'employees') THEN

    -- employees (FK → users)
    EXECUTE format('
      CREATE TABLE %I.employees (
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

    -- worked_hours (FK → employees)
    EXECUTE format('
      CREATE TABLE %I.worked_hours (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES %I.employees(id) ON DELETE CASCADE,
        worked_date DATE         NOT NULL,
        hours       NUMERIC(6,2) NOT NULL DEFAULT 0,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_worked_hours_employee_id_worked_date_idx ON %I.worked_hours (employee_id, worked_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- attendance_records (FK → employees)
    EXECUTE format('
      CREATE TABLE %I.attendance_records (
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
      'CREATE INDEX %I_attendance_records_employee_id_event_time_idx ON %I.attendance_records (employee_id, event_time)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_schedules (FK → employees)
    EXECUTE format('
      CREATE TABLE %I.employee_schedules (
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
      'CREATE INDEX %I_employee_schedules_employee_id_schedule_date_idx ON %I.employee_schedules (employee_id, schedule_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_leaves (FK → employees)
    EXECUTE format('
      CREATE TABLE %I.employee_leaves (
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
      'CREATE INDEX %I_employee_leaves_employee_id_leave_type_start_date_idx ON %I.employee_leaves (employee_id, leave_type, start_date)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_payrolls (FK → employees)
    EXECUTE format('
      CREATE TABLE %I.employee_payrolls (
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
      'CREATE INDEX %I_employee_payrolls_employee_id_period_idx ON %I.employee_payrolls (employee_id, period_start)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- employee_payroll_details (FK → employee_payrolls)
    EXECUTE format('
      CREATE TABLE %I.employee_payroll_details (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        payroll_id UUID NOT NULL REFERENCES %I.employee_payrolls(id) ON DELETE CASCADE,
        concept    VARCHAR(100)  NOT NULL,
        type       VARCHAR(20)   NOT NULL,
        amount     NUMERIC(12,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_employee_payroll_details_payroll_id_idx ON %I.employee_payroll_details (payroll_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── CRM (FK → customers, users) ────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'crm') THEN

    EXECUTE format('
      CREATE TABLE %I.crm_interactions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id UUID NOT NULL REFERENCES %I.customers(id) ON DELETE CASCADE,
        type        VARCHAR(50) NOT NULL,
        subject     VARCHAR(255),
        description TEXT,
        created_by  UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_crm_interactions_customer_id_idx ON %I.crm_interactions (customer_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── LOYALTY (FK → customers) ───────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'loyalty') THEN

    EXECUTE format('
      CREATE TABLE %I.loyalty_points (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id  UUID NOT NULL REFERENCES %I.customers(id) ON DELETE CASCADE,
        points       INT  NOT NULL DEFAULT 0,
        type         VARCHAR(20) NOT NULL,
        reference_id UUID,
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_loyalty_points_customer_id_idx ON %I.loyalty_points (customer_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── QUEUE (FK → customers) ─────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'queue') THEN

    EXECUTE format('
      CREATE TABLE %I.service_queue (
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
      'CREATE INDEX %I_service_queue_status_created_at_idx ON %I.service_queue (status, created_at)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── ECOMMERCE ──────────────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'ecommerce') THEN

    -- ecommerce_orders (FK → customers)
    EXECUTE format('
      CREATE TABLE %I.ecommerce_orders (
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
      'CREATE INDEX %I_ecommerce_orders_status_idx ON %I.ecommerce_orders (status)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- ecommerce_order_items (FK → ecommerce_orders, products)
    EXECUTE format('
      CREATE TABLE %I.ecommerce_order_items (
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

  -- ─── NOTIFICATIONS (FK → users) ─────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'notifications') THEN

    EXECUTE format('
      CREATE TABLE %I.notifications (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID REFERENCES %I.users(id) ON DELETE CASCADE,
        type       VARCHAR(50) NOT NULL,
        title      VARCHAR(255),
        content    TEXT,
        is_read    BOOLEAN   DEFAULT false,
        sent_at    TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_notifications_user_id_is_read_idx ON %I.notifications (user_id, is_read)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── EINVOICING (SRI Ecuador) ────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'einvoicing') THEN

    -- einvoice_config (sin FK; INT id + CHECK garantiza una sola fila)
    EXECUTE format('
      CREATE TABLE %I.einvoice_config (
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

    -- einvoices (FKs sueltos — no bloquear si pos/customers no están activos)
    EXECUTE format('
      CREATE TABLE %I.einvoices (
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
      'CREATE INDEX %I_einvoices_order_id_idx ON %I.einvoices (order_id)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_einvoices_status_idx ON %I.einvoices (status)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_einvoices_access_key_idx ON %I.einvoices (access_key)',
      p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_einvoices_created_at_desc_idx ON %I.einvoices (created_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ─── REPORTS (sin FK) ───────────────────────────────────────────────────
  IF ANY_MATCH(v_modules, 'reports') THEN

    EXECUTE format('
      CREATE TABLE %I.reports_cache (
        id           SERIAL PRIMARY KEY,
        report_type  VARCHAR(100) NOT NULL,
        params       JSONB,
        payload      JSONB,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at   TIMESTAMP
      )', p_schema_name);
    EXECUTE format(
      'CREATE INDEX %I_reports_cache_report_type_generated_at_idx ON %I.reports_cache (report_type, generated_at DESC)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;

  -- ══════════════════════════════════════════════════════════════════════════
  -- 7. Datos iniciales
  -- ══════════════════════════════════════════════════════════════════════════
  EXECUTE format(
    'INSERT INTO %I.business_profile (id, legal_name) VALUES (1, %L) ON CONFLICT DO NOTHING',
    p_schema_name, v_request.business_name);

  -- ══════════════════════════════════════════════════════════════════════════
  -- 8. Resultado
  -- ══════════════════════════════════════════════════════════════════════════
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
