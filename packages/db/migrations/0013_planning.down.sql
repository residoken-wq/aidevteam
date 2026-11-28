-- 0013_planning (down) — P3-01.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_sprint_same_project_fk;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_epic_same_project_fk;
ALTER TABLE tasks DROP COLUMN IF EXISTS sprint_id;
ALTER TABLE tasks DROP COLUMN IF EXISTS epic_id;

DROP TABLE IF EXISTS sprints;
DROP FUNCTION IF EXISTS sprints_enforce_transition();
DROP TABLE IF EXISTS epics;
DROP TABLE IF EXISTS milestones;
