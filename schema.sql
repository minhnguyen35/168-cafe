-- Run once to provision the D1 database:
-- npx wrangler d1 execute cafe168-db --file=schema.sql

CREATE TABLE IF NOT EXISTS orders (
  order_id      TEXT     PRIMARY KEY,          -- e.g. "ORD-1720000000000"
  customer_name TEXT     NOT NULL,
  phone         TEXT,
  address       TEXT,
  items         TEXT     NOT NULL,             -- JSON stringified array
  amount        INTEGER  NOT NULL,             -- in VND, e.g. 75000
  status        TEXT     NOT NULL DEFAULT 'PENDING', -- PENDING | PAID | CANCELLED
  checkout_url  TEXT,                          -- PayOS hosted payment page
  payment_ref   TEXT,                          -- PayOS orderCode reference
  created_at    DATETIME NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_payment_ref ON orders(payment_ref);
