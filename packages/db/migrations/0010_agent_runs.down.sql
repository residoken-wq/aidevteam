DROP TABLE IF EXISTS agent_runs;
DROP FUNCTION IF EXISTS agent_runs_enforce_transition();
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_id_org_unique;
