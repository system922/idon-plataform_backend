-- Migration: tenant/pos/0003-cash-register-opening.sql
-- Description: Apertura de caja con denominaciones de monedas y billetes

DO $$
DECLARE
  v_schema TEXT := '{SCHEMA}';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = v_schema AND table_name = 'cash_register_openings'
  ) THEN
    EXECUTE format('
      CREATE TABLE %I.cash_register_openings (
        id             SERIAL PRIMARY KEY,
        user_id        VARCHAR(100)  NOT NULL,
        user_name      VARCHAR(255),
        date           DATE          NOT NULL,
        -- Monedas (cantidad de piezas)
        moneda_001     INT           NOT NULL DEFAULT 0,
        moneda_005     INT           NOT NULL DEFAULT 0,
        moneda_010     INT           NOT NULL DEFAULT 0,
        moneda_025     INT           NOT NULL DEFAULT 0,
        moneda_050     INT           NOT NULL DEFAULT 0,
        moneda_100     INT           NOT NULL DEFAULT 0,
        -- Billetes (cantidad de piezas)
        billete_1      INT           NOT NULL DEFAULT 0,
        billete_5      INT           NOT NULL DEFAULT 0,
        billete_10     INT           NOT NULL DEFAULT 0,
        billete_20     INT           NOT NULL DEFAULT 0,
        billete_50     INT           NOT NULL DEFAULT 0,
        billete_100    INT           NOT NULL DEFAULT 0,
        -- Totales
        total_efectivo NUMERIC(14,2) NOT NULL DEFAULT 0,
        monto_banca    NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_inicial  NUMERIC(14,2) NOT NULL DEFAULT 0,
        observaciones  TEXT,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_opening_date_user UNIQUE (date, user_id)
      )', v_schema);

    EXECUTE format(
      'CREATE INDEX %I ON %I.cash_register_openings (date DESC)',
      v_schema || '_cash_opening_date_idx', v_schema
    );
    EXECUTE format(
      'CREATE INDEX %I ON %I.cash_register_openings (user_id)',
      v_schema || '_cash_opening_user_idx', v_schema
    );
  END IF;
END $$;
