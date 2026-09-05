-- Additive storage metadata only. The guarded application update must first
-- verify a complete source backup, then resume and verify encrypted cutover.
BEGIN;

ALTER TABLE file_contents
    ALTER COLUMN sha256 DROP NOT NULL,
    ALTER COLUMN storage_key DROP NOT NULL,
    ADD COLUMN storage_format text NOT NULL DEFAULT 'legacy-v1',
    ADD COLUMN lookup_tag bytea,
    ADD COLUMN manifest_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT file_contents_storage_format_check CHECK (
        (storage_format = 'legacy-v1' AND sha256 IS NOT NULL AND storage_key IS NOT NULL
         AND lookup_tag IS NULL AND manifest_version = 0)
        OR
        (storage_format = 'encrypted-chunks-v1' AND sha256 IS NULL AND storage_key IS NULL
         AND lookup_tag IS NOT NULL AND octet_length(lookup_tag) = 32 AND manifest_version >= 1)
    );
CREATE INDEX file_contents_lookup_idx ON file_contents(lookup_tag, byte_length)
    WHERE storage_format = 'encrypted-chunks-v1';

ALTER TABLE uploads
    ADD COLUMN storage_format text NOT NULL DEFAULT 'legacy-v1',
    ADD COLUMN manifest_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT uploads_storage_format_check CHECK (
        (storage_format = 'legacy-v1' AND manifest_version = 0)
        OR (storage_format = 'encrypted-chunks-v1' AND manifest_version >= 1)
    );

CREATE TABLE protected_upload_chunks (
    id uuid PRIMARY KEY,
    installation_id uuid NOT NULL REFERENCES installations(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    upload_id uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    key_generation integer NOT NULL CHECK (key_generation >= 1),
    record_version integer NOT NULL DEFAULT 1 CHECK (record_version >= 1),
    storage_key text NOT NULL CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    salt text NOT NULL,
    nonce text NOT NULL,
    tag text NOT NULL,
    aad_digest text NOT NULL,
    byte_length bigint NOT NULL CHECK (byte_length > 0 AND byte_length <= 4194304),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT protected_upload_chunks_position_unique UNIQUE (upload_id, chunk_index),
    CONSTRAINT protected_upload_chunks_storage_unique UNIQUE (storage_key)
);
CREATE INDEX protected_upload_chunks_generation_idx ON protected_upload_chunks(workspace_id, key_generation);

-- A lost final response can replay the accepted identity after partial state is
-- removed. One receipt per logical file; purging that file removes its receipt.
CREATE TABLE protected_upload_completions (
    upload_id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    byte_length bigint NOT NULL CHECK (byte_length >= 0),
    completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE protected_file_garbage (
    storage_key text PRIMARY KEY CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE file_storage_transitions (
    id uuid PRIMARY KEY,
    installation_id uuid NOT NULL UNIQUE REFERENCES installations(id),
    source_backup_id uuid NOT NULL,
    source_inventory_envelope_id uuid NOT NULL REFERENCES protected_envelopes(id),
    phase text NOT NULL CHECK (phase IN (
        'inventoried', 'backfilling', 'metadata-protected', 'verified',
        'cutover', 'retiring-sources', 'complete'
    )),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT file_storage_transitions_completion_check CHECK ((phase = 'complete') = (completed_at IS NOT NULL))
);

CREATE TABLE file_storage_transition_entries (
    id uuid PRIMARY KEY,
    transition_id uuid NOT NULL REFERENCES file_storage_transitions(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('content', 'upload', 'metadata', 'orphan')),
    object_id uuid,
    source_envelope_id uuid NOT NULL REFERENCES protected_envelopes(id),
    replacement_envelope_id uuid REFERENCES protected_envelopes(id),
    phase text NOT NULL CHECK (phase IN ('inventoried', 'published', 'verified', 'retired')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT file_storage_transition_entries_replacement_check CHECK (
        phase = 'inventoried' OR replacement_envelope_id IS NOT NULL
    )
);
CREATE UNIQUE INDEX file_storage_transition_entries_object_idx
    ON file_storage_transition_entries(transition_id, kind, object_id) WHERE object_id IS NOT NULL;

-- Quarantined legacy orphans remain recoverable and are included by full backup.
-- Original names/locators live only in the authenticated protected manifest.
CREATE TABLE protected_file_quarantine (
    id uuid PRIMARY KEY,
    transition_entry_id uuid NOT NULL REFERENCES file_storage_transition_entries(id),
    storage_key text NOT NULL UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    manifest_envelope_id uuid NOT NULL REFERENCES protected_envelopes(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES ('0015_protected_file_storage');
COMMIT;
