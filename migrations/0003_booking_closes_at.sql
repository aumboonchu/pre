INSERT INTO settings (key, value, updated_at)
VALUES ('booking_closes_at', '', 1787961600000)
ON CONFLICT(key) DO NOTHING;
