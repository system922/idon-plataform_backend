-- Migration: tenant/orders/0001-orders-tables.sql
-- Description: Orders management tables

CREATE TABLE IF NOT EXISTS {SCHEMA}.tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number VARCHAR(50) NOT NULL,
  seats_count INT DEFAULT 4,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tables_table_number ON {SCHEMA}.tables(table_number);
CREATE INDEX idx_tables_is_available ON {SCHEMA}.tables(is_available);

-- Orders
CREATE TABLE IF NOT EXISTS {SCHEMA}.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE,
  table_id UUID REFERENCES {SCHEMA}.tables(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  priority VARCHAR(50) DEFAULT 'normal',
  customer_name VARCHAR(255),
  notes TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_orders_order_number ON {SCHEMA}.orders(order_number);
CREATE INDEX idx_orders_table_id ON {SCHEMA}.orders(table_id);
CREATE INDEX idx_orders_user_id ON {SCHEMA}.orders(user_id);
CREATE INDEX idx_orders_status ON {SCHEMA}.orders(status);
CREATE INDEX idx_orders_started_at ON {SCHEMA}.orders(started_at);

-- Order items
CREATE TABLE IF NOT EXISTS {SCHEMA}.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES {SCHEMA}.orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_order_items_order_id ON {SCHEMA}.order_items(order_id);
CREATE INDEX idx_order_items_product_id ON {SCHEMA}.order_items(product_id);
CREATE INDEX idx_order_items_status ON {SCHEMA}.order_items(status);
