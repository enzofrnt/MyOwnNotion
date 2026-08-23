-- Verified backup coverage for operational checkpoints (feature 017).
--
-- A checkpoint may release covered update payloads only after the exact
-- checkpoint has travelled to, and been read back from, a backup destination.
-- The foreign key deliberately restricts deletion of that evidence until a
-- newer verified backup covers the checkpoint.

BEGIN;

ALTER TABLE page_operation_checkpoints
    ADD COLUMN verified_backup_id uuid REFERENCES backups (id);

CREATE INDEX page_operation_checkpoints_backup_idx
    ON page_operation_checkpoints (verified_backup_id);

INSERT INTO schema_migrations (version) VALUES ('0010_page_operation_backups');

COMMIT;
