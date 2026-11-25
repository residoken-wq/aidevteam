-- 0001_init (down) — WARNING: destroys ALL data in these tables, including the audit log.
-- Only for development/test or a release that never went live. Production rollback is image-only (see CICD.md).
DROP TABLE IF EXISTS release_approvals;
DROP TABLE IF EXISTS audit_events;
DROP FUNCTION IF EXISTS forbid_mutation();
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS role_bindings;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS user_allowlist;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS orgs;
