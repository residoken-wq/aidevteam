-- 0016_agent_assignment (up) — P3-05: Agent capability and capacity limits.
ALTER TABLE agents
  ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN max_active_tasks integer NOT NULL DEFAULT 3,
  ADD CONSTRAINT agents_capabilities_len_check CHECK (cardinality(capabilities) <= 20),
  ADD CONSTRAINT agents_max_active_tasks_range CHECK (max_active_tasks BETWEEN 1 AND 50);

ALTER TABLE tasks
  ADD COLUMN required_capabilities text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT tasks_required_capabilities_len_check CHECK (cardinality(required_capabilities) <= 10);
