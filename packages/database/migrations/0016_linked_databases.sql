-- Independent resource revisions. The historical item_id is an opaque source
-- identity, not a host lifecycle FK. Existing encrypted payloads retain AAD.
BEGIN;
ALTER TABLE databases ADD COLUMN definition_revision_id uuid;
UPDATE databases SET definition_revision_id = items.current_revision_id
  FROM items WHERE items.id = databases.item_id;
ALTER TABLE databases ADD CONSTRAINT databases_definition_revision_fk
  FOREIGN KEY (definition_revision_id) REFERENCES revisions(id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE databases DROP CONSTRAINT databases_item_id_fkey;
ALTER TABLE databases DROP CONSTRAINT databases_item_workspace_fk;
DROP TRIGGER databases_page_kind_trigger ON databases;

-- Entry membership does not make the old host the owner of those pages.
-- Keep placements/entry IDs, content and immutable revisions unchanged.
UPDATE placements SET parent_item_id = NULL
  FROM database_entries
 WHERE placements.item_id = database_entries.entry_item_id
   AND placements.parent_item_id = database_entries.database_id
   AND placements.kind = 'hierarchy' AND placements.removed_at IS NULL;

-- Refresh every upgraded device through the durable feed, without fabricating
-- editorial revisions or rewriting any protected record. Existing revision IDs
-- remain the evidence for each source; the new mutation records this migration.
WITH refresh AS (
  INSERT INTO mutations (id, workspace_id, command_type, status, accepted_at, result_revision_ids)
  SELECT gen_random_uuid(), workspace_id, 'database.migration.independent', 'accepted', now(),
    ARRAY[definition_revision_id] FROM databases
  RETURNING id, workspace_id, result_revision_ids
)
INSERT INTO changes (workspace_id, mutation_id, revision_ids, changed_item_ids)
SELECT refresh.workspace_id, refresh.id, refresh.result_revision_ids,
  ARRAY[source.item_id] || ARRAY(
    SELECT entry_item_id FROM database_entries WHERE database_id = source.item_id
    ORDER BY entry_item_id
  )
FROM refresh JOIN databases AS source
  ON source.definition_revision_id = refresh.result_revision_ids[1];

CREATE OR REPLACE FUNCTION prevent_structured_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'page' AND EXISTS (
    SELECT 1 FROM database_entries WHERE entry_item_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'structured database entry must remain a page'
      USING ERRCODE = '23514', CONSTRAINT = 'structured_page_kind_change_check';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO schema_migrations (version) VALUES ('0016_linked_databases');
COMMIT;
