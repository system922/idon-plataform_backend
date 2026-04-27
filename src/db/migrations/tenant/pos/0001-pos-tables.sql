-- Migration: tenant/pos/0001-pos-tables.sql
-- Description: POS (Point of Sale) module tables

CREATE TABLE IF NOT EXISTS {SCHEMA}.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_categories_is_active ON {SCHEMA}.categories(is_active);

-- Products
CREATE TABLE IF NOT EXISTS {SCHEMA}.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES {SCHEMA}.categories(id) ON DELETE SET NULL,
  sku VARCHAR(50) UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  price DECIMAL(12, 2) NOT NULL,
  cost DECIMAL(12, 2),
  stock INT DEFAULT 0,
  reorder_level INT DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_products_category_id ON {SCHEMA}.products(category_id);
CREATE INDEX idx_products_sku ON {SCHEMA}.products(sku);
CREATE INDEX idx_products_is_active ON {SCHEMA}.products(is_active);

-- Sales transactions
CREATE TABLE IF NOT EXISTS {SCHEMA}.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_number VARCHAR(50) UNIQUE,
  user_id UUID NOT NULL,
  total DECIMAL(12, 2) NOT NULL,
  tax DECIMAL(12, 2),
  discount DECIMAL(12, 2),
  payment_method VARCHAR(100),
  status VARCHAR(50) DEFAULT 'completed',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sales_transaction_number ON {SCHEMA}.sales(transaction_number);
CREATE INDEX idx_sales_user_id ON {SCHEMA}.sales(user_id);
CREATE INDEX idx_sales_status ON {SCHEMA}.sales(status);
CREATE INDEX idx_sales_created_at ON {SCHEMA}.sales(created_at);

-- Sale line items
CREATE TABLE IF NOT EXISTS {SCHEMA}.sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES {SCHEMA}.sales(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES {SCHEMA}.products(id),
  quantity INT NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_sale_items_sale_id ON {SCHEMA}.sale_items(sale_id);
CREATE INDEX idx_sale_items_product_id ON {SCHEMA}.sale_items(product_id);
