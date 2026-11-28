-- 0013_planning (up) — P3-01: epics, milestones, sprints and task references.

CREATE TABLE milestones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs (id),
  project_id          uuid NOT NULL,
  slug                text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  title               text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  due_date            date,
  created_by_user_id  uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  CONSTRAINT milestones_project_slug_unique UNIQUE (project_id, slug),
  CONSTRAINT milestones_id_org_unique UNIQUE (id, org_id),
  CONSTRAINT milestones_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT milestones_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id)
);
CREATE INDEX milestones_org_project_idx ON milestones (org_id, project_id);

CREATE TABLE epics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs (id),
  project_id          uuid NOT NULL,
  slug                text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  title               text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description         text CHECK (char_length(description) <= 10000),
  milestone_id        uuid,
  created_by_user_id  uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  archived_at         timestamptz,
  CONSTRAINT epics_project_slug_unique UNIQUE (project_id, slug),
  CONSTRAINT epics_id_org_unique UNIQUE (id, org_id),
  CONSTRAINT epics_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT epics_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id),
  CONSTRAINT epics_milestone_same_project_fk FOREIGN KEY (milestone_id, project_id) REFERENCES milestones (id, project_id)
);
CREATE INDEX epics_org_project_idx ON epics (org_id, project_id);

CREATE TABLE sprints (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES orgs (id),
  project_id          uuid NOT NULL,
  number              integer NOT NULL CHECK (number > 0),
  name                text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  start_date          date NOT NULL,
  end_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'ACTIVE', 'CLOSED')),
  created_by_user_id  uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sprints_project_number_unique UNIQUE (project_id, number),
  CONSTRAINT sprints_id_org_unique UNIQUE (id, org_id),
  CONSTRAINT sprints_id_project_unique UNIQUE (id, project_id),
  CONSTRAINT sprints_project_same_org_fk FOREIGN KEY (project_id, org_id) REFERENCES projects (id, org_id),
  CONSTRAINT sprints_dates_check CHECK (end_date >= start_date)
);
CREATE INDEX sprints_org_project_status_idx ON sprints (org_id, project_id, status);
CREATE UNIQUE INDEX sprints_one_active_per_project_idx ON sprints (project_id) WHERE status = 'ACTIVE';

CREATE FUNCTION sprints_enforce_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' THEN
      RAISE EXCEPTION 'sprint must start in PLANNED' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PLANNED' AND NEW.status = 'ACTIVE')
    OR (OLD.status = 'ACTIVE'  AND NEW.status = 'CLOSED')
  ) THEN
    RAISE EXCEPTION 'sprint transition % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.number IS DISTINCT FROM OLD.number) THEN
    RAISE EXCEPTION 'sprint org, project and number are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sprints_enforce_transition BEFORE INSERT OR UPDATE ON sprints FOR EACH ROW EXECUTE FUNCTION sprints_enforce_transition();

ALTER TABLE tasks ADD COLUMN epic_id uuid;
ALTER TABLE tasks ADD COLUMN sprint_id uuid;
ALTER TABLE tasks ADD CONSTRAINT tasks_epic_same_project_fk FOREIGN KEY (epic_id, project_id) REFERENCES epics (id, project_id);
ALTER TABLE tasks ADD CONSTRAINT tasks_sprint_same_project_fk FOREIGN KEY (sprint_id, project_id) REFERENCES sprints (id, project_id);

CREATE INDEX tasks_epic_idx ON tasks (epic_id);
CREATE INDEX tasks_sprint_idx ON tasks (sprint_id);
