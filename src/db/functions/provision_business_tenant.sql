-- ============================================================================
-- Helper: debe definirse ANTES de la funcion principal (runtime resolution)
-- ============================================================================
CREATE OR REPLACE FUNCTION ANY_MATCH(arr VARCHAR[], val VARCHAR)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN val = ANY(arr);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- IDON PLATAFORM: PROVISION BUSINESS TENANT
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
  -- ═══════════════════════════════════════════════════════════════════════════════
  -- 1. VALIDAR SOLICITUD APROBADA
  -- ═══════════════════════════════════════════════════════════════════════════════
  --
  --   Propósito:
  --   Verificar que la solicitud de registro del negocio existe y ha sido
  --   aprobada por un administrador (status = 'approved'). Esta es la puerta
  --   de entrada al proceso de provisionamiento: solo se crea un tenant para
  --   negocios que han pasado el flujo de aprobación.
  --
  --   Tabla fuente:
  --   public.business_registration_requests — contiene todas las solicitudes 
  --   de registro, con su estado, datos del negocio y del propietario.
  --
  --   Lógica:
  --   1. Se busca la solicitud por su UUID (p_request_id).
  --   2. Se exige que el campo 'status' sea exactamente 'approved'.
  --   3. Si no se encuentra o no está aprobada, la función retorna un JSON
  --      de error y aborta (no se crea el esquema ni las tablas).
  --
  --   Seguridad:
  --   Evita que se provisionen negocios no verificados o en estado
  --   'pending' / 'rejected'. El flujo correcto es:
  --      Solicitud (pending) → Revisión por admin → Aprobación → Provisionamiento.
  --
  --   Datos que se recuperan:
  --   Toda la fila se almacena en la variable v_request (RECORD). De ella se
  --   extraerá más adelante el nombre comercial (business_name) para insertarlo
  --   en business_profile.
  --
  --   Si falla:
  --   La función termina inmediatamente devolviendo:
  --     { "success": false, "error": "Request not found or not in approved status" }
  --   y no se realiza ningún cambio en la base de datos (transacción no iniciada aún).
  --
  -- ═══════════════════════════════════════════════════════════════════════════════

  SELECT * INTO v_request
  FROM public.business_registration_requests
  WHERE id = p_request_id AND status = 'approved';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Request not found or not in approved status');
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- 2. CREAR SCHEMA
  -- ═══════════════════════════════════════════════════════════════════════════════
  --
  --   Propósito:
  --   Crear un esquema PostgreSQL con el nombre proporcionado (p_schema_name)
  --   que servirá como contenedor aislado para todas las tablas, funciones,
  --   tipos y datos del negocio (tenant). Es el primer paso físico para
  --   separar los datos de cada cliente en la arquitectura multi-tenant.
  --
  --   Detalle técnico:
  --   Se usa "CREATE SCHEMA IF NOT EXISTS" con el identificador escapado
  --   mediante format('%I', p_schema_name) para prevenir inyección SQL y
  --   garantizar que el nombre sea válido.
  --
  --   Manejo de errores:
  --   La operación se ejecuta dentro de un bloque EXCEPTION para capturar
  --   cualquier fallo (ej: nombre de esquema inválido, permisos insuficientes).
  --   Si ocurre un error, la función retorna un JSON de error con el mensaje
  --   SQLERRM y aborta la ejecución. El resto de pasos no se ejecutarán.
  --
  --   Registro en resultado:
  --   Si la creación es exitosa, se agrega la clave "schema_created": true
  --   al objeto JSON v_result, que se devolverá al final.
  --
  --   Nota sobre idempotencia:
  --   "IF NOT EXISTS" hace que la función sea segura para ejecutar varias veces:
  --   si el esquema ya existe, no se produce error y se continúa con el
  --   siguiente paso. Esto es útil en entornos de desarrollo o si se
  --   reprovisiona un tenant.
  --
  -- ═══════════════════════════════════════════════════════════════════════════════

  BEGIN
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', p_schema_name);
    v_result := v_result || jsonb_build_object('schema_created', true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Schema creation failed: ' || SQLERRM);
  END;

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- 3. RESOLVER DEPENDENCIAS ENTRE MÓDULOS
  -- ═══════════════════════════════════════════════════════════════════════════════
  --
  --   Propósito:
  --   Asegurar que la lista de módulos solicitados (p_modules) incluya todos
  --   los módulos necesarios para que las claves foráneas (FOREIGN KEY) no
  --   fallen al momento de crear las tablas. El negocio puede solicitar solo
  --   el módulo "purchases", pero el sistema automáticamente agrega "suppliers"
  --   porque es un requisito técnico.
  --
  --   Lógica de dependencias:
  --   1. purchases → requiere suppliers (FK a suppliers.id)
  --      Si 'purchases' está en la lista pero 'suppliers' no, se agrega.
  --
  --   2. kitchen, tables, delivery, einvoicing, orders, retail → requieren pos
  --      Todos estos módulos tienen una clave foránea hacia pos_orders.id.
  --      Si alguno de ellos está presente y 'pos' no, se agrega 'pos'.
  --
  --   Variable de trabajo:
  --   v_modules es una copia mutable de p_modules. Sobre ella se aplican
  --   las adiciones necesarias antes de continuar con la creación de tablas.
  --
  --   Función auxiliar:
  --   ANY_MATCH(arr, val) — devuelve TRUE si 'val' existe en el array 'arr'.
  --   Es un helper PL/pgSQL definido al inicio del archivo para simplificar
  --   las condiciones IF ... THEN.
  --
  --   Idempotencia y orden:
  --   Este paso es puramente de pre-procesamiento. No modifica la base de
  --   datos, solo ajusta la lista de módulos. La función es idempotente:
  --   ejecutarla varias veces con los mismos argumentos produce el mismo
  --   v_modules final.
  --
  --   Ejemplo práctico:
  --   Si se solicita p_modules = ['pos', 'purchases']:
  --     - 'purchases' está → se verifica 'suppliers' → se agrega
  --     - Resultado final: ['pos', 'purchases', 'suppliers']
  --
  --   Si se solicita p_modules = ['kitchen']:
  --     - 'kitchen' está → 'pos' no está → se agrega 'pos'
  --     - Resultado final: ['kitchen', 'pos']
  --
  -- ═══════════════════════════════════════════════════════════════════════════════

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


  -- accounting requiere einvoicing (facturación electrónica) para contabilidad completa
  IF ANY_MATCH(v_modules, 'accounting') AND NOT ANY_MATCH(v_modules, 'einvoicing') THEN
    v_modules := array_append(v_modules, 'einvoicing');
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- 4. ENUMS DEL TENANT
  -- ═══════════════════════════════════════════════════════════════════════════════
  --
  --    Propósito: Crear tipos ENUM para estandarizar valores como estados de
  --    órdenes, pagos y roles de usuario dentro del esquema del tenant.
  --
  --    Nota: Se usa EXCEPTION WHEN duplicate_object THEN NULL; para que la
  --    función sea idempotente (no falle si el ENUM ya existe).
  --
  -- ═══════════════════════════════════════════════════════════════════════════════
    
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

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- 5. TABLAS CORE (siempre se crean)
  -- ═══════════════════════════════════════════════════════════════════════════════
  --
  --    Propósito: Crear las tablas mínimas que todo negocio necesita, sin
  --    importar qué módulos tenga activos:
  --      roles, settings, business_profile, customers, categories, users,
  --      products, audit_logs
  --
  --    Orden: Las tablas sin FK se crean primero, luego las que dependen de ellas.
  --    Ej: roles → users (FK a roles.id)
  --        categories → products (FK a categories.id)
  --
  -- ═══════════════════════════════════════════════════════════════════════════════

  -- ── roles (sin FK) ────── Almacena roles personalizados con permisos en JSONB.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.roles (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(50)  NOT NULL UNIQUE,
      description TEXT,
      permissions JSONB        DEFAULT ''[]''::jsonb,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;


-- ── users (FK → roles) ────── Usuarios del negocio con credenciales y rol asociado.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.users (
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


  -- ── settings (sin FK) -───── Configuración general del negocio en formato clave-valor.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.settings (
      key         VARCHAR(100) PRIMARY KEY,
      value       TEXT,
      data_type   VARCHAR(50),
      description TEXT,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )', p_schema_name);
  v_table_count := v_table_count + 1;


  -- ── business_profile (sin FK) ── Datos legales y fiscales del negocio (solo una fila).
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.business_profile (
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


  -- ── customers (sin FK) ────── Clientes del negocio con nombre, email, teléfono y documento.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.customers (
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


  -- ── categories (sin FK) ──── Categorías de productos para organizar el catálogo.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.categories (
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


  -- ── products (FK → categories) ── Productos: código, nombre, precios, stock e impuestos.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.products (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code          VARCHAR(50)   NOT NULL UNIQUE,
      name          VARCHAR(255)  NOT NULL,
      description   TEXT,
      category_id   INT REFERENCES %I.categories(id) ON DELETE SET NULL,
      unit_cost     NUMERIC(12,2) DEFAULT 0,
      selling_price NUMERIC(12,2) NOT NULL,
      tax_rate      NUMERIC(5,2)  DEFAULT 0,
      is_taxable    NUMERIC(5,2)  DEFAULT 0 NOT NULL,
      is_active     BOOLEAN       DEFAULT true,
      sku           VARCHAR(100),
      barcode       VARCHAR(100),
      stock         INT DEFAULT 0,
      min_stock     INT DEFAULT 0,
      product_type  VARCHAR(20)  DEFAULT ''COMMERCIAL'' NOT NULL,
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


  
  -- ── audit_logs (user_id sin FK) ── Registro de auditoría de todas las acciones del sistema.
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.audit_logs (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO POS
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'pos') THEN

    --- ── pos_daily_order_counter ── Para obtener el siguiente numero de orden.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.daily_order_counter (
        id SERIAL PRIMARY KEY,
        order_date DATE NOT NULL UNIQUE,
        last_number INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil''),
        updated_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'')
      )', p_schema_name);
    v_table_count := v_table_count + 1;

    EXECUTE format('
      CREATE INDEX IF NOT EXISTS %I_daily_order_counter_date_idx 
      ON %I.daily_order_counter (order_date DESC)',
      p_schema_name, p_schema_name);

    -- Función auxiliar para updated_at (si ya existe no importa, se reemplaza)
    EXECUTE format('
      CREATE OR REPLACE FUNCTION %I.update_updated_at_column()
      RETURNS TRIGGER LANGUAGE plpgsql AS $func$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'';
        RETURN NEW;
      END;
      $func$', p_schema_name);

    -- Trigger
    EXECUTE format('
      DROP TRIGGER IF EXISTS update_daily_order_counter_updated_at ON %I.daily_order_counter', p_schema_name);

    EXECUTE format('
      CREATE TRIGGER update_daily_order_counter_updated_at
      BEFORE UPDATE ON %I.daily_order_counter
      FOR EACH ROW
      EXECUTE FUNCTION %I.update_updated_at_column()',
      p_schema_name, p_schema_name);

    -- ========================================================================
    -- FUNCION PARA OBTENER EL SIGUIENTE NUMERO DE ORDEN (CON HORA ECUADOR)
    -- ========================================================================
    EXECUTE format('
      CREATE OR REPLACE FUNCTION %I.get_next_order_number()
      RETURNS INTEGER LANGUAGE plpgsql AS $func$
      DECLARE
        v_number INTEGER;
        v_today DATE;
      BEGIN
        v_today := (CURRENT_TIMESTAMP AT TIME ZONE ''America/Guayaquil'')::DATE;
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



    -- ── pos_discounts (FK → products, categories, users) ── Descuentos configurables por tipo y condiciones.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.pos_discounts (
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


    -- Indices para pos_discounts
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_type_idx ON %I.pos_discounts (type)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_is_active_idx ON %I.pos_discounts (is_active)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_code_idx ON %I.pos_discounts (code)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_product_id_idx ON %I.pos_discounts (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_category_id_idx ON %I.pos_discounts (category_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_dates_idx ON %I.pos_discounts (start_date, end_date)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_priority_idx ON %I.pos_discounts (priority DESC)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_pos_discounts_days_of_week_idx ON %I.pos_discounts USING GIN (days_of_week)', p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;


    -- ── pos_orders (FK → customers, users, pos_discounts) ── Órdenes de venta con estado, totales y descuentos.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.pos_orders (
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


    -- ── pos_order_items (FK → pos_orders, products) ── Ítems de la orden con precio congelado al momento de la venta.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.pos_order_items (
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


    -- ── pos_payments (FK → pos_orders) ── Pagos asociados a una orden por método y monto.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.pos_payments (
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


    -- ── pos_order_discounts (FK → pos_orders, pos_discounts) ── Historial de descuentos aplicados a cada orden.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.pos_order_discounts (
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


    -- ── coupons (FK → pos_discounts, users) ── Cupones específicos con código único y límite de usos.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.coupons (
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


    -- ── cash_register_openings (sin FK) ── Apertura de caja con conteo de monedas y billetes.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.cash_register_openings (
        id             SERIAL PRIMARY KEY,
        user_id        VARCHAR(100)  NOT NULL,
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



    -- ── cash_register_closing (sin FK) ── Cierre de caja con diferencias por método de pago.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.cash_register_closing (
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



    -- ── incomes_extras (sin FK) ── Ingresos extras (no ventas) que afectan el cuadre de caja.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.incomes_extras (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO INVENTORY
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'inventory') THEN


    -- ── inventory_physical (FK → public.users, tenant.users) ── Cabecera de inventario físico con estado y conteo de productos.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.inventory_physical (
        id                  SERIAL PRIMARY KEY,
        name                VARCHAR(150),
        status              VARCHAR(20) NOT NULL DEFAULT ''open'',
        started_date        DATE        NOT NULL DEFAULT CURRENT_DATE,
        started_time        TIME        NOT NULL DEFAULT CURRENT_TIME,
        closed_date         DATE,
        closed_time         TIME,
        total_items         INT DEFAULT 0,
        counted_items       INT DEFAULT 0,
        pending_items       INT DEFAULT 0,
        notes               TEXT,
        created_by_global   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
        created_by_tenant   UUID        REFERENCES %I.users(id) ON DELETE SET NULL,
        closed_by_global    UUID        REFERENCES public.users(id) ON DELETE SET NULL,
        closed_by_tenant    UUID        REFERENCES %I.users(id) ON DELETE SET NULL,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_status_idx ON %I.inventory_physical (status)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_created_at_desc_idx ON %I.inventory_physical (created_at DESC)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_created_by_global_idx ON %I.inventory_physical (created_by_global)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_created_by_tenant_idx ON %I.inventory_physical (created_by_tenant)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_closed_by_global_idx ON %I.inventory_physical (closed_by_global)',
      p_schema_name, p_schema_name);

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_closed_by_tenant_idx ON %I.inventory_physical (closed_by_tenant)',
      p_schema_name, p_schema_name);

    v_table_count := v_table_count + 1;



    -- ── inventory_physical_categories (FK → inventory_physical, categories) ── Relación entre inventario y categorías incluidas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.inventory_physical_categories (
        id           SERIAL PRIMARY KEY,
        inventory_id INT NOT NULL REFERENCES %I.inventory_physical(id) ON DELETE CASCADE,
        category_id  INT NOT NULL REFERENCES %I.categories(id) ON DELETE CASCADE
      )', p_schema_name, p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_inventory_physical_categories_inventory_idx ON %I.inventory_physical_categories (inventory_id)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── inventory_physical_items (FK → inventory_physical, products) ── Ítems del inventario con stock sistema y contado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.inventory_physical_items (
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



    -- ── inventory_movements (FK → products) ── Movimientos de inventario con control de aplicación.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.inventory_movements (
        id           SERIAL PRIMARY KEY,
        product_id   UUID NOT NULL REFERENCES %I.products(id) ON DELETE CASCADE,
        type         VARCHAR(20) NOT NULL,
        quantity     INT         NOT NULL,
        unit_cost    NUMERIC(12,2),
        notes        TEXT,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        applied      BOOLEAN DEFAULT false,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reference_id TEXT
      )', p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_inventory_movements_product_idx ON %I.inventory_movements (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_inventory_movements_type_idx ON %I.inventory_movements (type)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_inventory_movements_applied_idx ON %I.inventory_movements (applied)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_inventory_movements_type_applied_idx ON %I.inventory_movements (type, applied)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── recipes (FK → products) ── Recetas vinculadas a un producto (única por producto).
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.recipes (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id  UUID NOT NULL UNIQUE,
        description TEXT,
        yield_qty   NUMERIC(10,2) DEFAULT 1,
        yield_unit  VARCHAR(50)   DEFAULT ''unidad'',
        total_cost  NUMERIC(12,2) DEFAULT 0,
        is_active   BOOLEAN       DEFAULT true,
        created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT recipes_product_fk 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE CASCADE
      )', p_schema_name, p_schema_name);



    -- ── raw_materials (FK → recipes) ── Materias primas (ingredientes) con stock y costo.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.raw_materials (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code          VARCHAR(50) NOT NULL UNIQUE,
        name          VARCHAR(255) NOT NULL,
        description   TEXT,
        unit          VARCHAR(30) NOT NULL,
        stock         NUMERIC(12,3) NOT NULL DEFAULT 0,
        min_stock     NUMERIC(12,3) NOT NULL DEFAULT 0,
        unit_cost     NUMERIC(12,2) NOT NULL DEFAULT 0,
        barcode       VARCHAR(100),
        sku           VARCHAR(100),
        is_active     BOOLEAN DEFAULT true,
        is_composite  BOOLEAN DEFAULT false,
        recipe_id     UUID,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT raw_materials_recipe_fk 
          FOREIGN KEY (recipe_id) 
          REFERENCES %I.recipes(id) ON DELETE SET NULL
      )', p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_materials_recipe_idx ON %I.raw_materials (recipe_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_materials_composite_idx ON %I.raw_materials (is_composite)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_materials_code_idx ON %I.raw_materials (code)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── recipe_ingredients (FK → recipes, raw_materials) ── Ingredientes de receta (materias primas).
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.recipe_ingredients (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        recipe_id         UUID NOT NULL,
        raw_material_id   UUID NOT NULL,
        quantity          NUMERIC(12,3) NOT NULL,
        unit              VARCHAR(30),
        unit_cost         NUMERIC(12,2),
        total_cost        NUMERIC(12,2),
        conversion_factor NUMERIC(12,3) DEFAULT 1,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT recipe_fk 
          FOREIGN KEY (recipe_id) 
          REFERENCES %I.recipes(id) ON DELETE CASCADE,
        CONSTRAINT raw_material_fk 
          FOREIGN KEY (raw_material_id) 
          REFERENCES %I.raw_materials(id) ON DELETE RESTRICT
      )', p_schema_name, p_schema_name, p_schema_name);
    


    -- ── raw_material_movements (FK → raw_materials) ── Movimientos de stock de materias primas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.raw_material_movements (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_material_id UUID NOT NULL,
        movement_type   VARCHAR(20) NOT NULL,
        quantity        NUMERIC(12,3) NOT NULL,
        previous_stock  NUMERIC(12,3),
        current_stock   NUMERIC(12,3),
        reference_type  VARCHAR(30),
        reference_id    UUID,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT raw_material_movements_fk 
          FOREIGN KEY (raw_material_id) 
          REFERENCES %I.raw_materials(id) ON DELETE CASCADE
      )', p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_material_movements_material_idx ON %I.raw_material_movements (raw_material_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_material_movements_type_idx ON %I.raw_material_movements (movement_type)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

  END IF;



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO SUPPLIERS
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'suppliers') THEN

    -- ── suppliers (sin FK) ── Proveedores del negocio con datos de contacto y RUC.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.suppliers (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO PURCHASES
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'purchases') THEN

    -- ── purchase_orders (sin FK) ── Órdenes de compra (comerciales o manufacturadas) con estado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_orders (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_number        VARCHAR(50) UNIQUE NOT NULL,
        order_type          VARCHAR(20) NOT NULL DEFAULT ''COMMERCIAL'',
        status              VARCHAR(20) DEFAULT ''draft'',
        order_date          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expected_at         TIMESTAMP,
        received_at         TIMESTAMP,
        notes               TEXT,
        created_by          UUID,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_orders_order_type_check 
          CHECK (order_type IN (''COMMERCIAL'', ''MANUFACTURED'')),
          
        CONSTRAINT purchase_orders_status_check 
          CHECK (status IN (''draft'', ''pending'', ''approved'', ''received'', ''cancelled''))
      )', p_schema_name);

    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_orders_status_idx ON %I.purchase_orders (status)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_orders_order_date_idx ON %I.purchase_orders (order_date DESC)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_orders_created_at_idx ON %I.purchase_orders (created_at DESC)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_orders_order_type_idx ON %I.purchase_orders (order_type)', p_schema_name, p_schema_name);



    -- ── purchase_order_items_comm (FK → purchase_orders, products) ── Ítems de órdenes comerciales.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_order_items_comm (
        id                  UUID DEFAULT gen_random_uuid(),
        purchase_order_id   UUID NOT NULL,
        product_id          UUID NOT NULL,
        quantity            INTEGER NOT NULL DEFAULT 1,
        received_qty        INTEGER DEFAULT 0,
        notes               TEXT,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_order_items_comm_pkey PRIMARY KEY (id),
        
        CONSTRAINT purchase_order_items_comm_purchase_order_id_fkey 
          FOREIGN KEY (purchase_order_id) 
          REFERENCES %I.purchase_orders(id) ON DELETE CASCADE,
          
        CONSTRAINT purchase_order_items_comm_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_order_items_comm_quantity_check 
          CHECK (quantity > 0)
      )', 
      p_schema_name,  -- purchase_order_items_comm
      p_schema_name,  -- purchase_orders (FK)
      p_schema_name   -- products (FK)
    );

    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_comm_order_id_idx ON %I.purchase_order_items_comm (purchase_order_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_comm_product_id_idx ON %I.purchase_order_items_comm (product_id)', p_schema_name, p_schema_name);



    -- ── purchase_order_items_man (FK → purchase_orders, products, recipes, raw_materials) ── Ítems de órdenes manufacturadas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_order_items_man (
        id                      UUID DEFAULT gen_random_uuid(),
        purchase_order_id       UUID NOT NULL,
        product_id              UUID NOT NULL,
        recipe_id               UUID NOT NULL,
        raw_material_id         UUID NOT NULL,
        quantity                NUMERIC(12, 3) NOT NULL DEFAULT 0,
        required_quantity       NUMERIC(12, 3) NOT NULL DEFAULT 0,
        received_qty            NUMERIC(12, 3) DEFAULT 0,
        notes                   TEXT,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_order_items_man_pkey PRIMARY KEY (id),
        
        CONSTRAINT purchase_order_items_man_purchase_order_id_fkey 
          FOREIGN KEY (purchase_order_id) 
          REFERENCES %I.purchase_orders(id) ON DELETE CASCADE,
          
        CONSTRAINT purchase_order_items_man_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_order_items_man_recipe_id_fkey 
          FOREIGN KEY (recipe_id) 
          REFERENCES %I.recipes(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_order_items_man_raw_material_id_fkey 
          FOREIGN KEY (raw_material_id) 
          REFERENCES %I.raw_materials(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_order_items_man_quantity_check 
          CHECK (quantity >= 0)
      )', 
      p_schema_name,  -- purchase_order_items_man
      p_schema_name,  -- purchase_orders (FK)
      p_schema_name,  -- products (FK)
      p_schema_name,  -- recipes (FK)
      p_schema_name   -- raw_materials (FK)
    );

    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_man_order_id_idx ON %I.purchase_order_items_man (purchase_order_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_man_product_id_idx ON %I.purchase_order_items_man (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_man_recipe_id_idx ON %I.purchase_order_items_man (recipe_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_items_man_raw_material_id_idx ON %I.purchase_order_items_man (raw_material_id)', p_schema_name, p_schema_name);
        

    -- ── purchase_order_item_suppliers (FK → item_comm, item_man, suppliers) ── Asignación de proveedores a cada ítem.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_order_item_suppliers (
        id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        purchase_order_item_id  UUID,
        supplier_id             UUID NOT NULL,
        item_comm_id            UUID,
        item_man_id             UUID,
        quantity                NUMERIC(12,3) NOT NULL,
        unit_cost               NUMERIC(12,2) NOT NULL,
        line_total              NUMERIC(12,2) NOT NULL,
        received_qty            NUMERIC(12,3) DEFAULT 0,
        notes                   TEXT,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_order_item_suppliers_item_comm_id_fkey 
          FOREIGN KEY (item_comm_id) 
          REFERENCES %I.purchase_order_items_comm(id) ON DELETE CASCADE,
        CONSTRAINT purchase_order_item_suppliers_item_man_id_fkey 
          FOREIGN KEY (item_man_id) 
          REFERENCES %I.purchase_order_items_man(id) ON DELETE CASCADE,
        CONSTRAINT purchase_order_item_suppliers_purchase_order_item_id_fkey 
          FOREIGN KEY (purchase_order_item_id) 
          REFERENCES %I.purchase_order_items_comm(id) ON DELETE CASCADE,
        CONSTRAINT purchase_order_item_suppliers_supplier_id_fkey 
          FOREIGN KEY (supplier_id) 
          REFERENCES %I.suppliers(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_order_item_suppliers_quantity_check CHECK (quantity > 0),
        CONSTRAINT purchase_order_item_suppliers_unit_cost_check CHECK (unit_cost >= 0),
        CONSTRAINT purchase_order_item_suppliers_item_check 
          CHECK ((item_comm_id IS NOT NULL AND item_man_id IS NULL) OR (item_comm_id IS NULL AND item_man_id IS NOT NULL)),
        CONSTRAINT purchase_order_item_suppliers_unique 
          UNIQUE (purchase_order_item_id, supplier_id)
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_item_suppliers_item_comm_id_idx ON %I.purchase_order_item_suppliers (item_comm_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_item_suppliers_item_man_id_idx ON %I.purchase_order_item_suppliers (item_man_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_item_suppliers_supplier_id_idx ON %I.purchase_order_item_suppliers (supplier_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_po_item_suppliers_purchase_order_item_id_idx ON %I.purchase_order_item_suppliers (purchase_order_item_id)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;

    -- ── purchase_receipts (FK → purchase_orders, suppliers) ── Recepción de mercadería con información de pago.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_receipts (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_number      VARCHAR(50) UNIQUE NOT NULL,
        purchase_order_id   UUID NOT NULL,
        supplier_id         UUID NOT NULL,
        receipt_date        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status              VARCHAR(20) DEFAULT ''draft'',
        total               NUMERIC(12,2) DEFAULT 0,
        notes               TEXT,
        created_by          UUID,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_method      VARCHAR(50),
        payment_reference   VARCHAR(100),
        paid_at             TIMESTAMP,
        
        CONSTRAINT purchase_receipts_purchase_order_id_fkey 
          FOREIGN KEY (purchase_order_id) 
          REFERENCES %I.purchase_orders(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipts_supplier_id_fkey 
          FOREIGN KEY (supplier_id) 
          REFERENCES %I.suppliers(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipts_status_check 
          CHECK (status IN (''draft'', ''completed'', ''cancelled'', ''paid''))
      )', p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipts_order_id_idx ON %I.purchase_receipts (purchase_order_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipts_supplier_id_idx ON %I.purchase_receipts (supplier_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipts_status_idx ON %I.purchase_receipts (status)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipts_receipt_date_idx ON %I.purchase_receipts (receipt_date DESC)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;


    -- ── purchase_receipt_items (FK → receipt, item_comm, item_man, item_supplier, products) ── Ítems recibidos.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_receipt_items (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id                      UUID NOT NULL,
        purchase_order_item_comm_id     UUID,
        purchase_order_item_man_id      UUID,
        purchase_order_item_supplier_id UUID,
        product_id                      UUID NOT NULL,
        product_name                    VARCHAR(255) NOT NULL,
        quantity                        NUMERIC(12, 3) NOT NULL,
        unit_cost                       NUMERIC(12, 2) NOT NULL,
        line_total                      NUMERIC(12, 2) NOT NULL,
        notes                           TEXT,
        created_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_receipt_items_receipt_id_fkey 
          FOREIGN KEY (receipt_id) 
          REFERENCES %I.purchase_receipts(id) ON DELETE CASCADE,
          
        CONSTRAINT purchase_receipt_items_comm_id_fkey 
          FOREIGN KEY (purchase_order_item_comm_id) 
          REFERENCES %I.purchase_order_items_comm(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_receipt_items_man_id_fkey 
          FOREIGN KEY (purchase_order_item_man_id) 
          REFERENCES %I.purchase_order_items_man(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_receipt_items_supplier_id_fkey 
          FOREIGN KEY (purchase_order_item_supplier_id) 
          REFERENCES %I.purchase_order_item_suppliers(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_receipt_items_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE RESTRICT,
          
        CONSTRAINT purchase_receipt_items_quantity_check 
          CHECK (quantity > 0),
          
        CONSTRAINT purchase_receipt_items_unit_cost_check 
          CHECK (unit_cost >= 0),
          
        -- Check: solo un tipo de item puede estar presente
        CONSTRAINT purchase_receipt_items_item_check 
          CHECK (
            (purchase_order_item_comm_id IS NOT NULL AND purchase_order_item_man_id IS NULL) OR
            (purchase_order_item_comm_id IS NULL AND purchase_order_item_man_id IS NOT NULL)
          )
      )', 
      p_schema_name,  -- purchase_receipt_items
      p_schema_name,  -- purchase_receipts (FK)
      p_schema_name,  -- purchase_order_items_comm (FK)
      p_schema_name,  -- purchase_order_items_man (FK)
      p_schema_name,  -- purchase_order_item_suppliers (FK)
      p_schema_name   -- products (FK)
    );

    v_table_count := v_table_count + 1;

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_receipt_id_idx ON %I.purchase_receipt_items (receipt_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_comm_id_idx ON %I.purchase_receipt_items (purchase_order_item_comm_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_man_id_idx ON %I.purchase_receipt_items (purchase_order_item_man_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_product_id_idx ON %I.purchase_receipt_items (product_id)', p_schema_name, p_schema_name);



    -- ── purchase_receipt_items_comm (FK → receipt, purchase_order_item_comm, product, supplier) ── Ítems recibidos de compras comerciales.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_receipt_items_comm (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id                      UUID NOT NULL,
        purchase_order_item_comm_id     UUID NOT NULL,
        product_id                      UUID NOT NULL,
        product_name                    VARCHAR(255) NOT NULL,
        quantity                        INTEGER NOT NULL,
        unit_cost                       NUMERIC(12,2) NOT NULL,
        line_total                      NUMERIC(12,2) NOT NULL,
        purchase_order_item_supplier_id UUID,
        notes                           TEXT,
        created_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_receipt_items_comm_receipt_id_fkey 
          FOREIGN KEY (receipt_id) 
          REFERENCES %I.purchase_receipts(id) ON DELETE CASCADE,
        CONSTRAINT purchase_receipt_items_comm_purchase_order_item_comm_id_fkey 
          FOREIGN KEY (purchase_order_item_comm_id) 
          REFERENCES %I.purchase_order_items_comm(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_comm_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_comm_purchase_order_item_supplier_i_fkey 
          FOREIGN KEY (purchase_order_item_supplier_id) 
          REFERENCES %I.purchase_order_item_suppliers(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_comm_quantity_check CHECK (quantity > 0),
        CONSTRAINT purchase_receipt_items_comm_unit_cost_check CHECK (unit_cost >= 0)
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_comm_receipt_idx ON %I.purchase_receipt_items_comm (receipt_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_comm_order_item_idx ON %I.purchase_receipt_items_comm (purchase_order_item_comm_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_comm_product_idx ON %I.purchase_receipt_items_comm (product_id)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;


    -- ── purchase_receipt_items_man (FK → receipt, purchase_order_item_man, raw_material, supplier) ── Ítems recibidos de compras manufacturadas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.purchase_receipt_items_man (
        id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id                      UUID NOT NULL,
        purchase_order_item_man_id     UUID NOT NULL,
        raw_material_id                 UUID NOT NULL,
        raw_material_name               VARCHAR(255) NOT NULL,
        quantity                        NUMERIC(12,3) NOT NULL,
        unit_cost                       NUMERIC(12,2) NOT NULL,
        line_total                      NUMERIC(12,2) NOT NULL,
        purchase_order_item_supplier_id UUID,
        notes                           TEXT,
        created_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at                      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT purchase_receipt_items_man_receipt_id_fkey 
          FOREIGN KEY (receipt_id) 
          REFERENCES %I.purchase_receipts(id) ON DELETE CASCADE,
        CONSTRAINT purchase_receipt_items_man_purchase_order_item_man_id_fkey 
          FOREIGN KEY (purchase_order_item_man_id) 
          REFERENCES %I.purchase_order_items_man(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_man_raw_material_id_fkey 
          FOREIGN KEY (raw_material_id) 
          REFERENCES %I.raw_materials(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_man_purchase_order_item_supplier_id_fkey 
          FOREIGN KEY (purchase_order_item_supplier_id) 
          REFERENCES %I.purchase_order_item_suppliers(id) ON DELETE RESTRICT,
        CONSTRAINT purchase_receipt_items_man_quantity_check CHECK (quantity > 0),
        CONSTRAINT purchase_receipt_items_man_unit_cost_check CHECK (unit_cost >= 0)
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_man_receipt_idx ON %I.purchase_receipt_items_man (receipt_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_man_order_item_idx ON %I.purchase_receipt_items_man (purchase_order_item_man_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_purchase_receipt_items_man_raw_material_idx ON %I.purchase_receipt_items_man (raw_material_id)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── raw_material_supplier_history (FK → raw_materials, suppliers) ── Historial de precios de materias primas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.raw_material_supplier_history (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        raw_material_id UUID NOT NULL,
        supplier_id     UUID NOT NULL,
        last_unit_cost  NUMERIC(12,2),
        last_order_date TIMESTAMP,
        total_orders    INTEGER DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT raw_material_supplier_history_raw_material_id_fkey 
          FOREIGN KEY (raw_material_id) 
          REFERENCES %I.raw_materials(id) ON DELETE CASCADE,
        CONSTRAINT raw_material_supplier_history_supplier_id_fkey 
          FOREIGN KEY (supplier_id) 
          REFERENCES %I.suppliers(id) ON DELETE CASCADE,
        CONSTRAINT raw_material_supplier_history_unique 
          UNIQUE (raw_material_id, supplier_id)
      )', p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_material_supplier_history_material_idx ON %I.raw_material_supplier_history (raw_material_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_raw_material_supplier_history_supplier_idx ON %I.raw_material_supplier_history (supplier_id)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── product_supplier_history (FK → products, suppliers) ── Historial de precios y órdenes por proveedor.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.product_supplier_history (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id      UUID NOT NULL,
        supplier_id     UUID NOT NULL,
        last_unit_cost  NUMERIC(12,2),
        last_order_date TIMESTAMP,
        total_orders    INTEGER DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT product_supplier_history_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE CASCADE,
        CONSTRAINT product_supplier_history_supplier_id_fkey 
          FOREIGN KEY (supplier_id) 
          REFERENCES %I.suppliers(id) ON DELETE CASCADE,
        CONSTRAINT product_supplier_history_unique 
          UNIQUE (product_id, supplier_id)
      )', p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_product_supplier_history_product_idx ON %I.product_supplier_history (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_product_supplier_history_supplier_idx ON %I.product_supplier_history (supplier_id)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;
  
    -- ── fifo_lots (FK → products, purchase_receipts, purchase_order_items_comm) ── Control de lotes FIFO por producto.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.fifo_lots (
        id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        product_id                  UUID NOT NULL,
        purchase_receipt_id         UUID,
        purchase_order_item_comm_id UUID,
        quantity                    INTEGER NOT NULL,
        remaining_quantity          INTEGER NOT NULL,
        unit_cost                   NUMERIC(12,2) NOT NULL,
        purchase_date               DATE NOT NULL,
        is_active                   BOOLEAN DEFAULT true,
        created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        
        CONSTRAINT fifo_lots_product_id_fkey 
          FOREIGN KEY (product_id) 
          REFERENCES %I.products(id) ON DELETE CASCADE,
        CONSTRAINT fifo_lots_purchase_receipt_id_fkey 
          FOREIGN KEY (purchase_receipt_id) 
          REFERENCES %I.purchase_receipts(id) ON DELETE SET NULL,
        CONSTRAINT fifo_lots_purchase_order_item_comm_id_fkey 
          FOREIGN KEY (purchase_order_item_comm_id) 
          REFERENCES %I.purchase_order_items_comm(id) ON DELETE SET NULL,
        CONSTRAINT fifo_lots_quantity_check CHECK (quantity > 0),
        CONSTRAINT fifo_lots_remaining_quantity_check CHECK (remaining_quantity >= 0)
      )', p_schema_name, p_schema_name, p_schema_name, p_schema_name);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_fifo_lots_product_idx ON %I.fifo_lots (product_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_fifo_lots_receipt_idx ON %I.fifo_lots (purchase_receipt_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_fifo_lots_purchase_date_idx ON %I.fifo_lots (purchase_date)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_fifo_lots_active_idx ON %I.fifo_lots (is_active)', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;


  END IF;



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO ACCOUNTING
  -- ═══════════════════════════════════════════════════════════════════════════════
  
  IF ANY_MATCH(v_modules, 'accounting') THEN

    -- ── expense_categories (sin FK) ── Categorías de gastos con nombre único y color.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.expense_categories (
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



    -- ── expenses (FK → expense_categories) ── Gastos operativos del negocio.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.expenses (
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



    -- ── income_categories (sin FK) ── Categorías de ingresos con nombre único y color.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.income_categories (
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



    -- ── incomes (FK → income_categories) ── Ingresos del negocio.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.incomes (
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



    -- ── accounts_payable (sin FK) ── Cuentas por pagar a proveedores.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.accounts_payable (
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



    -- ── accounts_payable_payments (FK → accounts_payable) ── Pagos realizados a cuentas por pagar.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.accounts_payable_payments (
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



    -- ── accounts_receivable (sin FK) ── Cuentas por cobrar a clientes.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.accounts_receivable (
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



  --- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO TABLES (requiere POS)
  -- ═══════════════════════════════════════════════════════════════════════════════
  IF ANY_MATCH(v_modules, 'tables') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.dining_tables (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO KITCHEN (requiere POS)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'kitchen') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.kitchen_tasks (
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

  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO RESERVATIONS (requiere customers)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'reservations') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.reservations (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO DELIVERY (requiere POS, customers, users)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'delivery') THEN
  
  
    -- ── delivery_orders (FK → pos_orders, customers, users) ── Pedidos de entrega con dirección y repartidor.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.delivery_orders (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO ROUTES (requiere users)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'routes') THEN

    -- ── delivery_routes (FK → users) ── Rutas de reparto con repartidor y estado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.delivery_routes (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO TRACKING (requiere users)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'tracking') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.tracking_gps (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO APPOINTMENTS (requiere customers)
  -- ═══════════════════════════════════════════════════════════════════════════════
  IF ANY_MATCH(v_modules, 'appointments') THEN

    -- ── services (sin FK) ── Servicios ofrecidos con precio y duración.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.services (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name             VARCHAR(255)  NOT NULL,
        description      TEXT,
        price            NUMERIC(12,2) NOT NULL,
        duration_minutes INT           DEFAULT 30,
        is_active        BOOLEAN       DEFAULT true,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── appointments (FK → services, customers) ── Citas agendadas con servicio y cliente.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.appointments (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO EMPLOYEES (requiere users para user_id opcional)
  -- ═══════════════════════════════════════════════════════════════════════════════
  IF ANY_MATCH(v_modules, 'employees') THEN

    -- ── employees (FK → users) ── Empleados del negocio con puesto, salario y estado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.employees (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID REFERENCES %I.users(id) ON DELETE SET NULL,
        full_name       VARCHAR(255) NOT NULL,
        email           VARCHAR(255),
        phone           VARCHAR(20),
        position        VARCHAR(100),
        department      VARCHAR(100),
        document_number VARCHAR(50),
        salary          NUMERIC(12,2),
        payment_type    VARCHAR(20) DEFAULT ''hourly'',
        hired_at        DATE,
        status          VARCHAR(20) DEFAULT ''active'',
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── worked_hours (FK → employees) ── Horas trabajadas por empleado por fecha.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.worked_hours (
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



    -- ── attendance_records (FK → employees) ── Registros de asistencia.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.attendance_records (
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



    -- ── employee_schedules (FK → employees) ── Horarios asignados a empleados.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.employee_schedules (
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



    -- ── employee_leaves (FK → employees) ── Solicitudes de permisos y vacaciones.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.employee_leaves (
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



    -- ── employee_payrolls (FK → employees) ── Nóminas por empleado con período y salarios.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.employee_payrolls (
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
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_type VARCHAR(20) DEFAULT ''hourly''
      )', p_schema_name, p_schema_name);
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I_employee_payrolls_employee_id_period_idx ON %I.employee_payrolls (employee_id, period_start)',
      p_schema_name, p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── employee_payroll_details (FK → employee_payrolls) ── Detalles de nómina (ingresos/deducciones).
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.employee_payroll_details (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO CRM (requiere customers, users)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'crm') THEN

    -- ── crm_interactions (FK → customers, users) ── Interacciones con clientes.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.crm_interactions (
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



    -- ── crm_custom_segments (sin FK) ── Segmentos personalizados de clientes con condiciones JSON.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.crm_custom_segments (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(255) NOT NULL,
        description TEXT,
        color       VARCHAR(20)  DEFAULT ''#6842fe'',
        conditions  JSONB        DEFAULT ''{}''::jsonb,
        created_at  TIMESTAMPTZ  DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name);
    v_table_count := v_table_count + 1;



    -- ── email_campaigns (sin FK) ── Campañas de email marketing.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.email_campaigns (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO LOYALTY (requiere customers)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'loyalty') THEN

    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.loyalty_points (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO QUEUE (requiere customers)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'queue') THEN

    -- ── service_queue (FK → customers) ── Cola de atención con ticket y estado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.service_queue (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO ECOMMERCE (requiere customers, products)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'ecommerce') THEN

    -- ── ecommerce_orders (FK → customers) ── Órdenes de tienda online con estado y total.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.ecommerce_orders (
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


    -- ── ecommerce_order_items (FK → ecommerce_orders, products) ── Ítems de órdenes online.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.ecommerce_order_items (
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


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO NOTIFICATIONS (requiere users)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'notifications') THEN

    -- ── notifications (FK → users) ── Notificaciones internas por usuario.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.notifications (
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


    -- ── email_templates (sin FK) ── Plantillas de email con asunto y cuerpo.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.email_templates (
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



    -- ── email_logs (sin FK) ── Registro de emails enviados.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.email_logs (
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



    -- ── push_subscriptions (sin FK) ── Suscripciones a notificaciones push.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.push_subscriptions (
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



    -- ── push_notifications_history (sin FK) ── Historial de push enviadas.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.push_notifications_history (
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



    -- ── scheduled_notifications (sin FK) ── Notificaciones programadas para fecha/hora específica.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.scheduled_notifications (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO EINVOICING (SRI Ecuador, requiere POS opcional)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'einvoicing') THEN

    -- ── einvoice_config (sin FK) ── Configuración de facturación electrónica: RUC, ambiente, series y certificado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.einvoice_config (
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
        secuencial_credit_notes   INT        DEFAULT 1,
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



    -- ── einvoices (sin FK) ── Facturas electrónicas emitidas con clave de acceso, estado y XML firmado.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.einvoices (
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
        updated_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        credited_amount NUMERIC(10, 2) DEFAULT 0
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



    -- ── credit_notes (FK → einvoices) ── Notas de crédito electrónicas con motivo y total.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.credit_notes (
        id                   SERIAL PRIMARY KEY,
        invoice_id           UUID REFERENCES %I.einvoices(id) ON DELETE SET NULL,
        reference_invoice    VARCHAR(50),
        credit_note_number   VARCHAR(50),
        reason               TEXT NOT NULL,
        items                JSONB        DEFAULT ''[]'',
        subtotal             NUMERIC(10,2) DEFAULT 0,
        iva_amount           NUMERIC(10,2) DEFAULT 0,
        discount_amount      NUMERIC(10,2) DEFAULT 0,
        total                NUMERIC(10,2) DEFAULT 0,
        remaining_balance    NUMERIC(10,2) DEFAULT 0,
        customer_name        VARCHAR(255),
        customer_ruc         VARCHAR(20),
        customer_email       VARCHAR(255),
        status               VARCHAR(20)  DEFAULT ''emitida'',
        access_key           VARCHAR(60),
        auth_number          VARCHAR(60),
        auth_date            TIMESTAMP WITH TIME ZONE,
        signed_xml           TEXT,
        sri_message          TEXT,
        sri_json             JSONB,
        emission_date        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        created_at           TIMESTAMPTZ  DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  DEFAULT NOW()
      )', p_schema_name, p_schema_name);

    -- Índices para mejorar el rendimiento
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_invoice_id_idx ON %I.credit_notes (invoice_id)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_created_at_idx ON %I.credit_notes (created_at DESC)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_status_idx ON %I.credit_notes (status)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_access_key_idx ON %I.credit_notes (access_key)', p_schema_name, p_schema_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I_credit_notes_credit_note_number_idx ON %I.credit_notes (credit_note_number)', p_schema_name, p_schema_name);

    -- Actualizar contador de tablas
    v_table_count := v_table_count + 1;
  END IF;




  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO RETAIL (requiere POS)
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'retail') THEN

    -- ── retail_settings (sin FK) ── Configuración específica de tienda/retail.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.retail_settings (
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



    -- ── retail_sessions (FK → users) ── Sesiones de cajero (turnos) con apertura y cierre.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.retail_sessions (
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



    -- ── retail_session_orders (FK → retail_sessions, pos_orders) ── Relación entre sesiones y órdenes.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.retail_session_orders (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- MÓDULO REPORTS
  -- ═══════════════════════════════════════════════════════════════════════════════

  IF ANY_MATCH(v_modules, 'reports') THEN

    -- ── reports_cache (sin FK) ── Caché de reportes generados con tipo, parámetros y payload JSON.
    EXECUTE format('
      CREATE TABLE IF NOT EXISTS %I.reports_cache (
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



  -- ═══════════════════════════════════════════════════════════════════════════════
  -- DATOS INICIALES
  -- ═══════════════════════════════════════════════════════════════════════════════
  EXECUTE format(
    'INSERT INTO %I.business_profile (id, legal_name) VALUES (1, %L) ON CONFLICT DO NOTHING',
    p_schema_name, v_request.business_name);


  -- ═══════════════════════════════════════════════════════════════════════════════
  -- RESULTADO
  -- ═══════════════════════════════════════════════════════════════════════════════
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



