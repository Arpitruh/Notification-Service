CREATE TABLE demo_session (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, verified BOOLEAN NOT NULL DEFAULT FALSE);
CREATE INDEX demo_session_expiry ON demo_session(expires_at);
CREATE TABLE demo_quota (key TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(key,day));
