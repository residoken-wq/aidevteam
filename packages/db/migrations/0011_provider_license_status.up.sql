-- 0011_provider_license_status (up) — P2-09. License status of provider accounts (fail-closed default unverified).
ALTER TABLE provider_accounts ADD COLUMN license_status text NOT NULL DEFAULT 'unverified' CHECK (license_status IN ('approved', 'unverified', 'prohibited'));
ALTER TABLE provider_accounts ADD COLUMN license_status_changed_at timestamptz;
ALTER TABLE provider_accounts ADD COLUMN license_status_changed_by_user_id uuid REFERENCES users (id);
