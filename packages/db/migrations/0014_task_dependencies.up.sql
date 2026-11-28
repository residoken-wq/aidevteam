-- 0014_task_dependencies (up) — P3-03: Task dependencies (DAG) within the same project.
ALTER TABLE tasks ADD CONSTRAINT tasks_id_project_org_unique UNIQUE (id, project_id, org_id);

CREATE TABLE task_dependencies (
  org_id              uuid NOT NULL REFERENCES orgs (id),
  project_id          uuid NOT NULL,
  task_id             uuid NOT NULL,
  depends_on_task_id  uuid NOT NULL,
  created_by_user_id  uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, depends_on_task_id),
  CONSTRAINT task_dependencies_no_self_dep CHECK (task_id <> depends_on_task_id),
  CONSTRAINT task_dependencies_task_same_project_fk FOREIGN KEY (task_id, project_id, org_id) REFERENCES tasks (id, project_id, org_id),
  CONSTRAINT task_dependencies_depends_on_same_project_fk FOREIGN KEY (depends_on_task_id, project_id, org_id) REFERENCES tasks (id, project_id, org_id)
);

CREATE INDEX task_dependencies_org_project_task_idx ON task_dependencies (org_id, project_id, task_id);
CREATE INDEX task_dependencies_org_project_depends_on_idx ON task_dependencies (org_id, project_id, depends_on_task_id);
