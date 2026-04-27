-- Migration: tenant/inventory/0001-inventory-tables.sql
-- Description: Inventory management tables

CREATE TABLE IF NOT EXISTS {SCHEMA}.inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  transaction_type VARCHAR(50),
  quantity INT NOT NULL,
  reason VARCHAR(255),
  reference_type VARCHAR(100),
  reference_id UUID,
  user_id UUID NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_inventory_transactions_product_id ON {SCHEMA}.inventory_transactions(product_id);
CREATE INDEX idx_inventory_transactions_transaction_type ON {SCHEMA}.inventory_transactions(transaction_type);
CREATE INDEX idx_inventory_transactions_created_at ON {SCHEMA}.inventory_transactions(created_at);

-- Stock adjustments
CREATE TABLE IF NOT EXISTS {SCHEMA}.stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL,
  quantity_before INT,
  quantity_after INT,
  reason VARCHAR(255),
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_stock_adjustments_product_id ON {SCHEMA}.stock_adjustments(product_id);
CREATE INDEX idx_stock_adjustments_created_at ON {SCHEMA}.stock_adjustments(created_at);
