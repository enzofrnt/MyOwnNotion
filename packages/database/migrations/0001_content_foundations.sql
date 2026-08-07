-- Migration 0001: canonical content foundations.
-- Reviewed SQL; applied explicitly (never schema push). Matches
-- packages/database/src/schema/. Circular references between items and
-- revisions use DEFERRABLE constraints so one mutation commits atomically.

BEGIN;

CREATE TABLE workspaces (
    id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    schema_version integer NOT NULL CHECK (schema_version >= 1)
);

CREATE TABLE items (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    kind text NOT NULL,
    name text NOT NULL,
    lifecycle text NOT NULL DEFAULT 'active',
    trashed_at timestamptz,
    purge_after timestamptz,
    current_revision_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT items_kind_check CHECK (kind IN ('page', 'folder', 'file')),
    CONSTRAINT items_lifecycle_check CHECK (lifecycle IN ('active', 'trashed', 'purged')),
    CONSTRAINT items_name_check CHECK (length(name) BETWEEN 1 AND 512),
    CONSTRAINT items_trash_metadata_check CHECK (
        (lifecycle <> 'trashed') OR (trashed_at IS NOT NULL AND purge_after IS NOT NULL)
    )
);

CREATE UNIQUE INDEX items_id_kind_unique ON items (id, kind);
CREATE INDEX items_workspace_lifecycle_idx ON items (workspace_id, lifecycle);

CREATE TABLE mutations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    command_type text NOT NULL,
    status text NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT now(),
    accepted_at timestamptz,
    result_revision_ids uuid[] NOT NULL DEFAULT '{}',
    failure_code text,
    CONSTRAINT mutations_status_check CHECK (status IN ('accepted', 'rejected')),
    CONSTRAINT mutations_result_check CHECK (
        (status <> 'accepted') OR (cardinality(result_revision_ids) >= 1)
    )
);

CREATE TABLE revisions (
    id uuid PRIMARY KEY,
    item_id uuid NOT NULL REFERENCES items (id),
    -- Deferred: revisions are written before their mutation record inside
    -- the same transaction; both commit atomically.
    mutation_id uuid NOT NULL REFERENCES mutations (id) DEFERRABLE INITIALLY DEFERRED,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    snapshot jsonb,
    snapshot_expires_at timestamptz,
    lineage_digest text NOT NULL
);

CREATE INDEX revisions_item_idx ON revisions (item_id);

-- Deferred circular reference: an item and its creation revision are
-- inserted in the same transaction and validated at commit.
ALTER TABLE items
    ADD CONSTRAINT items_current_revision_fk
    FOREIGN KEY (current_revision_id) REFERENCES revisions (id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE revision_parents (
    revision_id uuid NOT NULL REFERENCES revisions (id),
    parent_revision_id uuid NOT NULL REFERENCES revisions (id),
    PRIMARY KEY (revision_id, parent_revision_id),
    CONSTRAINT revision_parents_no_self_check CHECK (revision_id <> parent_revision_id)
);

CREATE INDEX revision_parents_parent_idx ON revision_parents (parent_revision_id);

CREATE TABLE placements (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    item_id uuid NOT NULL,
    item_kind text NOT NULL,
    kind text NOT NULL,
    parent_item_id uuid REFERENCES items (id),
    position_key text NOT NULL,
    removed_at timestamptz,
    created_revision_id uuid NOT NULL REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    removed_revision_id uuid REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT placements_item_kind_fk FOREIGN KEY (item_id, item_kind)
        REFERENCES items (id, kind),
    CONSTRAINT placements_kind_check CHECK (kind IN ('hierarchy', 'attachment')),
    CONSTRAINT placements_attachment_parent_check CHECK (
        (kind <> 'attachment') OR (parent_item_id IS NOT NULL)
    ),
    CONSTRAINT placements_attachment_file_check CHECK (
        (kind <> 'attachment') OR (item_kind = 'file')
    ),
    CONSTRAINT placements_position_key_check CHECK (length(position_key) BETWEEN 1 AND 255)
);

CREATE INDEX placements_parent_active_idx ON placements (parent_item_id, kind);
CREATE INDEX placements_item_idx ON placements (item_id);

-- Pages and folders keep exactly one active hierarchy placement.
CREATE UNIQUE INDEX placements_single_hierarchy_unique
    ON placements (item_id)
    WHERE kind = 'hierarchy' AND removed_at IS NULL AND item_kind <> 'file';

CREATE TABLE page_documents (
    page_id uuid PRIMARY KEY REFERENCES items (id),
    format text NOT NULL,
    format_version integer NOT NULL,
    body jsonb NOT NULL,
    CONSTRAINT page_documents_format_check CHECK (format = 'myownnotion.document+json'),
    CONSTRAINT page_documents_version_check CHECK (format_version >= 1)
);

CREATE TABLE file_contents (
    id uuid PRIMARY KEY,
    sha256 bytea NOT NULL,
    byte_length bigint NOT NULL,
    storage_key text NOT NULL UNIQUE,
    verified_at timestamptz,
    reference_count integer NOT NULL DEFAULT 0,
    CONSTRAINT file_contents_length_check CHECK (byte_length >= 0),
    CONSTRAINT file_contents_sha256_check CHECK (octet_length(sha256) = 32)
);

CREATE INDEX file_contents_digest_idx ON file_contents (sha256, byte_length);

CREATE TABLE logical_files (
    item_id uuid PRIMARY KEY REFERENCES items (id),
    content_id uuid NOT NULL REFERENCES file_contents (id),
    media_type text NOT NULL,
    original_name text NOT NULL,
    byte_length bigint NOT NULL,
    CONSTRAINT logical_files_length_check CHECK (byte_length >= 0)
);

CREATE TABLE changes (
    sequence bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    mutation_id uuid NOT NULL UNIQUE REFERENCES mutations (id),
    revision_ids uuid[] NOT NULL DEFAULT '{}',
    changed_item_ids uuid[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX changes_workspace_idx ON changes (workspace_id, sequence);

CREATE TABLE relationships (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    source_item_id uuid NOT NULL REFERENCES items (id),
    target_item_id uuid NOT NULL REFERENCES items (id),
    relation_type text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}',
    created_revision_id uuid NOT NULL REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    removed_revision_id uuid REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT relationships_type_check CHECK (
        relation_type ~ '^[a-z][a-z0-9.-]*:[a-z][a-z0-9.-]*$'
    )
);

CREATE INDEX relationships_source_idx ON relationships (source_item_id);
CREATE INDEX relationships_target_idx ON relationships (target_item_id);

CREATE TABLE lifecycle_events (
    id uuid PRIMARY KEY,
    item_id uuid NOT NULL REFERENCES items (id),
    mutation_id uuid NOT NULL REFERENCES mutations (id) DEFERRABLE INITIALLY DEFERRED,
    event_type text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    placement_snapshot jsonb NOT NULL DEFAULT '[]',
    CONSTRAINT lifecycle_events_type_check CHECK (
        event_type IN ('trashed', 'restored', 'purged')
    )
);

CREATE INDEX lifecycle_events_item_idx ON lifecycle_events (item_id);

CREATE TABLE exports (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    status text NOT NULL DEFAULT 'pending',
    digest text,
    manifest jsonb,
    problem jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    ready boolean NOT NULL DEFAULT false,
    CONSTRAINT exports_status_check CHECK (status IN ('pending', 'ready', 'failed'))
);

-- Migration bookkeeping for the explicit runner (scripts/db/migrate.ts).
CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version) VALUES ('0001_content_foundations');

COMMIT;
