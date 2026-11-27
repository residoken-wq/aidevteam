-- P4-01/P4-03/P4-07: agent runs table and queue. Statuses/transitions = docs/architecture/STATE_MACHINES.md §2 (OWNER APPROVED).
ALTER TABLE tasks ADD CONSTRAINT tasks_id_org_unique UNIQUE (id, org_id);

CREATE TABLE agent_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs (id),
  task_id             uuid NOT NULL,
  worker_id           uuid NOT NULL,
  status              text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED')),
  attempt             integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  finished_at         timestamptz,
  output_summary      text CHECK (char_length(output_summary) <= 2000),
  log                 text CHECK (char_length(log) <= 65536),
  error_code          text CHECK (char_length(error_code) <= 100),
  created_by_user_id  uuid REFERENCES users (id),
  CONSTRAINT agent_runs_task_same_org_fk FOREIGN KEY (task_id, org_id) REFERENCES tasks (id, org_id),
  CONSTRAINT agent_runs_worker_same_org_fk FOREIGN KEY (worker_id, org_id) REFERENCES workers (id, org_id)
);

CREATE INDEX agent_runs_status_queued_at_idx ON agent_runs (status, queued_at);
CREATE INDEX agent_runs_org_task_idx ON agent_runs (org_id, task_id, queued_at DESC);
CREATE INDEX agent_runs_worker_active_idx ON agent_runs (org_id, worker_id, status);

CREATE FUNCTION agent_runs_enforce_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' THEN
      RAISE EXCEPTION 'agent_runs must start in QUEUED' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'QUEUED'  AND NEW.status IN ('RUNNING', 'CANCELLED'))
    OR (OLD.status = 'RUNNING' AND NEW.status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'))
  ) THEN
    RAISE EXCEPTION 'agent run transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.worker_id IS DISTINCT FROM OLD.worker_id) THEN
    RAISE EXCEPTION 'agent_run org, task and worker are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_runs_enforce_transition BEFORE INSERT OR UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION agent_runs_enforce_transition();
