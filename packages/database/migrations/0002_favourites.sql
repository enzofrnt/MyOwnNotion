-- Favourites (feature 003, FR-012).
--
-- A column on `items` rather than a join table. The spec settles the question
-- that would otherwise decide it: favourites are per-installation, not
-- per-device, and there is exactly one owner. A join table exists to let many
-- subjects hold an opinion about the same object; here there is only ever one
-- subject, so the second table would carry no information the column does not.
--
-- Kept out of the revision snapshot's content is not an option either: the
-- browser projection is fed from item snapshots, so an attribute that is not in
-- the snapshot does not reach the other devices this feature exists to serve.

BEGIN;

-- Idempotent, like every migration here: the runner skips a version already
-- recorded, and the guards below keep a manual replay harmless too.
ALTER TABLE items ADD COLUMN IF NOT EXISTS favourite boolean NOT NULL DEFAULT false;

-- Partial: the index exists to answer "what are the favourites", and the false
-- rows are the overwhelming majority of a workspace.
CREATE INDEX IF NOT EXISTS items_favourite_idx ON items (workspace_id) WHERE favourite;

-- Each migration records itself; the runner reads this table to decide what to
-- skip, and a file that does not write it is replayed on the next run.
INSERT INTO schema_migrations (version) VALUES ('0002_favourites');

COMMIT;
