-- 0003_rbac_context_rate_limit (up) — P1-06 + P1-05G follow-up.
-- 1) Active org per session: the only source of tenant scope for requests (never request body/query).
ALTER TABLE sessions ADD COLUMN active_org_id uuid REFERENCES orgs (id);

-- 2) Fixed-window rate limit counters (e.g. 5 login starts / 15 minutes / client IP).
--    `bucket` holds a SHA-256 of the client key (IP), never the raw IP.
CREATE TABLE rate_limit_hits (
  scope        text NOT NULL CHECK (scope ~ '^[a-z][a-z0-9_.]{1,62}$'),
  bucket       bytea NOT NULL CHECK (octet_length(bucket) = 32),
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL CHECK (hits > 0),
  PRIMARY KEY (scope, bucket, window_start)
);
CREATE INDEX rate_limit_hits_window_idx ON rate_limit_hits (window_start);
