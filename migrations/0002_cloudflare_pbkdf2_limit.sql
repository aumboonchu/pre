-- Cloudflare Workers Web Crypto accepts at most 100,000 PBKDF2 iterations.
-- The initial remote database was seeded before that runtime difference was
-- discovered, so update only the two known initial hashes.
UPDATE users
SET password_hash = 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4=',
    updated_at = 1787795900000
WHERE role = 'branch'
  AND password_salt = 'HwEOBdokadDPVZ0tZceMlw=='
  AND password_hash = 'T0BHo4aZVIQE3H9P7sQ6wl/lJQgVq0r1Q9OwFIhCJwQ=';

UPDATE users
SET password_hash = 'oYukIkpmT43TXjyHkgJM0FhRPyRFJQ1lu9luO1IPj3g=',
    updated_at = 1787795900000
WHERE id = 'admin'
  AND password_salt = 'zGmuy9+HQFd8JlBeHRmV/g=='
  AND password_hash = '0KwjBbYNa32DGCLQz5wOr1hItwJcRcKSyLI0hDTr+/4=';
