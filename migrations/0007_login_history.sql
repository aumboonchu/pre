CREATE TABLE login_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT NOT NULL UNIQUE,
  login_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  logout_at INTEGER,
  logout_reason TEXT,
  ip_address TEXT,
  province TEXT,
  device TEXT NOT NULL
);

CREATE INDEX idx_login_history_user_login
  ON login_history(user_id, login_at DESC);
