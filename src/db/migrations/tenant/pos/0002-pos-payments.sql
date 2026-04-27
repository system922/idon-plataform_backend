-- Migration: tenant/pos/0002-pos-payments.sql
-- Description: Create pos_payments table if it doesn't exist yet
-- (for tenants provisioned before this table was added to the provision function)

DO $$
DECLARE
  v_schema TEXT := '{SCHEMA}';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = v_schema AND table_name = 'pos_orders'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = v_schema AND table_name = 'pos_payments'
  ) THEN
    EXECUTE format('
      CREATE TABLE %I.pos_payments (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id         UUID NOT NULL REFERENCES %I.pos_orders(id) ON DELETE RESTRICT,
        payment_method   VARCHAR(50)   NOT NULL DEFAULT ''cash'',
        amount           NUMERIC(12,2) NOT NULL,
        reference_number VARCHAR(100),
        status           VARCHAR(50)   NOT NULL DEFAULT ''pending'',
        paid_at          TIMESTAMP,
        created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )', v_schema, v_schema);
    EXECUTE format(
      'CREATE INDEX %I ON %I.pos_payments (order_id)',
      v_schema || '_pos_payments_order_id_idx', v_schema
    );
  END IF;
END $$;
