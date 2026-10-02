-- A database page owns zero, one or many sources. source_id is the source
-- identity. item_id is the origin page and is no longer unique.
-- Pre-V1 rows that already exist are kept: each entry is tagged with the
-- single source its origin page had.
BEGIN;

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'database_entries'::regclass
      AND contype = 'f'
      AND confrelid = 'databases'::regclass
  LOOP
    EXECUTE format('ALTER TABLE database_entries DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;

ALTER TABLE database_entries ADD COLUMN source_id uuid;

UPDATE database_entries AS entry
SET source_id = source.source_id
FROM databases AS source
WHERE entry.database_id = source.item_id
  AND entry.source_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM database_entries WHERE source_id IS NULL) THEN
    RAISE EXCEPTION 'database entries without a source cannot move to migration 0020'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

ALTER TABLE database_entries ALTER COLUMN source_id SET NOT NULL;

ALTER TABLE databases DROP CONSTRAINT databases_pkey;
DROP INDEX IF EXISTS databases_item_workspace_unique;
ALTER TABLE databases DROP CONSTRAINT databases_source_id_unique;
ALTER TABLE databases ADD PRIMARY KEY (source_id);
CREATE INDEX databases_owner_item_idx ON databases (item_id);

ALTER TABLE database_entries
  ADD CONSTRAINT database_entries_source_fk
  FOREIGN KEY (source_id) REFERENCES databases (source_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX database_entries_source_idx ON database_entries (source_id);

CREATE OR REPLACE FUNCTION enforce_database_item_companions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'database' AND NOT EXISTS (
    SELECT 1 FROM database_presentations WHERE item_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'database item requires its presentation'
      USING ERRCODE = '23514', CONSTRAINT = 'database_item_companions_check';
  END IF;
  IF NEW.kind = 'database_view' AND (
    EXISTS (SELECT 1 FROM databases WHERE item_id = NEW.id) OR
    NOT EXISTS (SELECT 1 FROM database_presentations WHERE item_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'linked-view item requires a presentation and no source'
      USING ERRCODE = '23514', CONSTRAINT = 'database_view_companions_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_structured_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'database' AND NEW.kind NOT IN ('database', 'database_view') THEN
    RAISE EXCEPTION 'database item kind cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'database_item_kind_change_check';
  END IF;
  IF OLD.kind = 'database_view' AND NEW.kind NOT IN ('database', 'database_view') THEN
    RAISE EXCEPTION 'database item kind cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'database_item_kind_change_check';
  END IF;
  IF NEW.kind NOT IN ('page', 'folder') AND EXISTS (
    SELECT 1 FROM database_entries WHERE entry_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'database value history belongs to a page or folder'
      USING ERRCODE = '23514', CONSTRAINT = 'database_entry_kind_change_check';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('0020_database_sources_per_origin');
COMMIT;
