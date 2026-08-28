BEGIN;

ALTER TABLE items
  ADD COLUMN icon text;

ALTER TABLE items
  ADD CONSTRAINT items_icon_length_check
    CHECK (icon IS NULL OR length(icon) BETWEEN 1 AND 64),
  ADD CONSTRAINT items_file_icon_check
    CHECK (kind <> 'file' OR icon IS NULL);

INSERT INTO schema_migrations (version) VALUES ('0013_item_icons');

COMMIT;
