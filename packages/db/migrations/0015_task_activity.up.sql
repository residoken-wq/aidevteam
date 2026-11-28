-- 0015_task_activity (up) — P3-07: Task activity timeline and comments.
CREATE TABLE task_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs (id),
  project_id     uuid NOT NULL,
  task_id        uuid NOT NULL,
  author_user_id uuid REFERENCES users (id),
  body           text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_comments_task_same_project_fk FOREIGN KEY (task_id, project_id, org_id) REFERENCES tasks (id, project_id, org_id)
);

CREATE INDEX task_comments_org_project_task_idx ON task_comments (org_id, project_id, task_id, created_at ASC);
CREATE INDEX task_comments_author_idx ON task_comments (author_user_id);

CREATE TRIGGER task_comments_no_update_delete BEFORE UPDATE OR DELETE ON task_comments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER task_comments_no_truncate BEFORE TRUNCATE ON task_comments
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
