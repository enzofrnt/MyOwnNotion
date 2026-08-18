-- Which device made a change (feature 006, FR-022).
--
-- Nullable, and that is the whole design decision here. Every revision written
-- before this feature has no device to name, and a default would put a false
-- statement into the history: an entry reading "device unknown" is honest, one
-- that guesses is worse than silence.
--
-- The column holds the device identity the owner already sees in their device
-- list. Never the session identifier and never anything derived from key
-- material (FR-023): a history is something an owner reads and exports, so a
-- secret recorded here would leak through every path that shows it.

BEGIN;

ALTER TABLE revisions ADD COLUMN IF NOT EXISTS authored_by_device_id uuid
    REFERENCES authorized_devices (id);

-- Partial: the question this answers is "which device wrote this", asked while
-- reading one item's history, and the rows that predate the feature carry null.
CREATE INDEX IF NOT EXISTS revisions_device_idx
    ON revisions (authored_by_device_id) WHERE authored_by_device_id IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('0004_revision_device');

COMMIT;
