-- Full-archive identities remain usable without the portable backup catalogue.
-- This migration itself must be preceded by a verified full backup on old data.
BEGIN;

ALTER TABLE installations ADD COLUMN application_commit text;
ALTER TABLE installations ADD COLUMN application_image text;
ALTER TABLE installations ADD COLUMN previous_full_backup_id uuid;
ALTER TABLE installations ADD CONSTRAINT installations_application_commit_check
    CHECK (application_commit IS NULL OR application_commit ~ '^[0-9a-f]{40,64}$');

INSERT INTO schema_migrations (version) VALUES ('0014_full_backup_provenance');
COMMIT;
