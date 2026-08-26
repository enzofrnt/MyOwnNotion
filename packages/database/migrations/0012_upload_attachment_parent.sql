-- Preserve the page that initiated an editor upload until its bytes are
-- verified and the logical file can be created atomically as an attachment.
--
-- This column intentionally has no foreign key. If the owner deletes the page
-- while a transfer is interrupted, the upload keeps the original intent and
-- finalization refuses the invalid placement instead of silently moving the
-- file to the workspace root.

BEGIN;

ALTER TABLE uploads
    ADD COLUMN attachment_parent_item_id uuid;

INSERT INTO schema_migrations (version) VALUES ('0012_upload_attachment_parent');

COMMIT;
