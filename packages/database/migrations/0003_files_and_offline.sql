-- Files and local storage (feature 005): usages, uploads, offline intent.
--
-- Three additions, each answering a question the storage layer of feature 001
-- cannot answer on its own.
--
-- `file_usages` answers "what uses this file", which is the question a deletion
-- confirmation must answer before it destroys anything (FR-004). The existing
-- `file_contents.reference_count` answers "is this used at all" and is kept for
-- reclaiming storage; it cannot name a single usage, which is what an owner
-- needs to see.
--
-- `uploads` gives a transfer a life of its own so it can be resumed (FR-006).
-- The important property is what is *absent*: an upload has no item and no
-- placement, so a partial transfer cannot appear anywhere as a file. That
-- follows from the shape rather than from a check someone has to remember.
--
-- `items.offline_intent` records the owner's instruction that something be kept
-- on their devices (FR-016). It sits with the item, beside `favourite`, for the
-- reason the spec gives: the instruction is about what matters to the owner,
-- not about one device's ergonomics. Whether a given device has actually
-- fetched the content is per-device and stays in the local projection.

BEGIN;

-- ---------------------------------------------------------------------------
-- Where a file is used
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS file_usages (
    file_item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    used_by_item_id uuid NOT NULL REFERENCES items (id) ON DELETE CASCADE,
    usage_kind text NOT NULL,
    -- Which block embeds it, for `embed`; null for the placement kinds, where
    -- the placement itself is the location.
    block_id uuid,
    CONSTRAINT file_usages_kind_check
        CHECK (usage_kind IN ('attachment', 'embed', 'hierarchy')),
    -- A block id belongs to an embed and to nothing else: a placement has no
    -- block, and an embed without one could not be pointed at.
    CONSTRAINT file_usages_block_check
        CHECK ((usage_kind = 'embed') = (block_id IS NOT NULL))
);

-- The same file embedded twice in one page is two usages, because that is what
-- the owner sees and what the confirmation has to enumerate. `block_id` is
-- coalesced so the unique index treats the null of a placement as one value
-- rather than as "always distinct".
CREATE UNIQUE INDEX IF NOT EXISTS file_usages_unique
    ON file_usages (
        file_item_id,
        used_by_item_id,
        usage_kind,
        COALESCE(block_id, '00000000-0000-0000-0000-000000000000'::uuid)
    );

-- The read this table exists for: "what uses this file", asked while an owner
-- waits to confirm a deletion.
CREATE INDEX IF NOT EXISTS file_usages_by_file_idx ON file_usages (file_item_id);

-- The reverse read: rebuilding one page's embeds after its document changes.
CREATE INDEX IF NOT EXISTS file_usages_by_user_idx ON file_usages (used_by_item_id);

-- ---------------------------------------------------------------------------
-- Transfers that can be resumed
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS uploads (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    declared_length bigint NOT NULL,
    -- The authoritative offset, and the only one. A client that believes it
    -- sent more than this is wrong by definition and asks rather than assumes.
    received_length bigint NOT NULL DEFAULT 0,
    media_type text NOT NULL,
    original_name text NOT NULL,
    storage_key text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    -- An abandoned upload is reclaimed rather than kept forever: without this
    -- it occupies storage that no screen accounts for.
    expires_at timestamptz NOT NULL,
    CONSTRAINT uploads_declared_length_check CHECK (declared_length >= 0),
    CONSTRAINT uploads_received_length_check
        CHECK (received_length >= 0 AND received_length <= declared_length)
);

CREATE INDEX IF NOT EXISTS uploads_expiry_idx ON uploads (expires_at);

-- ---------------------------------------------------------------------------
-- What the owner asked to keep
-- ---------------------------------------------------------------------------

ALTER TABLE items ADD COLUMN IF NOT EXISTS offline_intent boolean NOT NULL DEFAULT false;

-- Partial, like the favourites index: the marked items are the small minority.
CREATE INDEX IF NOT EXISTS items_offline_intent_idx
    ON items (workspace_id) WHERE offline_intent;

INSERT INTO schema_migrations (version) VALUES ('0003_files_and_offline');

COMMIT;
