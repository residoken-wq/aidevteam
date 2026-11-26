-- 0002_oauth_login_states (up) — one-time OAuth login attempts (CSRF state + PKCE verifier), P1-05G.
-- Only the SHA-256 of `state` is stored. The PKCE code_verifier is kept server-side for at most
-- 10 minutes (GitHub authorization codes expire after 10 minutes) and is useless without the code.
CREATE TABLE oauth_login_states (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash    bytea NOT NULL UNIQUE CHECK (octet_length(state_hash) = 32),
  code_verifier text NOT NULL CHECK (code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  CONSTRAINT oauth_login_states_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX oauth_login_states_expires_idx ON oauth_login_states (expires_at);
