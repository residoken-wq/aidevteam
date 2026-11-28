-- 0011_provider_license_status (down) — P2-09. Revert license status columns. Dev/test only.
ALTER TABLE provider_accounts DROP COLUMN IF EXISTS license_status;
ALTER TABLE provider_accounts DROP COLUMN IF EXISTS license_status_changed_at;
ALTER TABLE provider_accounts DROP COLUMN IF EXISTS license_status_changed_by_user_id;
