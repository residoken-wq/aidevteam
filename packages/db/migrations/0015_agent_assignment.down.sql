-- 0015_agent_assignment (down) — P3-05: Agent capability and capacity limits.
ALTER TABLE tasks DROP COLUMN IF EXISTS required_capabilities;
ALTER TABLE agents DROP COLUMN IF EXISTS capabilities;
ALTER TABLE agents DROP COLUMN IF EXISTS max_active_tasks;
