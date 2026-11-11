-- Stable per-database entry numbers for the "Identifiant" property.
-- Existing entries are numbered in creation order; new entries take the next
-- number for their database. NULL stays possible for rows created before the
-- property existed and never numbered.
BEGIN;

ALTER TABLE database_entries ADD COLUMN entry_number integer;

WITH numbered AS (
  SELECT
    database_id,
    entry_item_id,
    row_number() OVER (
      PARTITION BY database_id
      ORDER BY created_at, entry_item_id
    )::integer AS number
  FROM database_entries
)
UPDATE database_entries AS target
SET entry_number = numbered.number
FROM numbered
WHERE target.database_id = numbered.database_id
  AND target.entry_item_id = numbered.entry_item_id;

CREATE UNIQUE INDEX database_entries_database_number_unique
  ON database_entries (database_id, entry_number)
  WHERE entry_number IS NOT NULL;

CREATE OR REPLACE FUNCTION database_entries_assign_entry_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.entry_number IS NULL THEN
    SELECT COALESCE(MAX(entry_number), 0) + 1
    INTO NEW.entry_number
    FROM database_entries
    WHERE database_id = NEW.database_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER database_entries_assign_entry_number_trigger
  BEFORE INSERT ON database_entries
  FOR EACH ROW
  EXECUTE FUNCTION database_entries_assign_entry_number();

-- Every reviewed migration records itself in the same transaction. Without
-- this line the schema moved but the version registry stayed at 0020, so the
-- update guard refused every later start ("reviewed migrations remain
-- unapplied") and a fresh install could not be created at all.
INSERT INTO schema_migrations (version) VALUES ('0021_database_entry_numbers');
COMMIT;
