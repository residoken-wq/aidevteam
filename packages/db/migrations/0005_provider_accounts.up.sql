-- 0005_provider_accounts (up) — P2-07. Accounts of AI/code providers used by agents and workers.
-- Only a secret_ref (pointer) is stored, never a credential (P1-07, docs/architecture/SECRETS.md).
-- The CHECK below duplicates the application rule on purpose: a bug or a manual INSERT cannot store
-- anything that is not a well-formed reference.
CREATE TABLE provider_accounts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs (id),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name               text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  provider           text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google', 'github', 'other')),
  secret_ref         text NOT NULL CHECK (
                       secret_ref ~ '^env:AIDEV_SECRET_[A-Z0-9_]{1,64}$'
                       OR (secret_ref ~ '^file:/run/secrets/[a-z0-9][a-z0-9._-]{0,63}$' AND position('..' IN secret_ref) = 0)
                     ),
  description        text CHECK (char_length(description) <= 2000),
  created_by_user_id uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  CONSTRAINT provider_accounts_org_slug_unique UNIQUE (org_id, slug),
  CONSTRAINT provider_accounts_id_org_unique UNIQUE (id, org_id)
);
CREATE INDEX provider_accounts_org_active_idx ON provider_accounts (org_id, archived_at, created_at DESC);
