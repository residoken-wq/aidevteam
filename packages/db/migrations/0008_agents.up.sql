-- P2-05: AI agents of an org (the org chart). An agent may use one provider account of the same org and
-- may report to one other agent of the same org (cycles are refused by the API under an org-level lock).
CREATE TABLE agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs (id),
  slug                 text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name                 text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  title                text CHECK (char_length(title) <= 120),
  model                text CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$'),
  provider_account_id  uuid,
  reports_to_agent_id  uuid,
  enabled              boolean NOT NULL DEFAULT true,
  description          text CHECK (char_length(description) <= 2000),
  created_by_user_id   uuid REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  archived_at          timestamptz,
  CONSTRAINT agents_org_slug_unique UNIQUE (org_id, slug),
  CONSTRAINT agents_id_org_unique UNIQUE (id, org_id),
  CONSTRAINT agents_not_own_manager CHECK (reports_to_agent_id IS NULL OR reports_to_agent_id <> id),
  CONSTRAINT agents_provider_same_org_fk FOREIGN KEY (provider_account_id, org_id) REFERENCES provider_accounts (id, org_id),
  CONSTRAINT agents_manager_same_org_fk FOREIGN KEY (reports_to_agent_id, org_id) REFERENCES agents (id, org_id)
);

CREATE INDEX agents_org_active_idx ON agents (org_id, archived_at, created_at DESC);
CREATE INDEX agents_reports_to_idx ON agents (reports_to_agent_id) WHERE reports_to_agent_id IS NOT NULL;
