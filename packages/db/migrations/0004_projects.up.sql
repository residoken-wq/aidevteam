-- 0004_projects (up) — P2-10. Projects belong to exactly one org; tenant scope always via org_id.
CREATE TABLE projects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs (id),
  slug               text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name               text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description        text CHECK (char_length(description) <= 2000),
  created_by_user_id uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  archived_at        timestamptz,
  CONSTRAINT projects_org_slug_unique UNIQUE (org_id, slug),
  -- lets later tables (tasks, workers…) reference (project_id, org_id) so a child can never point at another org's project
  CONSTRAINT projects_id_org_unique UNIQUE (id, org_id)
);
-- Name unique within an org, case-insensitive (task card P2: "tên unique trong org").
CREATE UNIQUE INDEX projects_org_name_unique ON projects (org_id, lower(name));
CREATE INDEX projects_org_active_idx ON projects (org_id, archived_at, created_at DESC);
