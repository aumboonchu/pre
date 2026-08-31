-- The hash of the one session that is currently allowed to use each account.
-- Tokens themselves remain only in HTTP-only cookies and the sessions table.
ALTER TABLE users ADD COLUMN active_session_token_hash TEXT;
