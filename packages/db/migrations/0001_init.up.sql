-- 0001_init (up) — identity, RBAC base, sessions, append-only audit, release approvals.
-- Target: PostgreSQL >= 13 (gen_random_uuid built in). Tested on 16.
-- Runs inside a single transaction (see src/migrate.ts).

-- Organizations (tenants)
CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

-- People who can sign in. Identity = numeric GitHub user id (ADR-005). No email stored.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL UNIQUE CHECK (github_user_id > 0),
  github_login   text CHECK (char_length(github_login) BETWEEN 1 AND 39), -- display only, never used for identity
  created_at     timestamptz NOT NULL DEFAULT now(),
  disabled_at    timestamptz
);

-- Sign-in allowlist by numeric GitHub user id (ADR-005). Being listed grants NO role.
CREATE TABLE user_allowlist (
  github_user_id   bigint PRIMARY KEY CHECK (github_user_id > 0),
  note             text CHECK (char_length(note) <= 200),
  added_by_user_id uuid REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Roles are defined per org. Permission mapping comes from RBAC_MATRIX.md (P1-06).
CREATE TABLE roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs (id),
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_org_key_unique UNIQUE (org_id, key),
  CONSTRAINT roles_id_org_unique UNIQUE (id, org_id)
);

-- User ↔ role in one org. The composite FK guarantees the role belongs to the same org (no cross-org binding).
-- project-level scoping is added with the projects table (P2).
CREATE TABLE role_bindings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES orgs (id),
  user_id    uuid NOT NULL REFERENCES users (id),
  role_id    uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_bindings_role_same_org_fk FOREIGN KEY (role_id, org_id) REFERENCES roles (id, org_id),
  CONSTRAINT role_bindings_unique UNIQUE (user_id, role_id)
);
CREATE INDEX role_bindings_org_user_idx ON role_bindings (org_id, user_id);

-- Server-side sessions. Only a SHA-256 hash of the session token is stored, never the token itself.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- Append-only audit log. org_id / actor may be NULL for pre-authentication events (e.g. auth.login_denied).
CREATE TABLE audit_events (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id               uuid REFERENCES orgs (id),
  actor_user_id        uuid REFERENCES users (id),
  actor_github_user_id bigint CHECK (actor_github_user_id > 0),
  action               text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  target_type          text CHECK (char_length(target_type) <= 64),
  target_id            text CHECK (char_length(target_id) <= 128),
  request_id           text CHECK (char_length(request_id) <= 128),
  metadata             jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  occurred_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_org_time_idx ON audit_events (org_id, occurred_at DESC);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id);

-- Release approval records (display only in Release 0.1 — O-07). environment column from day one (O-05).
-- Field list must be reconciled with the 9 fields of the approval policy (SOURCE_MISSING in repo).
CREATE TABLE release_approvals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  uuid NOT NULL REFERENCES orgs (id),
  environment             text NOT NULL CHECK (environment IN ('uat', 'production')),
  decision                text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  target_sha              text NOT NULL CHECK (target_sha ~ '^[0-9a-f]{40}$'),
  release_manifest_digest text NOT NULL CHECK (release_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  pipeline_run_id         text NOT NULL CHECK (char_length(pipeline_run_id) BETWEEN 1 AND 64),
  approver_github_user_id bigint NOT NULL CHECK (approver_github_user_id > 0),
  source_comment_url      text NOT NULL CHECK (source_comment_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/pull/[0-9]+#issuecomment-[0-9]+$'),
  decided_at              timestamptz NOT NULL,
  recorded_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX release_approvals_org_env_idx ON release_approvals (org_id, environment, decided_at DESC);

-- Append-only enforcement in the database (defence in depth; the app has no update/delete paths either).
CREATE FUNCTION forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER release_approvals_no_update_delete BEFORE UPDATE OR DELETE ON release_approvals
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER release_approvals_no_truncate BEFORE TRUNCATE ON release_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
