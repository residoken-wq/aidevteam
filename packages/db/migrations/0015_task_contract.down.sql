-- 0015_task_contract (down) — P3-06.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_contract_check;
ALTER TABLE tasks DROP COLUMN IF EXISTS contract;
