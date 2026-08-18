-- The application version an installation last ran (feature 007, FR-021, FR-022).
--
-- `installations` already records the *schema* version, which is what decides
-- whether data can be read. It does not record which build wrote it, and the
-- update guard needs exactly that: a container image change is invisible to the
-- process being replaced and visible to the one starting, but only if the
-- starting process can compare itself against something.
--
-- Nullable, and deliberately so. An installation that predates this column has
-- never recorded a version, and the first startup after this migration must not
-- read that silence as "the version changed" — it would demand a backup of a
-- version nobody can name, and refuse to migrate on the strength of it. Null
-- means "unknown", which the guard treats as "record it and carry on".

BEGIN;

ALTER TABLE installations ADD COLUMN IF NOT EXISTS application_version text;

-- What the previous version was, and which backup belongs to it. Kept so an
-- owner can be told how to return rather than having to work it out (FR-025).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS previous_application_version text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS previous_backup_id uuid
    REFERENCES backups (id);

INSERT INTO schema_migrations (version) VALUES ('0006_installation_application_version');

COMMIT;
