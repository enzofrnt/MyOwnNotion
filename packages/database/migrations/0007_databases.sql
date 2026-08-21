-- Page-backed databases and their entry memberships (feature 009).
--
-- Only structural routing data is stored here. Definitions and values are
-- protected records keyed by item identity and the monotonic versions below;
-- no property label, filter or value is available to a database dump.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS items_id_workspace_unique
    ON items (id, workspace_id);

CREATE TABLE IF NOT EXISTS databases (
    item_id uuid PRIMARY KEY REFERENCES items (id),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    definition_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT databases_item_workspace_fk
        FOREIGN KEY (item_id, workspace_id)
        REFERENCES items (id, workspace_id),
    CONSTRAINT databases_definition_version_check
        CHECK (definition_version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS databases_item_workspace_unique
    ON databases (item_id, workspace_id);
CREATE INDEX IF NOT EXISTS databases_workspace_idx
    ON databases (workspace_id);

CREATE TABLE IF NOT EXISTS database_entries (
    entry_item_id uuid PRIMARY KEY REFERENCES items (id),
    database_id uuid NOT NULL REFERENCES databases (item_id),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    value_version integer NOT NULL,
    added_revision_id uuid NOT NULL REFERENCES revisions (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT database_entries_item_workspace_fk
        FOREIGN KEY (entry_item_id, workspace_id)
        REFERENCES items (id, workspace_id),
    CONSTRAINT database_entries_database_workspace_fk
        FOREIGN KEY (database_id, workspace_id)
        REFERENCES databases (item_id, workspace_id),
    CONSTRAINT database_entries_not_self_check
        CHECK (entry_item_id <> database_id),
    CONSTRAINT database_entries_value_version_check
        CHECK (value_version >= 1)
);

CREATE INDEX IF NOT EXISTS database_entries_database_idx
    ON database_entries (database_id);
CREATE INDEX IF NOT EXISTS database_entries_workspace_idx
    ON database_entries (workspace_id);

-- A capability and an entry are pages, never parallel item kinds. These
-- triggers enforce that invariant in both directions: attachment refuses a
-- non-page, and conversion refuses to strand an attached capability.
CREATE OR REPLACE FUNCTION enforce_database_page_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    candidate_item_id uuid;
BEGIN
    candidate_item_id := COALESCE(
        (to_jsonb(NEW) ->> 'item_id')::uuid,
        (to_jsonb(NEW) ->> 'entry_item_id')::uuid
    );
    IF NOT EXISTS (
        SELECT 1 FROM items
         WHERE id = candidate_item_id
           AND workspace_id = NEW.workspace_id
           AND kind = 'page'
    ) THEN
        RAISE EXCEPTION 'structured database item must be a page'
            USING ERRCODE = '23514', CONSTRAINT = 'database_item_page_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER databases_page_kind_trigger
    BEFORE INSERT OR UPDATE OF item_id, workspace_id ON databases
    FOR EACH ROW EXECUTE FUNCTION enforce_database_page_kind();

CREATE TRIGGER database_entries_page_kind_trigger
    BEFORE INSERT OR UPDATE OF entry_item_id, workspace_id ON database_entries
    FOR EACH ROW EXECUTE FUNCTION enforce_database_page_kind();

CREATE OR REPLACE FUNCTION prevent_structured_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind <> 'page' AND (
        EXISTS (SELECT 1 FROM databases WHERE item_id = OLD.id) OR
        EXISTS (SELECT 1 FROM database_entries WHERE entry_item_id = OLD.id)
    ) THEN
        RAISE EXCEPTION 'structured database page cannot change kind'
            USING ERRCODE = '23514', CONSTRAINT = 'structured_page_kind_change_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER items_structured_page_kind_trigger
    BEFORE UPDATE OF kind ON items
    FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
    EXECUTE FUNCTION prevent_structured_page_kind_change();

INSERT INTO schema_migrations (version) VALUES ('0007_databases');

COMMIT;
