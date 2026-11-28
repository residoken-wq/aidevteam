-- 0013_task_contract (up) — P3-06: Task contract (JSON schema) and agent prompt.
ALTER TABLE tasks
  ADD COLUMN contract jsonb;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_contract_check
  CHECK (
    contract IS NULL OR (
      jsonb_typeof(contract) = 'object' AND
      octet_length(contract::text) <= 65536
    )
  );
