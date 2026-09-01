-- Presence is derived from a short-lived heartbeat, while logout timestamps
-- remain available for the Admin branch directory.
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
ALTER TABLE users ADD COLUMN last_seen_at INTEGER;
ALTER TABLE users ADD COLUMN last_logout_at INTEGER;

CREATE INDEX idx_users_branch_presence
  ON users(role, active, last_seen_at DESC);
