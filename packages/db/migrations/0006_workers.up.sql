-- 0006_workers (up) — P2-08. Release 0.1 supports MOCK workers only (CLAUDE.md §2 rule 8).
-- workspace_path: normalised absolute POSIX path. Overlap (same path, or one inside another) between ACTIVE
-- workers of an org is refused by the api under an org-level lock; the partial unique index is the DB backstop
-- for exact duplicates (fixes router v0.1 weakness §6.2-4).
CREATE TABLE workers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs (id),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name               text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  type               text NOT NULL CHECK (type IN ('mock')),
  workspace_path     text NOT NULL CHECK (
                       char_length(workspace_path) <= 255
                       AND workspace_path ~ '^(/[A-Za-z0-9_][A-Za-z0-9._-]*)+$'
                       AND workspace_path !~ '/\.\.?(/|$)'
                     ),
  project_id         uuid,
  enabled            boolean NOT NULL DEFAULT true,
  description        text CHECK (char_length(description) <= 2000),
  created_by_user_id uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  CONSTRAINT workers_org_slug_unique UNIQUE (org_id, slug),
  CONSTRAINT workers_id_org_unique UNIQUE (id, org_id),
  -- a worker can only be attached to a project of the same org
  CONSTRAINT workers_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id)
);
CREATE UNIQUE INDEX workers_org_active_path_unique ON workers (org_id, workspace_path) WHERE archived_at IS NULL;
CREATE INDEX workers_org_active_idx ON workers (org_id, archived_at, created_at DESC);
