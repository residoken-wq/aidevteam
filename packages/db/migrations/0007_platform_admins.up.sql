-- P2-03: platform administrators manage orgs (create / rename / archive / restore) across tenants.
-- Granting is operator-only (CLI, audited); there is no API or UI path to become a platform admin.
-- Being a platform admin grants NO access to data inside an org — that still needs an org role.
CREATE TABLE platform_admins (
  user_id            uuid PRIMARY KEY REFERENCES users (id),
  note               text CHECK (char_length(note) <= 200),
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orgs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
