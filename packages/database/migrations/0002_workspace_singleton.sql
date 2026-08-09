-- Migration 0002: enforce the single canonical workspace (FR-001).
--
-- Reviewed SQL; applied explicitly (never schema push).
--
-- FR-001 requires exactly one canonical workspace per installation. Before
-- this migration the invariant was only a convention: getOrCreateWorkspace
-- generates a fresh UUID per call, so two concurrent bootstraps inserted two
-- distinct rows and neither the PRIMARY KEY nor ON CONFLICT DO NOTHING could
-- prevent it. Reads take the earliest row, so behaviour stayed stable while
-- the extra row went undetected.
--
-- A unique index on a constant expression admits at most one row, so a second
-- insert now fails loudly instead of being silently ignored.

BEGIN;

-- Guard: refuse to apply while the invariant is already broken, rather than
-- failing on the index build with an opaque error. Keeping the newest rows
-- would be a data-loss decision that belongs to the owner, not a migration.
DO $$
DECLARE
    workspace_count bigint;
BEGIN
    SELECT count(*) INTO workspace_count FROM workspaces;
    IF workspace_count > 1 THEN
        RAISE EXCEPTION
            'cannot enforce the single-workspace invariant: % workspaces exist. '
            'Resolve manually before applying migration 0002.', workspace_count;
    END IF;
END
$$;

CREATE UNIQUE INDEX workspaces_singleton_idx ON workspaces ((true));

-- Each migration records itself, matching 0001: the runner skips a version
-- already present, so without this the index creation would be retried and
-- fail on the second run.
INSERT INTO schema_migrations (version) VALUES ('0002_workspace_singleton');

COMMIT;
