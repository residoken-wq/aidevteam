-- 0003_rbac_context_rate_limit (down) — drops rate-limit counters and the per-session active org.
DROP TABLE IF EXISTS rate_limit_hits;
ALTER TABLE sessions DROP COLUMN IF EXISTS active_org_id;
