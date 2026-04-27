-- Migration: tenant/pos/000X-pos-discounts.sql
-- Description: Descuentos POS (cupones, horarios, por producto y orden)

DO $$
DECLARE
  v_schema TEXT := '{SCHEMA}';
BEGIN

  -- ────────────────────────────────────────────────────────────────────────
  -- TABLA: pos_discounts
  -- ────────────────────────────────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = v_schema AND table_name = 'pos_discounts'
  ) THEN

    EXECUTE format('
      CREATE TABLE %I.pos_discounts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name           VARCHAR(100) NOT NULL,
        type           VARCHAR(20)  NOT NULL, -- percentage | fixed
        value          NUMERIC(10,2) NOT NULL,

        applies_to     VARCHAR(20) DEFAULT ''order'', -- order | product
        product_id     UUID,

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
      )', v_schema);

    -- Índices
    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_discounts (is_active)',
      v_schema || '_pos_discounts_active_idx', v_schema
    );

    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_discounts (code)',
      v_schema || '_pos_discounts_code_idx', v_schema
    );

    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_discounts (product_id)',
      v_schema || '_pos_discounts_product_idx', v_schema
    );

    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_discounts (created_at DESC)',
      v_schema || '_pos_discounts_created_idx', v_schema
    );

  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- FK hacia products (segura)
  -- ────────────────────────────────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = v_schema || '_fk_pos_discounts_product'
  ) THEN
    EXECUTE format('
      ALTER TABLE %I.pos_discounts
      ADD CONSTRAINT %I
      FOREIGN KEY (product_id)
      REFERENCES %I.products(id)
      ON DELETE SET NULL
    ', v_schema, v_schema || '_fk_pos_discounts_product', v_schema);
  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- TABLA: pos_order_discounts (auditoría)
  -- ────────────────────────────────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = v_schema AND table_name = 'pos_order_discounts'
  ) THEN

    EXECUTE format('
      CREATE TABLE %I.pos_order_discounts (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id      UUID NOT NULL,
        discount_id   UUID,
        discount_name VARCHAR(100),
        amount        NUMERIC(12,2) NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', v_schema);

    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_order_discounts (order_id)',
      v_schema || '_pos_order_discounts_order_idx', v_schema
    );

    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_order_discounts (created_at DESC)',
      v_schema || '_pos_order_discounts_created_idx', v_schema
    );

  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- FK hacia pos_orders
  -- ────────────────────────────────────────────────────────────────────────

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = v_schema || '_fk_pos_order_discounts_order'
  ) THEN
    EXECUTE format('
      ALTER TABLE %I.pos_order_discounts
      ADD CONSTRAINT %I
      FOREIGN KEY (order_id)
      REFERENCES %I.pos_orders(id)
      ON DELETE CASCADE
    ', v_schema, v_schema || '_fk_pos_order_discounts_order', v_schema);
  END IF;

END $$;