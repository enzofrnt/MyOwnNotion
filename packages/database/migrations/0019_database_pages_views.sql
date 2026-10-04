-- Feature 029: canonical database owners, distinct source identities and saved
-- view containers. Older structured data requires an explicit pre-V1 reset;
-- this migration never deletes content or protected revisions implicitly.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM databases) OR EXISTS (SELECT 1 FROM database_entries) THEN
    RAISE EXCEPTION 'Legacy databases require an explicit development reset before migration 0019; see docs/development.md'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

ALTER TABLE items DROP CONSTRAINT items_kind_check;
ALTER TABLE items ADD CONSTRAINT items_kind_check
  CHECK (kind IN ('page', 'folder', 'file', 'database', 'database_view'));

-- item_id is now the visible owner item, not an independent hidden source id.
-- A separate UUID names the source when views refer to it.
ALTER TABLE databases ADD COLUMN source_id uuid NOT NULL;
ALTER TABLE databases ADD CONSTRAINT databases_source_id_unique UNIQUE (source_id);
ALTER TABLE databases ADD CONSTRAINT databases_owner_source_distinct CHECK (item_id <> source_id);
ALTER TABLE databases ADD CONSTRAINT databases_owner_item_fk
  FOREIGN KEY (item_id, workspace_id) REFERENCES items (id, workspace_id)
  DEFERRABLE INITIALLY DEFERRED;

-- Every full-page owner and linked-view item has its own protected presentation
-- revision. A linked-view item has no row in databases.
CREATE TABLE database_presentations (
  item_id uuid PRIMARY KEY REFERENCES items(id) DEFERRABLE INITIALLY DEFERRED,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  presentation_revision_id uuid NOT NULL REFERENCES revisions(id)
    DEFERRABLE INITIALLY DEFERRED,
  presentation_version integer NOT NULL CHECK (presentation_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT database_presentations_item_workspace_fk
    FOREIGN KEY (item_id, workspace_id) REFERENCES items(id, workspace_id)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX database_presentations_workspace_idx ON database_presentations(workspace_id);

-- Values are historical by owner source and entry, even when the entry leaves.
-- The direct active hierarchy placement determines current membership.
ALTER TABLE database_entries DROP CONSTRAINT database_entries_pkey;
ALTER TABLE database_entries ADD CONSTRAINT database_entries_pkey
  PRIMARY KEY (database_id, entry_item_id);
ALTER TABLE database_entries ADD COLUMN value_revision_id uuid NOT NULL
  REFERENCES revisions(id) DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX database_entries_global_value_version_unique
  ON database_entries(entry_item_id, value_version);

CREATE OR REPLACE FUNCTION enforce_database_owner_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM items WHERE id = NEW.item_id
      AND workspace_id = NEW.workspace_id AND kind = 'database'
  ) THEN
    RAISE EXCEPTION 'database source owner must be a database item'
      USING ERRCODE = '23514', CONSTRAINT = 'database_owner_kind_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER databases_owner_kind_trigger
  BEFORE INSERT OR UPDATE OF item_id, workspace_id ON databases
  FOR EACH ROW EXECUTE FUNCTION enforce_database_owner_kind();

CREATE OR REPLACE FUNCTION enforce_database_presentation_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM items WHERE id = NEW.item_id AND workspace_id = NEW.workspace_id
      AND kind IN ('database', 'database_view')
  ) THEN
    RAISE EXCEPTION 'database presentation requires a database or linked-view item'
      USING ERRCODE = '23514', CONSTRAINT = 'database_presentation_kind_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER database_presentations_kind_trigger
  BEFORE INSERT OR UPDATE OF item_id, workspace_id ON database_presentations
  FOR EACH ROW EXECUTE FUNCTION enforce_database_presentation_kind();

CREATE OR REPLACE FUNCTION enforce_database_entry_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM items WHERE id = NEW.entry_item_id
      AND workspace_id = NEW.workspace_id AND kind IN ('page', 'folder')
  ) THEN
    RAISE EXCEPTION 'database value history requires a page or folder entry'
      USING ERRCODE = '23514', CONSTRAINT = 'database_entry_kind_check';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER database_entries_page_kind_trigger ON database_entries;
CREATE TRIGGER database_entries_kind_trigger
  BEFORE INSERT OR UPDATE OF entry_item_id, workspace_id ON database_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_database_entry_kind();

CREATE OR REPLACE FUNCTION enforce_database_hierarchy_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_kind text;
DECLARE child_kind text;
BEGIN
  IF NEW.kind <> 'hierarchy' OR NEW.removed_at IS NOT NULL OR NEW.parent_item_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO parent_kind FROM items WHERE id = NEW.parent_item_id;
  SELECT kind INTO child_kind FROM items WHERE id = NEW.item_id;
  IF parent_kind = 'database_view' OR
     (parent_kind = 'database' AND child_kind NOT IN ('page', 'folder')) THEN
    RAISE EXCEPTION 'database parent cannot contain this item kind'
      USING ERRCODE = '23514', CONSTRAINT = 'database_hierarchy_parent_check';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER placements_database_parent_trigger
  BEFORE INSERT OR UPDATE OF parent_item_id, item_id, kind, removed_at ON placements
  FOR EACH ROW EXECUTE FUNCTION enforce_database_hierarchy_parent();

-- A raw item insert cannot strand a visible owner or linked-view item. The
-- checks run at commit, after the mutation has inserted the source/presentation.
CREATE OR REPLACE FUNCTION enforce_database_item_companions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'database' AND (
    NOT EXISTS (SELECT 1 FROM databases WHERE item_id = NEW.id) OR
    NOT EXISTS (SELECT 1 FROM database_presentations WHERE item_id = NEW.id)
  ) THEN
    RAISE EXCEPTION 'database item requires its source and presentation'
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
CREATE CONSTRAINT TRIGGER items_database_companions_trigger
  AFTER INSERT OR UPDATE OF kind ON items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_database_item_companions();

CREATE OR REPLACE FUNCTION prevent_structured_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind IN ('database', 'database_view') AND NEW.kind <> OLD.kind THEN
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

INSERT INTO schema_migrations (version) VALUES ('0019_database_pages_views');
COMMIT;
