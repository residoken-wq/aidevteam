-- 0014_task_dependencies (down) — P3-03: Task dependencies (DAG) within the same project.
DROP TABLE IF EXISTS task_dependencies;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_id_project_org_unique;
