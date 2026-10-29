-- Brothers Furniture PostgreSQL Schema

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(100) PRIMARY KEY,
  sku VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100),
  category VARCHAR(100) NOT NULL,
  sub_category VARCHAR(100),
  price NUMERIC(12,2) NOT NULL,
  old_price NUMERIC(12,2),
  rating NUMERIC(3,2) DEFAULT 5.0,
  image TEXT NOT NULL,
  r2_key TEXT,
  cutout BOOLEAN DEFAULT FALSE,
  description TEXT,
  material TEXT,
  dimensions TEXT,
  in_stock BOOLEAN DEFAULT TRUE,
  featured BOOLEAN DEFAULT FALSE,
  stock_count INTEGER DEFAULT 10,
  min_order_quantity INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS r2_key TEXT;

CREATE INDEX IF NOT EXISTS idx_products_type ON products(type);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_sub_category ON products(sub_category);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_products_in_stock ON products(in_stock);

CREATE TABLE IF NOT EXISTS product_images (
  id VARCHAR(100) PRIMARY KEY,
  product_id VARCHAR(100) NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  r2_key TEXT,
  sort_order INTEGER DEFAULT 0,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_sort_order ON product_images(product_id, sort_order ASC);

CREATE TABLE IF NOT EXISTS ergonomic_chairs (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  image TEXT NOT NULL,
  features JSONB DEFAULT '[]'::jsonb,
  in_production BOOLEAN DEFAULT TRUE,
  base_price NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ergonomic_chairs_type ON ergonomic_chairs(type);

CREATE TABLE IF NOT EXISTS leads (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  subject VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'new',
  priority VARCHAR(50) NOT NULL DEFAULT 'medium',
  estimated_value NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_contacted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(100) PRIMARY KEY,
  order_number VARCHAR(100) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  phone VARCHAR(50) NOT NULL,
  email VARCHAR(255) NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  delivery_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  target_delivery_date VARCHAR(50),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS clients (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  logo TEXT NOT NULL,
  sector VARCHAR(100) NOT NULL,
  featured BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS testimonials (
  id VARCHAR(100) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(100) NOT NULL,
  company VARCHAR(255) NOT NULL,
  quote TEXT NOT NULL,
  rating INTEGER DEFAULT 5,
  approved BOOLEAN DEFAULT TRUE,
  featured BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_settings (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
  name VARCHAR(255) NOT NULL,
  address_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  phones JSONB NOT NULL DEFAULT '[]'::jsonb,
  email VARCHAR(255) NOT NULL,
  whatsapp JSONB NOT NULL DEFAULT '{}'::jsonb,
  map JSONB NOT NULL DEFAULT '{}'::jsonb,
  gstin VARCHAR(50),
  factory_location VARCHAR(255),
  free_delivery_threshold NUMERIC(12,2) DEFAULT 50000,
  standard_delivery_fee NUMERIC(12,2) DEFAULT 1500,
  banner_announcement TEXT,
  is_banner_active BOOLEAN DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE IF NOT EXISTS admin_users (
  id VARCHAR(100) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(150) NOT NULL,
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  phone VARCHAR(50),
  avatar_url TEXT,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_status ON admin_users(status);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id VARCHAR(100) PRIMARY KEY,
  admin_email VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON admin_audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS admin_refresh_tokens (
  id VARCHAR(100) PRIMARY KEY,
  admin_id VARCHAR(100) NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
