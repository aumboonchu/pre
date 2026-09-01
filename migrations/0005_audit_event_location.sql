-- Audit fields are persisted with each event, not inferred from the Admin
-- request that later views the report.
ALTER TABLE audit_events ADD COLUMN ip_address TEXT;
ALTER TABLE audit_events ADD COLUMN province TEXT;

CREATE INDEX idx_audit_events_province_created
  ON audit_events(province, created_at DESC);
