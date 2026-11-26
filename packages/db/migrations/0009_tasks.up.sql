-- P3-02/P3-04: tasks of a project. Statuses/transitions = docs/architecture/STATE_MACHINES.md §1 (OWNER APPROVED).
-- The API moves status only through a conditional UPDATE; the trigger below is defence in depth against any other path.
CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs (id),
  project_id          uuid NOT NULL,
  number              integer NOT NULL CHECK (number > 0),
  title               text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description         text CHECK (char_length(description) <= 10000),
  status              text NOT NULL DEFAULT 'BACKLOG' CHECK (status IN ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED')),
  priority            text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  agent_id            uuid,
  cancel_reason       text CHECK (char_length(cancel_reason) BETWEEN 1 AND 500),
  created_by_user_id  uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tasks_project_number_unique UNIQUE (project_id, number),
  CONSTRAINT tasks_cancel_reason_iff_cancelled CHECK ((status = 'CANCELLED') = (cancel_reason IS NOT NULL)),
  CONSTRAINT tasks_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id),
  CONSTRAINT tasks_agent_same_org_fk FOREIGN KEY (agent_id, org_id) REFERENCES agents (id, org_id)
);

CREATE INDEX tasks_org_project_status_idx ON tasks (org_id, project_id, status);

CREATE FUNCTION tasks_enforce_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'BACKLOG' THEN
      RAISE EXCEPTION 'tasks must start in BACKLOG' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'BACKLOG'     AND NEW.status IN ('TODO', 'CANCELLED'))
    OR (OLD.status = 'TODO'        AND NEW.status IN ('IN_PROGRESS', 'CANCELLED'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('IN_REVIEW', 'CANCELLED'))
    OR (OLD.status = 'IN_REVIEW'   AND NEW.status IN ('IN_PROGRESS', 'DONE'))
  ) THEN
    RAISE EXCEPTION 'task transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'task org, project and number are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tasks_enforce_transition BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION tasks_enforce_transition();
