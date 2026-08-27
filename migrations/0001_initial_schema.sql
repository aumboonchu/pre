PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  branch_code TEXT UNIQUE,
  branch_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  role TEXT NOT NULL CHECK (role IN ('branch', 'admin')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0 CHECK (price >= 0),
  total_stock INTEGER NOT NULL DEFAULT 0 CHECK (total_stock >= 0),
  remaining_stock INTEGER NOT NULL DEFAULT 0 CHECK (remaining_stock >= 0 AND remaining_stock <= total_stock),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  branch_id TEXT NOT NULL REFERENCES users(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Waiting for Approved', 'Confirmed', 'Cancel')),
  receipt_key TEXT,
  receipt_name TEXT,
  receipt_type TEXT,
  receipt_uploaded_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  cancel_reason TEXT,
  UNIQUE (branch_id, idempotency_key)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user_expiry ON sessions(user_id, expires_at);
CREATE INDEX idx_products_active_stock ON products(active, remaining_stock);
CREATE INDEX idx_reservations_branch_created ON reservations(branch_id, created_at DESC);
CREATE INDEX idx_reservations_status_created ON reservations(status, created_at DESC);
CREATE INDEX idx_reservations_expiry ON reservations(status, receipt_key, expires_at);
CREATE INDEX idx_audit_created ON audit_events(created_at DESC);

-- The INSERT and stock decrement are one SQLite statement. Concurrent requests
-- cannot consume more than the remaining stock, even when every branch submits
-- at the same moment.
CREATE TRIGGER reservations_consume_stock
BEFORE INSERT ON reservations
WHEN NEW.status <> 'Cancel'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM products
      WHERE id = NEW.product_id AND active = 1 AND remaining_stock > 0
    ) THEN RAISE(ABORT, 'SOLD_OUT')
  END;

  UPDATE products
  SET remaining_stock = remaining_stock - 1,
      updated_at = NEW.created_at
  WHERE id = NEW.product_id AND active = 1 AND remaining_stock > 0;
END;

-- A reservation restores stock only on the first transition to Cancel.
CREATE TRIGGER reservations_restore_stock
AFTER UPDATE OF status ON reservations
WHEN OLD.status <> 'Cancel' AND NEW.status = 'Cancel'
BEGIN
  UPDATE products
  SET remaining_stock = MIN(total_stock, remaining_stock + 1),
      updated_at = NEW.updated_at
  WHERE id = NEW.product_id;
END;

INSERT INTO settings (key, value, updated_at) VALUES
  ('booking_open', '0', 1787731200000),
  ('booking_opens_at', '', 1787731200000),
  ('booking_label', '20:00 น. (เวลา Server)', 1787731200000);

-- Branch accounts use password 1234. Admin uses a separate strong initial
-- password shared out-of-band. Passwords are PBKDF2-SHA256 hashes.
INSERT INTO users (id, branch_code, branch_name, username, role, password_salt, password_hash, active, created_at, updated_at) VALUES
  ('admin', NULL, 'JIB HQ Admin', 'admin', 'admin', 'zGmuy9+HQFd8JlBeHRmV/g==', 'oYukIkpmT43TXjyHkgJM0FhRPyRFJQ1lu9luO1IPj3g=', 1, 1787731200000, 1787731200000),
  ('284', 'JIB-284', 'สาขา เซ็นทรัล Westville', 'jib284', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('286', 'JIB-286', 'สาขา เซ็นทรัล นครสวรรค์', 'jib286', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('287', 'JIB-287', 'สาขา เซียร์ เมกก้าช็อป E-TAX', 'jib287', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('288', 'JIB-288', 'สาขา เซ็นทรัล นครปฐม', 'jib288', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('289', 'JIB-289', 'สาขา กาฬสินธุ์ (CB)', 'jib289', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('291', 'JIB-291', 'สาขา เชียงใหม่ (Online)', 'jib291', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('292', 'JIB-292', 'สาขา ขอนแก่น (Online)', 'jib292', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('293', 'JIB-293', 'สาขา เดอะมอลล์โคราช (Online)', 'jib293', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('294', 'JIB-294', 'สาขา พัทยา (ตึกคอม) (Online)', 'jib294', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('295', 'JIB-295', 'สาขา สงขลา-หาดใหญ่ (Online)', 'jib295', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('296', 'JIB-296', 'สาขา JIB ONSITE SERVICE', 'jib296', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('297', 'JIB-297', 'สาขา JIB Mobile - Fashion Island', 'jib297', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('298', 'JIB-298', 'สาขา เซ็นทรัล พาร์ค', 'jib298', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('299', 'JIB-299', 'สาขา บึงกาฬ (CB)', 'jib299', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('300', 'JIB-300', 'สาขา ตราด (CB)', 'jib300', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('301', 'JIB-301', 'สาขา เซ็นทรัล กระบี่', 'jib301', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('302', 'JIB-302', 'สาขา ตาก (CB)', 'jib302', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('303', 'JIB-303', 'สาขา น่าน (CB)', 'jib303', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('306', 'JIB-306', 'สาขา หนองบัวลำภู (CB)', 'jib306', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('307', 'JIB-307', 'สาขา JIB Mobile เซ็นทรัลปิ่นเกล้า', 'jib307', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('309', 'JIB-309', 'สาขา เซ็นทรัลขอนแก่น แคมปัส', 'jib309', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000),
  ('310', 'JIB-310', 'สาขา เซ็นทรัล Northville', 'jib310', 'branch', 'HwEOBdokadDPVZ0tZceMlw==', 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=', 1, 1787731200000, 1787731200000);

INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at) VALUES
  ('MFYW4ZP/A', 'MFYW4ZP/A', 'IP532-Apple iPhone 17 Pro Max 1TB Cosmic Orange 1-Y', 64900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYM4ZP/A', 'MFYM4ZP/A', 'IP525-Apple iPhone 17 Pro Max 256GB Silver 1-Y', 48900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYN4ZP/A', 'MFYN4ZP/A', 'IP526-Apple iPhone 17 Pro Max 256GB Cosmic Orange 1-Y', 48900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYP4ZP/A', 'MFYP4ZP/A', 'IP527-Apple iPhone 17 Pro Max 256GB Deep Blue 1-Y', 48900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYQ4ZP/A', 'MFYQ4ZP/A', 'IP528-Apple iPhone 17 Pro Max 512GB Silver 1-Y', 56900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYT4ZP/A', 'MFYT4ZP/A', 'IP529-Apple iPhone 17 Pro Max 512GB Cosmic Orange 1-Y', 56900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYU4ZP/A', 'MFYU4ZP/A', 'IP530-Apple iPhone 17 Pro Max 512GB Deep Blue 1-Y', 56900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYV4ZP/A', 'MFYV4ZP/A', 'IP531-Apple iPhone 17 Pro Max 1TB Silver 1-Y', 64900, 5, 5, 1, 1787731200000, 1787731200000),
  ('MFYX4ZP/A', 'MFYX4ZP/A', 'IP533-Apple iPhone 17 Pro Max 1TB Deep Blue 1-Y', 64900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MFYY4ZP/A', 'MFYY4ZP/A', 'IP534-Apple iPhone 17 Pro Max 2TB Silver 1-Y', 80900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG004ZP/A', 'MG004ZP/A', 'IP535-Apple iPhone 17 Pro Max 2TB Cosmic Orange 1-Y', 80900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG014ZP/A', 'MG014ZP/A', 'IP536-Apple iPhone 17 Pro Max 2TB Deep Blue 1-Y', 80900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8G4ZP/A', 'MG8G4ZP/A', 'IP537-Apple iPhone 17 Pro 256GB Silver 1-Y', 43900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8H4ZP/A', 'MG8H4ZP/A', 'IP538-Apple iPhone 17 Pro 256GB Cosmic Orange 1-Y', 43900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8J4ZP/A', 'MG8J4ZP/A', 'IP539-Apple iPhone 17 Pro 256GB Deep Blue 1-Y', 43900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8K4ZP/A', 'MG8K4ZP/A', 'IP540-Apple iPhone 17 Pro 512GB Silver 1-Y', 51900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8M4ZP/A', 'MG8M4ZP/A', 'IP541-Apple iPhone 17 Pro 512GB Cosmic Orange 1-Y', 51900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8N4ZP/A', 'MG8N4ZP/A', 'IP542-Apple iPhone 17 Pro 512GB Deep Blue 1-Y', 51900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8P4ZP/A', 'MG8P4ZP/A', 'IP543-Apple iPhone 17 Pro 1TB Silver 1-Y', 59900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8Q4ZP/A', 'MG8Q4ZP/A', 'IP544-Apple iPhone 17 Pro 1TB Cosmic Orange 1-Y', 59900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG8R4ZP/A', 'MG8R4ZP/A', 'IP545-Apple iPhone 17 Pro 1TB Deep Blue 1-Y', 59900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6J4ZP/A', 'MG6J4ZP/A', 'IP558-Apple iPhone 17 256GB Black 1-Y', 29900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6K4ZP/A', 'MG6K4ZP/A', 'IP559-Apple iPhone 17 256GB White 1-Y', 29900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6L4ZP/A', 'MG6L4ZP/A', 'IP560-Apple iPhone 17 256GB Mist Blue 1-Y', 29900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6M4ZP/A', 'MG6M4ZP/A', 'IP561-Apple iPhone 17 256GB Lavender 1-Y', 29900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6N4ZP/A', 'MG6N4ZP/A', 'IP562-Apple iPhone 17 256GB Sage 1-Y', 29900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6P4ZP/A', 'MG6P4ZP/A', 'IP563-Apple iPhone 17 512GB Black 1-Y', 37900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6Q4ZP/A', 'MG6Q4ZP/A', 'IP564-Apple iPhone 17 512GB White 1-Y', 37900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6T4ZP/A', 'MG6T4ZP/A', 'IP565-Apple iPhone 17 512GB Mist Blue 1-Y', 37900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6U4ZP/A', 'MG6U4ZP/A', 'IP566-Apple iPhone 17 512GB Lavender 1-Y', 37900, 0, 0, 1, 1787731200000, 1787731200000),
  ('MG6V4ZP/A', 'MG6V4ZP/A', 'IP567-Apple iPhone 17 512GB Sage 1-Y', 37900, 0, 0, 1, 1787731200000, 1787731200000);
