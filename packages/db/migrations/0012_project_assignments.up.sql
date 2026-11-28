-- 0012_project_assignments (up) — P2-13: Project-scoped access for project_member role.
CREATE TABLE project_assignments (
  org_id             uuid NOT NULL REFERENCES orgs (id),
  project_id         uuid NOT NULL,
  user_id            uuid NOT NULL REFERENCES users (id),
  access             text NOT NULL CHECK (access IN ('read', 'write')),
  created_by_user_id uuid REFERENCES users (id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT project_assignments_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id)
);
CREATE INDEX project_assignments_org_user_idx ON project_assignments (org_id, user_id);
CREATE INDEX project_assignments_project_idx ON project_assignments (project_id);

-- Seed project_member role for existing orgs
INSERT INTO roles (org_id, key, name)
SELECT id, 'project_member', 'project_member'
  FROM orgs
ON CONFLICT (org_id, key) DO NOTHING;
