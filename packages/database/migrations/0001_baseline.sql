-- Migration 0001: the baseline schema (feature 058).
--
-- Replaces the former 0001_initial … 0021_database_entry_numbers. Like the
-- 004 collapse before it, this is a concatenation, not a rewrite: the
-- statements of those files appear below in order, without their own
-- transaction markers and version records, followed by the feature-058
-- multi-account section.
--
-- Permitted only because no installation is deployed and development data is
-- disposable (owner decision 2026-11-16; canvas §32; constitution 5.0.0).
-- A database that recorded any pre-baseline version is refused by the runner
-- and must be recreated. Once a release exists, additive migrations are
-- mandatory again.
--
-- Reviewed SQL; applied explicitly (never schema push). Matches
-- packages/database/src/schema/.

BEGIN;

-- ===========================================================================
-- from 0001_initial.sql
-- ===========================================================================
-- Migration 0001: the initial schema.
--
-- This file replaces the former 0001–0005. It is a collapse, not a rewrite:
-- the statements are those migrations concatenated in order, so a fresh
-- database receives exactly what it received before, plus the feature-004
-- change to how placements denormalise an item's kind.
--
-- Collapsing was permitted only because no installation is deployed and there
-- is no data to migrate. See
-- specs/004-unified-items-conversion/research.md, decision 4, including its
-- removal condition: once a production installation exists, additive
-- migrations become mandatory again and this is not a precedent.
--
-- Reviewed SQL; applied explicitly (never schema push). Matches
-- packages/database/src/schema/.


-- ---------------------------------------------------------------------------
-- from 0001_content_foundations.sql
-- ---------------------------------------------------------------------------

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
    -- Generated, never written. `kind` is mutable between 'page' and 'folder'
    -- (feature 004), but whether an item is a file is fixed for its life, and
    -- that is the only thing placements need to denormalise. Computing it here
    -- means the two can never disagree, which a writer-maintained column could.
    is_file boolean GENERATED ALWAYS AS (kind = 'file') STORED,
    CONSTRAINT items_kind_check CHECK (kind IN ('page', 'folder', 'file')),
    CONSTRAINT items_lifecycle_check CHECK (lifecycle IN ('active', 'trashed', 'purged')),
    CONSTRAINT items_name_check CHECK (length(name) BETWEEN 1 AND 512),
    CONSTRAINT items_trash_metadata_check CHECK (
        (lifecycle <> 'trashed') OR (trashed_at IS NOT NULL AND purge_after IS NOT NULL)
    )
);

-- The target of the placements composite foreign key. It references
-- (id, is_file) rather than (id, kind) so that converting a page to a folder --
-- which changes `kind` and not `is_file` -- cannot break a single placement
-- row. See specs/004-unified-items-conversion/research.md, decision 1.
CREATE UNIQUE INDEX items_id_is_file_unique ON items (id, is_file);
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
    -- Denormalised from items.is_file, not from items.kind.
    --
    -- Both constraints below only ever ask whether the item is a file: an
    -- attachment must be one, and a non-file has exactly one hierarchy
    -- placement. Neither has ever distinguished a page from a folder. Copying
    -- the full kind therefore denormalised a mutable value to enforce a rule
    -- about an immutable one -- and that, not the constraint itself, is what
    -- made converting a page to a folder impossible.
    item_is_file boolean NOT NULL,
    kind text NOT NULL,
    parent_item_id uuid REFERENCES items (id),
    position_key text NOT NULL,
    removed_at timestamptz,
    created_revision_id uuid NOT NULL REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    removed_revision_id uuid REFERENCES revisions (id) DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT placements_item_is_file_fk FOREIGN KEY (item_id, item_is_file)
        REFERENCES items (id, is_file),
    CONSTRAINT placements_kind_check CHECK (kind IN ('hierarchy', 'attachment')),
    CONSTRAINT placements_attachment_parent_check CHECK (
        (kind <> 'attachment') OR (parent_item_id IS NOT NULL)
    ),
    CONSTRAINT placements_attachment_file_check CHECK (
        (kind <> 'attachment') OR item_is_file
    ),
    CONSTRAINT placements_position_key_check CHECK (length(position_key) BETWEEN 1 AND 255)
);

CREATE INDEX placements_parent_active_idx ON placements (parent_item_id, kind);
CREATE INDEX placements_item_idx ON placements (item_id);

-- Pages and folders keep exactly one active hierarchy placement.
CREATE UNIQUE INDEX placements_single_hierarchy_unique
    ON placements (item_id)
    WHERE kind = 'hierarchy' AND removed_at IS NULL AND NOT item_is_file;

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

-- ---------------------------------------------------------------------------
-- from 0002_workspace_singleton.sql
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- from 0003_mutation_competing_revisions.sql
-- ---------------------------------------------------------------------------

ALTER TABLE mutations
    ADD COLUMN competing_revision_ids uuid[] NOT NULL DEFAULT '{}';

-- Competing identities only make sense for a rejection: an accepted mutation
-- has no competitor, and recording one would misreport the outcome.
ALTER TABLE mutations
    ADD CONSTRAINT mutations_competing_only_when_rejected CHECK (
        status = 'rejected' OR cardinality(competing_revision_ids) = 0
    );

-- ---------------------------------------------------------------------------
-- from 0004_owner_security_foundation.sql
-- ---------------------------------------------------------------------------

-- Guard: this feature owns the table names below. Refuse to apply if any
-- already exists rather than colliding with an unknown definition.
DO $$
DECLARE
  conflicting text;
BEGIN
  SELECT string_agg(table_name, ', ' ORDER BY table_name) INTO conflicting
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN (
      'installations', 'owners', 'passkey_credentials', 'password_credential_versions',
      'bootstrap_attempts', 'pending_bootstrap_credentials', 'authorized_devices', 'sessions',
      'recovery_epochs', 'recovery_kits', 'wrapping_key_versions', 'workspace_root_keys',
      'data_key_generations', 'rotation_policies', 'rotation_operations', 'rotation_checkpoints',
      'protected_envelopes', 'protected_blob_chunks', 'encryption_migrations',
      'migration_checkpoints', 'security_rate_limits', 'security_audit_events'
    );
  IF conflicting IS NOT NULL THEN
    RAISE EXCEPTION
      'migration 0004 refuses to apply: table(s) already exist: %', conflicting;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Installation
-- ---------------------------------------------------------------------------

CREATE TABLE installations (
  id uuid PRIMARY KEY,
  source_lineage_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'uninitialized',
  owner_id uuid,
  workspace_id uuid,
  schema_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installations_state_check CHECK (
    state IN ('uninitialized', 'bootstrap-in-progress', 'recovery-required',
              'ready', 'migration-in-progress', 'degraded')
  ),
  -- The count rule, structural: uninitialized means neither owner nor
  -- workspace; initialized means both. A half-committed promotion cannot be
  -- persisted, so no partial installation is ever observable.
  CONSTRAINT installations_counts_check CHECK (
    (state IN ('uninitialized', 'bootstrap-in-progress')
      AND owner_id IS NULL AND workspace_id IS NULL)
    OR
    (state IN ('recovery-required', 'ready', 'migration-in-progress', 'degraded')
      AND owner_id IS NOT NULL AND workspace_id IS NOT NULL)
  ),
  CONSTRAINT installations_schema_version_check CHECK (schema_version >= 1)
);

CREATE UNIQUE INDEX installations_singleton_idx ON installations ((true));

-- ---------------------------------------------------------------------------
-- Owner identity and credentials
-- ---------------------------------------------------------------------------

CREATE TABLE owners (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  state text NOT NULL DEFAULT 'active',
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owners_state_check CHECK (state IN ('active', 'recovery-required'))
);

CREATE UNIQUE INDEX owners_installation_unique ON owners (installation_id);

CREATE TABLE passkey_credentials (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  credential_id text NOT NULL,
  public_key text NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0,
  label text,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT passkey_credentials_state_check CHECK (state IN ('pending', 'active', 'revoked')),
  CONSTRAINT passkey_credentials_sign_count_check CHECK (sign_count >= 0),
  CONSTRAINT passkey_credentials_revoked_at_check CHECK (
    (state <> 'revoked') OR (revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX passkey_credentials_credential_id_unique
  ON passkey_credentials (credential_id);
CREATE INDEX passkey_credentials_owner_idx ON passkey_credentials (owner_id, state);

CREATE TABLE password_credential_versions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  password_hash text NOT NULL,
  hash_algorithm text NOT NULL,
  hash_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  CONSTRAINT password_credential_versions_state_check CHECK (
    state IN ('active', 'superseded', 'revoked')
  )
);

CREATE UNIQUE INDEX password_credential_versions_active_unique
  ON password_credential_versions (owner_id) WHERE state = 'active';

-- ---------------------------------------------------------------------------
-- Bootstrap (attempt-scoped: deliberately no owner foreign key)
-- ---------------------------------------------------------------------------

CREATE TABLE bootstrap_attempts (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  bootstrap_state text NOT NULL DEFAULT 'started',
  client_nonce_hash text NOT NULL,
  challenge_hash text,
  capability_hash text NOT NULL,
  download_token_hash text,
  download_expires_at timestamptz,
  download_consumed_at timestamptz,
  recovery_kit_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bootstrap_attempts_state_check CHECK (
    bootstrap_state IN ('started', 'credential-verified', 'recovery-prepared',
                        'download-consumed', 'confirmed', 'abandoned', 'rejected')
  ),
  CONSTRAINT bootstrap_attempts_download_check CHECK (
    (download_consumed_at IS NULL)
    OR (download_expires_at IS NOT NULL AND download_token_hash IS NOT NULL)
  ),
  -- Confirmation is reachable only from a consumed download.
  CONSTRAINT bootstrap_attempts_confirmation_check CHECK (
    (bootstrap_state <> 'confirmed')
    OR (download_consumed_at IS NOT NULL AND recovery_kit_id IS NOT NULL)
  )
);

-- One open attempt at a time: concurrent claims serialize here and the losers
-- fail loudly instead of each proceeding towards an owner.
CREATE UNIQUE INDEX bootstrap_attempts_open_unique
  ON bootstrap_attempts (installation_id)
  WHERE bootstrap_state IN ('started', 'credential-verified',
                            'recovery-prepared', 'download-consumed');
CREATE INDEX bootstrap_attempts_state_idx
  ON bootstrap_attempts (installation_id, bootstrap_state);

CREATE TABLE pending_bootstrap_credentials (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES bootstrap_attempts (id) ON DELETE CASCADE,
  credential_kind text NOT NULL,
  credential_id_digest text NOT NULL,
  public_key text,
  password_hash text,
  hash_algorithm text,
  hash_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin text NOT NULL,
  relying_party_id text,
  sign_count bigint NOT NULL DEFAULT 0,
  user_verified text NOT NULL DEFAULT 'false',
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT pending_bootstrap_credentials_kind_check CHECK (
    credential_kind IN ('passkey', 'password')
  ),
  CONSTRAINT pending_bootstrap_credentials_material_check CHECK (
    (credential_kind = 'passkey' AND public_key IS NOT NULL)
    OR (credential_kind = 'password' AND password_hash IS NOT NULL AND hash_algorithm IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pending_bootstrap_credentials_attempt_unique
  ON pending_bootstrap_credentials (attempt_id);

-- ---------------------------------------------------------------------------
-- Devices and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE authorized_devices (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  device_binding_id text NOT NULL,
  name text NOT NULL,
  platform text,
  client_type text NOT NULL DEFAULT 'web',
  state text NOT NULL DEFAULT 'pending',
  authorized_at timestamptz NOT NULL DEFAULT now(),
  -- Null until the first real authenticated activity event, and set only by
  -- that event. Registration, rename, inventory reads, and revocation must
  -- never synthesize it; the API returns this null verbatim.
  last_activity_at timestamptz,
  -- Same rule: null until the first successful synchronization.
  last_sync_at timestamptz,
  local_storage_limit_bytes bigint,
  local_storage_used_bytes bigint NOT NULL DEFAULT 0,
  key_protection_capability text,
  device_key_version integer NOT NULL DEFAULT 1,
  revoked_at timestamptz,
  CONSTRAINT authorized_devices_state_check CHECK (
    state IN ('pending', 'active', 'revoked', 'reauthorization-required')
  ),
  CONSTRAINT authorized_devices_client_type_check CHECK (client_type = 'web'),
  CONSTRAINT authorized_devices_revoked_at_check CHECK (
    (state <> 'revoked') OR (revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX authorized_devices_binding_unique
  ON authorized_devices (owner_id, device_binding_id);
CREATE INDEX authorized_devices_owner_state_idx ON authorized_devices (owner_id, state);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners (id),
  device_id uuid NOT NULL REFERENCES authorized_devices (id),
  session_secret_hash text NOT NULL,
  auth_method text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  recent_auth_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  -- The protected local CLI never creates a session, so it is never an
  -- auth method here.
  CONSTRAINT sessions_auth_method_check CHECK (auth_method IN ('passkey', 'password')),
  CONSTRAINT sessions_state_check CHECK (state IN ('active', 'revoked', 'expired')),
  CONSTRAINT sessions_revoked_at_check CHECK ((state <> 'revoked') OR (revoked_at IS NOT NULL))
);

CREATE UNIQUE INDEX sessions_secret_hash_unique ON sessions (session_secret_hash);
CREATE INDEX sessions_owner_state_idx ON sessions (owner_id, state);
CREATE INDEX sessions_device_idx ON sessions (device_id);

-- ---------------------------------------------------------------------------
-- Recovery
-- ---------------------------------------------------------------------------

CREATE TABLE recovery_epochs (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  epoch integer NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revocation_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT recovery_epochs_state_check CHECK (state IN ('active', 'revoked')),
  CONSTRAINT recovery_epochs_epoch_check CHECK (epoch >= 1)
);

CREATE UNIQUE INDEX recovery_epochs_epoch_unique ON recovery_epochs (installation_id, epoch);
CREATE UNIQUE INDEX recovery_epochs_active_unique
  ON recovery_epochs (installation_id) WHERE state = 'active';

CREATE TABLE recovery_kits (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  source_lineage_id uuid NOT NULL,
  recovery_epoch integer NOT NULL,
  authorization_state text NOT NULL,
  delivery_state text NOT NULL,
  format text NOT NULL DEFAULT 'myownnotion.recovery+json',
  format_version integer NOT NULL DEFAULT 1,
  supported_key_generations integer[] NOT NULL,
  artifact_digest text NOT NULL,
  download_token_hash text,
  download_expires_at timestamptz,
  download_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  superseded_at timestamptz,
  revoked_at timestamptz,
  -- The seven legal pairs, exhaustively. Every other combination — including
  -- `provisional/expired` and a `provisional/confirmed` shortcut that would
  -- bypass offline confirmation — is rejected by the database itself.
  CONSTRAINT recovery_kits_state_pair_check CHECK (
    (authorization_state, delivery_state) IN (
      ('provisional', 'prepared'),
      ('provisional', 'downloadable'),
      ('provisional', 'download-consumed'),
      ('active', 'confirmed'),
      ('superseded', 'confirmed'),
      ('revoked', 'confirmed'),
      ('rejected', 'expired')
    )
  ),
  CONSTRAINT recovery_kits_confirmed_at_check CHECK (
    (delivery_state <> 'confirmed') OR (confirmed_at IS NOT NULL)
  ),
  CONSTRAINT recovery_kits_consumed_at_check CHECK (
    (delivery_state <> 'download-consumed') OR (download_consumed_at IS NOT NULL)
  ),
  CONSTRAINT recovery_kits_generations_check CHECK (
    cardinality(supported_key_generations) >= 1
  )
);

CREATE INDEX recovery_kits_installation_idx
  ON recovery_kits (installation_id, authorization_state);
CREATE UNIQUE INDEX recovery_kits_active_unique
  ON recovery_kits (installation_id) WHERE authorization_state = 'active';

-- ---------------------------------------------------------------------------
-- Key hierarchy
-- ---------------------------------------------------------------------------

CREATE TABLE wrapping_key_versions (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  version integer NOT NULL,
  -- A reference to the mounted secret, never the secret bytes.
  external_secret_reference text NOT NULL,
  algorithm text NOT NULL,
  state text NOT NULL DEFAULT 'current',
  availability_checked_at timestamptz,
  availability_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT wrapping_key_versions_state_check CHECK (
    state IN ('current', 'previous', 'revoked')
  ),
  CONSTRAINT wrapping_key_versions_version_check CHECK (version >= 1)
);

CREATE UNIQUE INDEX wrapping_key_versions_version_unique
  ON wrapping_key_versions (installation_id, version);
CREATE UNIQUE INDEX wrapping_key_versions_current_unique
  ON wrapping_key_versions (installation_id) WHERE state = 'current';

CREATE TABLE workspace_root_keys (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid NOT NULL,
  wrapping_key_version_id uuid NOT NULL REFERENCES wrapping_key_versions (id),
  wrapped_root_key text NOT NULL,
  root_key_version integer NOT NULL,
  state text NOT NULL DEFAULT 'active',
  rewrap_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT workspace_root_keys_state_check CHECK (
    state IN ('active', 'previous', 'revoked')
  )
);

CREATE UNIQUE INDEX workspace_root_keys_version_unique
  ON workspace_root_keys (workspace_id, root_key_version);
CREATE UNIQUE INDEX workspace_root_keys_active_unique
  ON workspace_root_keys (workspace_id) WHERE state = 'active';

CREATE TABLE data_key_generations (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid NOT NULL,
  generation integer NOT NULL,
  wrapped_key_material text NOT NULL,
  -- `decrypt-only` keeps records written under a prior generation readable.
  state text NOT NULL DEFAULT 'current',
  record_count bigint NOT NULL DEFAULT 0,
  chunk_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT data_key_generations_state_check CHECK (
    state IN ('current', 'decrypt-only', 'revoked')
  ),
  CONSTRAINT data_key_generations_generation_check CHECK (generation >= 1)
);

CREATE UNIQUE INDEX data_key_generations_generation_unique
  ON data_key_generations (workspace_id, generation);
CREATE UNIQUE INDEX data_key_generations_current_unique
  ON data_key_generations (workspace_id) WHERE state = 'current';

-- ---------------------------------------------------------------------------
-- Rotation
-- ---------------------------------------------------------------------------

CREATE TABLE rotation_policies (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  kind text NOT NULL,
  mode text NOT NULL DEFAULT 'scheduled',
  due_interval_days integer NOT NULL,
  due_at timestamptz NOT NULL,
  write_block_at timestamptz NOT NULL,
  last_completed_at timestamptz,
  current_generation integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'pre-due',
  last_operation_id uuid,
  next_action text NOT NULL DEFAULT 'none',
  last_failure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rotation_policies_kind_check CHECK (kind IN ('wrapping-key', 'data-key')),
  CONSTRAINT rotation_policies_mode_check CHECK (mode IN ('scheduled', 'emergency')),
  CONSTRAINT rotation_policies_state_check CHECK (
    state IN ('pre-due', 'due', 'overdue-within-grace', 'emergency',
              'write-block', 'in-progress', 'complete', 'failed')
  ),
  -- Emergency has zero grace, so the block may land on the due date itself.
  CONSTRAINT rotation_policies_write_block_check CHECK (write_block_at >= due_at),
  CONSTRAINT rotation_policies_interval_check CHECK (due_interval_days >= 1)
);

-- Exactly one policy per kind: wrapping-key and data-key are separate
-- namespaces with separate operation streams.
CREATE UNIQUE INDEX rotation_policies_kind_unique ON rotation_policies (installation_id, kind);

CREATE TABLE rotation_operations (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  policy_id uuid NOT NULL REFERENCES rotation_policies (id),
  kind text NOT NULL,
  mode text NOT NULL,
  from_version_or_generation integer NOT NULL,
  to_version_or_generation integer NOT NULL,
  phase text NOT NULL DEFAULT 'planned',
  audit_reason text,
  cursor text NOT NULL DEFAULT '',
  processed_count bigint NOT NULL DEFAULT 0,
  total_count bigint NOT NULL DEFAULT 0,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rotation_operations_kind_check CHECK (kind IN ('wrapping-key', 'data-key')),
  CONSTRAINT rotation_operations_mode_check CHECK (mode IN ('scheduled', 'emergency')),
  CONSTRAINT rotation_operations_phase_check CHECK (
    phase IN ('planned', 'prepared', 'rewrapping', 'rewriting',
              'committing', 'complete', 'failed')
  ),
  CONSTRAINT rotation_operations_progression_check CHECK (
    to_version_or_generation > from_version_or_generation
  )
);

-- At most one operation in flight per policy.
CREATE UNIQUE INDEX rotation_operations_active_unique
  ON rotation_operations (policy_id)
  WHERE phase IN ('planned', 'prepared', 'rewrapping', 'rewriting', 'committing');
CREATE INDEX rotation_operations_policy_idx ON rotation_operations (policy_id, phase);

CREATE TABLE rotation_checkpoints (
  id uuid PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES rotation_operations (id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  cursor text NOT NULL,
  processed_count bigint NOT NULL DEFAULT 0,
  total_count bigint NOT NULL DEFAULT 0,
  checkpoint_digest text NOT NULL,
  -- A replay with the same key returns the prior result, never a duplicate.
  idempotency_key text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rotation_checkpoints_sequence_check CHECK (sequence >= 0)
);

CREATE UNIQUE INDEX rotation_checkpoints_sequence_unique
  ON rotation_checkpoints (operation_id, sequence);
CREATE UNIQUE INDEX rotation_checkpoints_idempotency_unique
  ON rotation_checkpoints (operation_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- Protected records and chunks
-- ---------------------------------------------------------------------------

CREATE TABLE protected_envelopes (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid NOT NULL,
  entity_type text NOT NULL,
  -- Feature-001 entity ID, verbatim. No foreign key: the envelope must outlive
  -- the plaintext row that a migration will eventually scrub.
  entity_id uuid NOT NULL,
  key_generation integer NOT NULL,
  record_version integer NOT NULL,
  format text NOT NULL DEFAULT 'mn.enc.v1',
  algorithm text NOT NULL DEFAULT 'AES-256-GCM+HKDF-SHA-256',
  salt text NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL,
  tag text NOT NULL,
  aad_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protected_envelopes_format_check CHECK (format = 'mn.enc.v1'),
  CONSTRAINT protected_envelopes_algorithm_check CHECK (
    algorithm = 'AES-256-GCM+HKDF-SHA-256'
  ),
  CONSTRAINT protected_envelopes_generation_check CHECK (key_generation >= 1),
  CONSTRAINT protected_envelopes_record_version_check CHECK (record_version >= 1)
);

CREATE UNIQUE INDEX protected_envelopes_entity_unique
  ON protected_envelopes (entity_type, entity_id, record_version);
CREATE INDEX protected_envelopes_generation_idx
  ON protected_envelopes (workspace_id, key_generation);

CREATE TABLE protected_blob_chunks (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid NOT NULL,
  content_id uuid NOT NULL,
  chunk_index integer NOT NULL,
  key_generation integer NOT NULL,
  record_version integer NOT NULL DEFAULT 1,
  storage_key text NOT NULL,
  salt text NOT NULL,
  nonce text NOT NULL,
  tag text NOT NULL,
  aad_digest text NOT NULL,
  byte_length bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protected_blob_chunks_index_check CHECK (chunk_index >= 0),
  CONSTRAINT protected_blob_chunks_length_check CHECK (byte_length >= 0)
);

CREATE UNIQUE INDEX protected_blob_chunks_chunk_unique
  ON protected_blob_chunks (content_id, chunk_index);
CREATE UNIQUE INDEX protected_blob_chunks_storage_key_unique
  ON protected_blob_chunks (storage_key);
CREATE INDEX protected_blob_chunks_generation_idx
  ON protected_blob_chunks (workspace_id, key_generation);

-- ---------------------------------------------------------------------------
-- Plaintext migration
-- ---------------------------------------------------------------------------

CREATE TABLE encryption_migrations (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid NOT NULL,
  source_schema_version integer NOT NULL,
  destination_schema_version integer NOT NULL,
  state text NOT NULL DEFAULT 'prepare-destinations',
  source_retained text NOT NULL DEFAULT 'true',
  source_count bigint NOT NULL DEFAULT 0,
  destination_count bigint NOT NULL DEFAULT 0,
  source_digest text,
  destination_digest text,
  identity_digest text,
  cursor text NOT NULL DEFAULT '',
  last_safe_checkpoint_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encryption_migrations_state_check CHECK (
    state IN ('prepare-destinations', 'capture-boundary', 'backfill', 'verify',
              'stop-plaintext-writes', 'encrypted-read-cutover', 'scrub-plaintext',
              'complete', 'failed')
  ),
  -- Plaintext may only be released after the read cutover has happened, so no
  -- fault can destroy data that is still the only copy.
  CONSTRAINT encryption_migrations_retention_check CHECK (
    (source_retained = 'true') OR (state IN ('scrub-plaintext', 'complete'))
  )
);

CREATE UNIQUE INDEX encryption_migrations_installation_unique
  ON encryption_migrations (installation_id);

CREATE TABLE migration_checkpoints (
  id uuid PRIMARY KEY,
  migration_id uuid NOT NULL REFERENCES encryption_migrations (id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  state text NOT NULL,
  source_cursor text NOT NULL,
  destination_cursor text NOT NULL,
  batch_count bigint NOT NULL DEFAULT 0,
  record_count bigint NOT NULL DEFAULT 0,
  blob_count bigint NOT NULL DEFAULT 0,
  identity_digest text NOT NULL,
  checkpoint_digest text NOT NULL,
  fault_point text,
  idempotency_key text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT migration_checkpoints_sequence_check CHECK (sequence >= 0)
);

CREATE UNIQUE INDEX migration_checkpoints_sequence_unique
  ON migration_checkpoints (migration_id, sequence);
CREATE UNIQUE INDEX migration_checkpoints_idempotency_unique
  ON migration_checkpoints (migration_id, idempotency_key);

-- ---------------------------------------------------------------------------
-- Rate limiting and audit
-- ---------------------------------------------------------------------------

CREATE TABLE security_rate_limits (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  -- Opaque bucket key: an operation class plus a hashed subject.
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_rate_limits_count_check CHECK (attempt_count >= 0)
);

CREATE UNIQUE INDEX security_rate_limits_bucket_unique
  ON security_rate_limits (installation_id, bucket_key);

CREATE TABLE security_audit_events (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  workspace_id uuid,
  event_type text NOT NULL,
  outcome text NOT NULL,
  actor_class text NOT NULL,
  correlation_id text NOT NULL,
  safe_code text,
  object_kind text,
  object_id text,
  -- Redacted metadata only. The audit repository runs every payload through
  -- `redact()` and refuses a row that still carries a forbidden field, so no
  -- content, credential, token, capability, kit, or key material lands here.
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_audit_events_outcome_check CHECK (
    outcome IN ('success', 'failure', 'refused', 'started')
  ),
  CONSTRAINT security_audit_events_actor_check CHECK (
    actor_class IN ('owner', 'hosting-admin', 'system')
  )
);

CREATE INDEX security_audit_events_occurred_idx
  ON security_audit_events (installation_id, occurred_at);
CREATE INDEX security_audit_events_type_idx
  ON security_audit_events (installation_id, event_type);

-- Each migration records itself, matching 0001–0003: the runner skips a
-- version already present, so without this the whole file would be replayed on
-- the next run and the existence guard above would abort it.

-- ---------------------------------------------------------------------------
-- from 0005_wrapping_key_pending_state.sql
-- ---------------------------------------------------------------------------

ALTER TABLE wrapping_key_versions
  DROP CONSTRAINT wrapping_key_versions_state_check;

ALTER TABLE wrapping_key_versions
  ADD CONSTRAINT wrapping_key_versions_state_check
  CHECK (state IN ('current', 'pending', 'previous', 'revoked'));

-- Each migration records itself, matching 0001–0004: the runner skips a
-- version already present, so without this the file would be replayed on the
-- next run and the DROP CONSTRAINT would fail against the already-widened
-- constraint.

-- ===========================================================================
-- from 0002_favourites.sql
-- ===========================================================================
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


-- Idempotent, like every migration here: the runner skips a version already
-- recorded, and the guards below keep a manual replay harmless too.
ALTER TABLE items ADD COLUMN IF NOT EXISTS favourite boolean NOT NULL DEFAULT false;

-- Partial: the index exists to answer "what are the favourites", and the false
-- rows are the overwhelming majority of a workspace.
CREATE INDEX IF NOT EXISTS items_favourite_idx ON items (workspace_id) WHERE favourite;

-- Each migration records itself; the runner reads this table to decide what to
-- skip, and a file that does not write it is replayed on the next run.

-- ===========================================================================
-- from 0003_files_and_offline.sql
-- ===========================================================================
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

-- ===========================================================================
-- from 0004_revision_device.sql
-- ===========================================================================
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


ALTER TABLE revisions ADD COLUMN IF NOT EXISTS authored_by_device_id uuid
    REFERENCES authorized_devices (id);

-- Partial: the question this answers is "which device wrote this", asked while
-- reading one item's history, and the rows that predate the feature carry null.
CREATE INDEX IF NOT EXISTS revisions_device_idx
    ON revisions (authored_by_device_id) WHERE authored_by_device_id IS NOT NULL;

-- ===========================================================================
-- from 0005_backups.sql
-- ===========================================================================
-- Backups, their verifications, and restoration attempts (feature 007).
--
-- Three tables rather than one, and the second is the one worth explaining.
--
-- A backup is verified after creation *and* again after transfer, and those are
-- different facts with different failure modes: an archive can be sound on disk
-- and corrupt at the destination. A `verified` column would collapse them, and
-- FR-011 has to tell "not verified because not transferred" from "verified and
-- failed" before it deletes anything.
--
-- Verifications are therefore rows: a verification is an event that happened at
-- a time, and a backup can be checked again later — after a destination outage,
-- or because the owner asked. Columns would keep only the last answer and would
-- silently overwrite the history of a backup that passed and then failed.


CREATE TABLE IF NOT EXISTS backups (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- The change-feed position this archive represents. Consistency is not a
    -- separate mechanism here: the product already orders every change, so "one
    -- moment" is a number it already has.
    cursor text NOT NULL,
    application_version text NOT NULL,
    schema_version integer NOT NULL,
    record_format_version integer NOT NULL,
    byte_length bigint NOT NULL,
    digest text NOT NULL,
    -- Null while the archive exists only locally. A backup that was produced and
    -- never transferred is a real state, and one that must not be mistaken for a
    -- failure.
    destination text,
    remote_name text,
    reason text NOT NULL DEFAULT 'scheduled',
    -- For a pre-update backup: the version being moved to. Null otherwise.
    superseded_by_version text,
    CONSTRAINT backups_reason_check
        CHECK (reason IN ('scheduled', 'manual', 'pre-update')),
    -- A destination without a name there is a backup nothing can delete or
    -- re-verify, which is worse than one that was never transferred.
    CONSTRAINT backups_remote_pair_check
        CHECK ((destination IS NULL) = (remote_name IS NULL))
);

CREATE INDEX IF NOT EXISTS backups_created_idx
    ON backups (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS backup_verifications (
    id uuid PRIMARY KEY,
    backup_id uuid NOT NULL REFERENCES backups (id) ON DELETE CASCADE,
    stage text NOT NULL,
    checked_at timestamptz NOT NULL DEFAULT now(),
    outcome text NOT NULL,
    -- A safe reason for a failure. Never a path, never a credential, never
    -- anything read out of the archive.
    detail text,
    CONSTRAINT backup_verifications_stage_check
        CHECK (stage IN ('after-creation', 'after-transfer')),
    CONSTRAINT backup_verifications_outcome_check
        CHECK (outcome IN ('passed', 'failed'))
);

-- The index behind the only question retention asks: is there a backup whose
-- after-transfer verification passed, more recent than the one I am about to
-- delete?
CREATE INDEX IF NOT EXISTS backup_verifications_passed_idx
    ON backup_verifications (backup_id, stage, checked_at DESC)
    WHERE outcome = 'passed';

CREATE TABLE IF NOT EXISTS restoration_attempts (
    id uuid PRIMARY KEY,
    backup_id uuid NOT NULL REFERENCES backups (id),
    started_at timestamptz NOT NULL DEFAULT now(),
    -- Null while running. A row left null by a process that is no longer alive
    -- *is* the interrupted state FR-017 is about: the installation reads it at
    -- startup and refuses to present itself as healthy, rather than inferring
    -- health from the absence of an error.
    finished_at timestamptz,
    kind text NOT NULL,
    outcome text,
    detail text,
    restored_item_count integer,
    CONSTRAINT restoration_attempts_kind_check
        CHECK (kind IN ('test', 'destructive')),
    CONSTRAINT restoration_attempts_outcome_check
        CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed')),
    -- Finished means decided. A row with an end and no verdict would be an
    -- interruption that looks complete.
    CONSTRAINT restoration_attempts_finished_check
        CHECK ((finished_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX IF NOT EXISTS restoration_attempts_unfinished_idx
    ON restoration_attempts (started_at DESC) WHERE finished_at IS NULL;

CREATE INDEX IF NOT EXISTS restoration_attempts_tests_idx
    ON restoration_attempts (started_at DESC) WHERE kind = 'test';

-- ===========================================================================
-- from 0006_installation_application_version.sql
-- ===========================================================================
-- The application version an installation last ran (feature 007, FR-021, FR-022).
--
-- `installations` already records the *schema* version, which is what decides
-- whether data can be read. It does not record which build wrote it, and the
-- update guard needs exactly that: a container image change is invisible to the
-- process being replaced and visible to the one starting, but only if the
-- starting process can compare itself against something.
--
-- Nullable, and deliberately so. An installation that predates this column has
-- never recorded a version, and the first startup after this migration must not
-- read that silence as "the version changed" — it would demand a backup of a
-- version nobody can name, and refuse to migrate on the strength of it. Null
-- means "unknown", which the guard treats as "record it and carry on".


ALTER TABLE installations ADD COLUMN IF NOT EXISTS application_version text;

-- What the previous version was, and which backup belongs to it. Kept so an
-- owner can be told how to return rather than having to work it out (FR-025).
ALTER TABLE installations ADD COLUMN IF NOT EXISTS previous_application_version text;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS previous_backup_id uuid
    REFERENCES backups (id);

-- ===========================================================================
-- from 0007_databases.sql
-- ===========================================================================
-- Page-backed databases and their entry memberships (feature 009).
--
-- Only structural routing data is stored here. Definitions and values are
-- protected records keyed by item identity and the monotonic versions below;
-- no property label, filter or value is available to a database dump.


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

-- ===========================================================================
-- from 0008_page_operations.sql
-- ===========================================================================
-- Convergent page-operation state (feature 017).
--
-- Routing, identities and monotonic sequences remain queryable. Checkpoints,
-- version vectors, updates and ambiguity details are referenced through the
-- existing protected-envelope store; no owner-authored page content is added
-- to these tables in clear text.


CREATE TABLE page_operation_states (
    page_id uuid PRIMARY KEY REFERENCES items (id),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    status text NOT NULL DEFAULT 'initializing',
    operational_format text NOT NULL DEFAULT 'myownnotion.page-operations+loro',
    operational_version integer NOT NULL DEFAULT 1,
    current_checkpoint_id uuid,
    current_frontier_envelope_id uuid REFERENCES protected_envelopes (id),
    operational_digest text,
    canonical_digest text NOT NULL,
    canonical_format_version integer NOT NULL,
    last_update_sequence bigint NOT NULL DEFAULT 0,
    last_revision_id uuid REFERENCES revisions (id),
    revision_window_started_at timestamptz,
    revision_window_last_update_at timestamptz,
    revision_window_frontier_envelope_id uuid REFERENCES protected_envelopes (id),
    bootstrapped_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT page_operation_states_item_workspace_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES items (id, workspace_id),
    CONSTRAINT page_operation_states_status_check
        CHECK (status IN ('legacy', 'initializing', 'active', 'blocked')),
    CONSTRAINT page_operation_states_format_check
        CHECK (operational_format = 'myownnotion.page-operations+loro'),
    CONSTRAINT page_operation_states_version_check
        CHECK (operational_version >= 1),
    CONSTRAINT page_operation_states_canonical_version_check
        CHECK (canonical_format_version IN (2, 3)),
    CONSTRAINT page_operation_states_sequence_check
        CHECK (last_update_sequence >= 0),
    CONSTRAINT page_operation_states_digest_check
        CHECK (
            canonical_digest ~ '^[0-9a-f]{64}$'
            AND (operational_digest IS NULL OR operational_digest ~ '^[0-9a-f]{64}$')
        ),
    CONSTRAINT page_operation_states_active_complete_check
        CHECK (
            status <> 'active'
            OR (
                canonical_format_version = 3
                AND current_checkpoint_id IS NOT NULL
                AND current_frontier_envelope_id IS NOT NULL
                AND operational_digest IS NOT NULL
                AND bootstrapped_at IS NOT NULL
            )
        ),
    CONSTRAINT page_operation_states_revision_window_check
        CHECK (
            (revision_window_started_at IS NULL
             AND revision_window_last_update_at IS NULL
             AND revision_window_frontier_envelope_id IS NULL)
            OR
            (revision_window_started_at IS NOT NULL
             AND revision_window_last_update_at IS NOT NULL
             AND revision_window_frontier_envelope_id IS NOT NULL
             AND revision_window_last_update_at >= revision_window_started_at)
        )
);

CREATE UNIQUE INDEX page_operation_states_page_workspace_unique
    ON page_operation_states (page_id, workspace_id);
CREATE INDEX page_operation_states_workspace_status_idx
    ON page_operation_states (workspace_id, status);

CREATE TABLE page_operation_updates (
    id uuid PRIMARY KEY,
    page_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    page_sequence bigint NOT NULL,
    authored_by_device_id uuid NOT NULL REFERENCES authorized_devices (id),
    base_frontier_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    result_frontier_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    update_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    update_digest text NOT NULL,
    status text NOT NULL,
    failure_code text,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT page_operation_updates_state_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES page_operation_states (page_id, workspace_id),
    CONSTRAINT page_operation_updates_sequence_unique
        UNIQUE (page_id, page_sequence),
    CONSTRAINT page_operation_updates_sequence_check
        CHECK (page_sequence >= 1),
    CONSTRAINT page_operation_updates_digest_check
        CHECK (update_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT page_operation_updates_status_check
        CHECK (status IN ('accepted', 'rejected')),
    CONSTRAINT page_operation_updates_failure_check
        CHECK ((status = 'accepted') = (failure_code IS NULL))
);

CREATE INDEX page_operation_updates_page_sequence_idx
    ON page_operation_updates (page_id, page_sequence);
CREATE INDEX page_operation_updates_workspace_device_idx
    ON page_operation_updates (workspace_id, authored_by_device_id, accepted_at);

CREATE TABLE page_operation_checkpoints (
    id uuid PRIMARY KEY,
    page_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    through_page_sequence bigint NOT NULL,
    frontier_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    snapshot_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    snapshot_digest text NOT NULL,
    canonical_digest text NOT NULL,
    revision_id uuid REFERENCES revisions (id),
    state text NOT NULL DEFAULT 'candidate',
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz,
    CONSTRAINT page_operation_checkpoints_state_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES page_operation_states (page_id, workspace_id),
    CONSTRAINT page_operation_checkpoints_id_page_unique
        UNIQUE (id, page_id),
    CONSTRAINT page_operation_checkpoints_page_sequence_unique
        UNIQUE (page_id, through_page_sequence),
    CONSTRAINT page_operation_checkpoints_sequence_check
        CHECK (through_page_sequence >= 0),
    CONSTRAINT page_operation_checkpoints_digest_check
        CHECK (
            snapshot_digest ~ '^[0-9a-f]{64}$'
            AND canonical_digest ~ '^[0-9a-f]{64}$'
        ),
    CONSTRAINT page_operation_checkpoints_state_check
        CHECK (state IN ('candidate', 'verified', 'superseded', 'retained')),
    CONSTRAINT page_operation_checkpoints_verified_check
        CHECK ((state = 'candidate' AND verified_at IS NULL) OR (state <> 'candidate' AND verified_at IS NOT NULL))
);

CREATE INDEX page_operation_checkpoints_page_state_idx
    ON page_operation_checkpoints (page_id, state, through_page_sequence DESC);

ALTER TABLE page_operation_states
    ADD CONSTRAINT page_operation_states_current_checkpoint_fk
    FOREIGN KEY (current_checkpoint_id, page_id)
    REFERENCES page_operation_checkpoints (id, page_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE page_device_frontiers (
    page_id uuid NOT NULL,
    device_id uuid NOT NULL REFERENCES authorized_devices (id),
    workspace_id uuid NOT NULL,
    frontier_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    frontier_digest text NOT NULL,
    confirmed_page_sequence bigint NOT NULL,
    record_version integer NOT NULL DEFAULT 1,
    last_confirmed_at timestamptz NOT NULL DEFAULT now(),
    device_state text NOT NULL,
    PRIMARY KEY (page_id, device_id),
    CONSTRAINT page_device_frontiers_state_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES page_operation_states (page_id, workspace_id),
    CONSTRAINT page_device_frontiers_digest_check
        CHECK (frontier_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT page_device_frontiers_sequence_check
        CHECK (confirmed_page_sequence >= 0),
    CONSTRAINT page_device_frontiers_record_version_check
        CHECK (record_version >= 1),
    CONSTRAINT page_device_frontiers_device_state_check
        CHECK (device_state IN ('authorized', 'revoked'))
);

CREATE INDEX page_device_frontiers_device_idx
    ON page_device_frontiers (device_id, device_state);

CREATE OR REPLACE FUNCTION prevent_page_frontier_retreat()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.confirmed_page_sequence < OLD.confirmed_page_sequence
       OR NEW.record_version <= OLD.record_version THEN
        RAISE EXCEPTION 'page device frontier cannot retreat or reuse a version'
            USING ERRCODE = '23514', CONSTRAINT = 'page_device_frontiers_no_retreat_guard';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER page_device_frontiers_no_retreat_guard
    BEFORE UPDATE ON page_device_frontiers
    FOR EACH ROW EXECUTE FUNCTION prevent_page_frontier_retreat();

CREATE TABLE page_ambiguities (
    id uuid PRIMARY KEY,
    page_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    logical_key text NOT NULL,
    kind text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    details_envelope_id uuid NOT NULL REFERENCES protected_envelopes (id),
    source_update_ids uuid[] NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz,
    resolution_revision_id uuid REFERENCES revisions (id),
    CONSTRAINT page_ambiguities_state_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES page_operation_states (page_id, workspace_id),
    CONSTRAINT page_ambiguities_logical_unique
        UNIQUE (page_id, logical_key),
    CONSTRAINT page_ambiguities_kind_check
        CHECK (kind IN ('delete-edit', 'delete-move', 'type-transform', 'property-transform', 'schema')),
    CONSTRAINT page_ambiguities_status_check
        CHECK (status IN ('open', 'resolved-keep', 'resolved-delete', 'resolved-custom')),
    CONSTRAINT page_ambiguities_sources_check
        CHECK (cardinality(source_update_ids) >= 1),
    CONSTRAINT page_ambiguities_resolution_check
        CHECK (
            (status = 'open' AND resolved_at IS NULL AND resolution_revision_id IS NULL)
            OR
            (status <> 'open' AND resolved_at IS NOT NULL AND resolution_revision_id IS NOT NULL)
        )
);

CREATE INDEX page_ambiguities_page_status_idx
    ON page_ambiguities (page_id, status, opened_at);
CREATE INDEX page_ambiguities_sources_idx
    ON page_ambiguities USING gin (source_update_ids);

-- Idempotence record for the migration-only legacy branch path. The complete
-- response remains sealed; only identities and state are routable.
CREATE TABLE page_legacy_branch_conversions (
    branch_id uuid PRIMARY KEY,
    page_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    request_digest text NOT NULL,
    status text NOT NULL,
    response_envelope_id uuid REFERENCES protected_envelopes (id),
    checkpoint_id uuid REFERENCES page_operation_checkpoints (id),
    conversion_update_ids uuid[] NOT NULL DEFAULT '{}',
    local_document_digest text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    converted_at timestamptz,
    CONSTRAINT page_legacy_branch_conversions_state_fk
        FOREIGN KEY (page_id, workspace_id)
        REFERENCES page_operation_states (page_id, workspace_id),
    CONSTRAINT page_legacy_branch_conversions_digest_check
        CHECK (
            request_digest ~ '^[0-9a-f]{64}$'
            AND local_document_digest ~ '^[0-9a-f]{64}$'
        ),
    CONSTRAINT page_legacy_branch_conversions_status_check
        CHECK (status IN ('sending', 'converted', 'blocked')),
    CONSTRAINT page_legacy_branch_conversions_result_check
        CHECK (
            status <> 'converted'
            OR (
                response_envelope_id IS NOT NULL
                AND checkpoint_id IS NOT NULL
                AND converted_at IS NOT NULL
            )
        )
);

CREATE INDEX page_legacy_branch_conversions_page_idx
    ON page_legacy_branch_conversions (page_id, status);

-- Operational state can only attach to a canonical page. The reverse trigger
-- prevents a later page→folder conversion from stranding an active oplog.
CREATE OR REPLACE FUNCTION enforce_page_operation_page_kind()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM items
         WHERE id = NEW.page_id
           AND workspace_id = NEW.workspace_id
           AND kind = 'page'
    ) THEN
        RAISE EXCEPTION 'page operation state must belong to a page'
            USING ERRCODE = '23514', CONSTRAINT = 'page_operation_states_page_kind_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER page_operation_states_page_kind_check
    BEFORE INSERT OR UPDATE OF page_id, workspace_id ON page_operation_states
    FOR EACH ROW EXECUTE FUNCTION enforce_page_operation_page_kind();

CREATE OR REPLACE FUNCTION prevent_operational_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.kind <> 'page'
       AND EXISTS (SELECT 1 FROM page_operation_states WHERE page_id = OLD.id) THEN
        RAISE EXCEPTION 'operational page cannot change kind'
            USING ERRCODE = '23514', CONSTRAINT = 'operational_page_kind_change_check';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER items_operational_page_kind_guard
    BEFORE UPDATE OF kind ON items
    FOR EACH ROW WHEN (OLD.kind IS DISTINCT FROM NEW.kind)
    EXECUTE FUNCTION prevent_operational_page_kind_change();

CREATE OR REPLACE FUNCTION enforce_verified_current_page_checkpoint()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.current_checkpoint_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM page_operation_checkpoints
         WHERE id = NEW.current_checkpoint_id
           AND page_id = NEW.page_id
           AND state IN ('verified', 'retained')
    ) THEN
        RAISE EXCEPTION 'current page checkpoint must be verified'
            USING ERRCODE = '23514', CONSTRAINT = 'page_operation_current_checkpoint_verified';
    END IF;
    RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER page_operation_current_checkpoint_verified
    AFTER INSERT OR UPDATE OF current_checkpoint_id, status ON page_operation_states
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION enforce_verified_current_page_checkpoint();

-- ===========================================================================
-- from 0009_page_operation_compaction.sql
-- ===========================================================================
-- Lossless compaction receipts for convergent page operations (feature 017).
--
-- Once a verified shallow checkpoint is safe for every authorized device, the
-- bulky update bytes and their base frontier can be removed. The immutable
-- update row, digest, original sequence and result frontier remain forever as
-- the idempotence receipt, so replaying an old request still returns the same
-- accepted event instead of inserting it again under a new sequence.


ALTER TABLE page_operation_updates
    ALTER COLUMN base_frontier_envelope_id DROP NOT NULL,
    ALTER COLUMN update_envelope_id DROP NOT NULL,
    ADD COLUMN compacted_at timestamptz;

ALTER TABLE page_operation_updates
    ADD CONSTRAINT page_operation_updates_compaction_check
    CHECK (
        (
            compacted_at IS NULL
            AND base_frontier_envelope_id IS NOT NULL
            AND update_envelope_id IS NOT NULL
        )
        OR
        (
            compacted_at IS NOT NULL
            AND status = 'accepted'
            AND base_frontier_envelope_id IS NULL
            AND update_envelope_id IS NULL
        )
    );

CREATE INDEX page_operation_updates_compaction_idx
    ON page_operation_updates (page_id, page_sequence)
    WHERE status = 'accepted' AND compacted_at IS NULL;

-- ===========================================================================
-- from 0010_page_operation_backups.sql
-- ===========================================================================
-- Verified backup coverage for operational checkpoints (feature 017).
--
-- A checkpoint may release covered update payloads only after the exact
-- checkpoint has travelled to, and been read back from, a backup destination.
-- The foreign key deliberately restricts deletion of that evidence until a
-- newer verified backup covers the checkpoint.


ALTER TABLE page_operation_checkpoints
    ADD COLUMN verified_backup_id uuid REFERENCES backups (id);

CREATE INDEX page_operation_checkpoints_backup_idx
    ON page_operation_checkpoints (verified_backup_id);

-- ===========================================================================
-- from 0011_page_operation_compaction_indexes.sql
-- ===========================================================================
-- Foreign-key support indexes for bounded page-operation compaction (feature 017).
--
-- PostgreSQL does not create indexes on referencing columns automatically.
-- Removing covered protected envelopes otherwise makes each parent-row delete
-- scan the complete update log once for base_frontier_envelope_id and once for
-- update_envelope_id, turning a 10,000-update compaction into quadratic work.


CREATE INDEX page_operation_updates_base_frontier_envelope_idx
    ON page_operation_updates (base_frontier_envelope_id);

CREATE INDEX page_operation_updates_update_envelope_idx
    ON page_operation_updates (update_envelope_id);

-- ===========================================================================
-- from 0012_upload_attachment_parent.sql
-- ===========================================================================
-- Preserve the page that initiated an editor upload until its bytes are
-- verified and the logical file can be created atomically as an attachment.
--
-- This column intentionally has no foreign key. If the owner deletes the page
-- while a transfer is interrupted, the upload keeps the original intent and
-- finalization refuses the invalid placement instead of silently moving the
-- file to the workspace root.


ALTER TABLE uploads
    ADD COLUMN attachment_parent_item_id uuid;

-- ===========================================================================
-- from 0013_item_icons.sql
-- ===========================================================================
ALTER TABLE items
  ADD COLUMN icon text;

ALTER TABLE items
  ADD CONSTRAINT items_icon_length_check
    CHECK (icon IS NULL OR length(icon) BETWEEN 1 AND 64),
  ADD CONSTRAINT items_file_icon_check
    CHECK (kind <> 'file' OR icon IS NULL);

-- ===========================================================================
-- from 0014_full_backup_provenance.sql
-- ===========================================================================
-- Full-archive identities remain usable without the portable backup catalogue.
-- This migration itself must be preceded by a verified full backup on old data.

ALTER TABLE installations ADD COLUMN application_commit text;
ALTER TABLE installations ADD COLUMN application_image text;
ALTER TABLE installations ADD COLUMN previous_full_backup_id uuid;
ALTER TABLE installations ADD CONSTRAINT installations_application_commit_check
    CHECK (application_commit IS NULL OR application_commit ~ '^[0-9a-f]{40,64}$');

-- ===========================================================================
-- from 0015_protected_file_storage.sql
-- ===========================================================================
-- Additive storage metadata only. The guarded application update must first
-- verify a complete source backup, then resume and verify encrypted cutover.

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
    content_id uuid NOT NULL REFERENCES file_contents(id),
    storage_key text UNIQUE CHECK (storage_key ~ '^[0-9a-f]{64}$'),
    manifest_envelope_id uuid NOT NULL REFERENCES protected_envelopes(id),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- from 0016_linked_databases.sql
-- ===========================================================================
-- Independent resource revisions. The historical item_id is an opaque source
-- identity, not a host lifecycle FK. Existing encrypted payloads retain AAD.

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

-- ===========================================================================
-- from 0017_mcp_access.sql
-- ===========================================================================
CREATE TABLE mcp_connections (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  owner_id uuid NOT NULL REFERENCES owners(id),
  authorized_by_device_id uuid NOT NULL REFERENCES authorized_devices(id),
  scope jsonb NOT NULL CHECK (jsonb_typeof(scope) = 'object'),
  access_hash text UNIQUE CHECK (access_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE TABLE mcp_exchange_tokens (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE mcp_mutations (
  mutation_id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES mcp_connections(id),
  action text NOT NULL,
  target_id uuid NOT NULL
);
ALTER TABLE security_audit_events DROP CONSTRAINT security_audit_events_actor_check;
ALTER TABLE security_audit_events ADD CONSTRAINT security_audit_events_actor_check
 CHECK (actor_class IN ('owner','hosting-admin','system','mcp'));

-- ===========================================================================
-- from 0018_bootstrap_password_setup.sql
-- ===========================================================================
-- Bootstrap password setup (feature 002 clarifications 2026-09-22).
-- Happy path: started → credential-verified → password-set → confirmed.
-- Recovery-kit download is no longer required to confirm ownership.

ALTER TABLE bootstrap_attempts
  DROP CONSTRAINT IF EXISTS bootstrap_attempts_state_check;

ALTER TABLE bootstrap_attempts
  ADD CONSTRAINT bootstrap_attempts_state_check CHECK (
    bootstrap_state IN (
      'started',
      'credential-verified',
      'password-set',
      'recovery-prepared',
      'download-consumed',
      'confirmed',
      'abandoned',
      'rejected'
    )
  );

ALTER TABLE bootstrap_attempts
  DROP CONSTRAINT IF EXISTS bootstrap_attempts_confirmation_check;

ALTER TABLE bootstrap_attempts
  ADD CONSTRAINT bootstrap_attempts_confirmation_check CHECK (
    (bootstrap_state <> 'confirmed') OR (challenge_hash IS NOT NULL)
  );

DROP INDEX IF EXISTS bootstrap_attempts_open_unique;

CREATE UNIQUE INDEX bootstrap_attempts_open_unique
  ON bootstrap_attempts (installation_id)
  WHERE bootstrap_state IN (
    'started',
    'credential-verified',
    'password-set',
    'recovery-prepared',
    'download-consumed'
  );

DROP INDEX IF EXISTS pending_bootstrap_credentials_attempt_unique;

CREATE UNIQUE INDEX pending_bootstrap_credentials_attempt_kind_unique
  ON pending_bootstrap_credentials (attempt_id, credential_kind);

-- ===========================================================================
-- from 0019_database_pages_views.sql
-- ===========================================================================
-- Feature 029: canonical database owners, distinct source identities and saved
-- view containers. Older structured data requires an explicit pre-V1 reset;
-- this migration never deletes content or protected revisions implicitly.

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

-- ===========================================================================
-- from 0020_database_sources_per_origin.sql
-- ===========================================================================
-- A database page owns zero, one or many sources. source_id is the source
-- identity. item_id is the origin page and is no longer unique.
-- Pre-V1 rows that already exist are kept: each entry is tagged with the
-- single source its origin page had.

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'database_entries'::regclass
      AND contype = 'f'
      AND confrelid = 'databases'::regclass
  LOOP
    EXECUTE format('ALTER TABLE database_entries DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END;
$$;

ALTER TABLE database_entries ADD COLUMN source_id uuid;

UPDATE database_entries AS entry
SET source_id = source.source_id
FROM databases AS source
WHERE entry.database_id = source.item_id
  AND entry.source_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM database_entries WHERE source_id IS NULL) THEN
    RAISE EXCEPTION 'database entries without a source cannot move to migration 0020'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

ALTER TABLE database_entries ALTER COLUMN source_id SET NOT NULL;

ALTER TABLE databases DROP CONSTRAINT databases_pkey;
DROP INDEX IF EXISTS databases_item_workspace_unique;
ALTER TABLE databases DROP CONSTRAINT databases_source_id_unique;
ALTER TABLE databases ADD PRIMARY KEY (source_id);
CREATE INDEX databases_owner_item_idx ON databases (item_id);

ALTER TABLE database_entries
  ADD CONSTRAINT database_entries_source_fk
  FOREIGN KEY (source_id) REFERENCES databases (source_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX database_entries_source_idx ON database_entries (source_id);

CREATE OR REPLACE FUNCTION enforce_database_item_companions()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'database' AND NOT EXISTS (
    SELECT 1 FROM database_presentations WHERE item_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'database item requires its presentation'
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

CREATE OR REPLACE FUNCTION prevent_structured_page_kind_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'database' AND NEW.kind NOT IN ('database', 'database_view') THEN
    RAISE EXCEPTION 'database item kind cannot change'
      USING ERRCODE = '23514', CONSTRAINT = 'database_item_kind_change_check';
  END IF;
  IF OLD.kind = 'database_view' AND NEW.kind NOT IN ('database', 'database_view') THEN
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

-- ===========================================================================
-- from 0021_database_entry_numbers.sql
-- ===========================================================================
-- Stable per-database entry numbers for the "Identifiant" property.
-- Existing entries are numbered in creation order; new entries take the next
-- number for their database. NULL stays possible for rows created before the
-- property existed and never numbered.

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

-- ===========================================================================
-- Feature 058: isolated multi-account installations
-- ===========================================================================

-- One workspace per account: the singleton is gone.
DROP INDEX workspaces_singleton_idx;

-- Accounts. `owners` keeps its name (research D2): an owner is the owner of
-- one workspace.
DROP INDEX owners_installation_unique;

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES installations (id),
  secret_hash text NOT NULL UNIQUE CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  label text CHECK (label IS NULL OR length(label) BETWEEN 1 AND 120),
  max_uses integer CHECK (max_uses IS NULL OR max_uses >= 1),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by_id uuid NOT NULL REFERENCES owners (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_uses_check CHECK (max_uses IS NULL OR use_count <= max_uses),
  CONSTRAINT invitations_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at)
);

ALTER TABLE owners
  ADD COLUMN workspace_id uuid NOT NULL REFERENCES workspaces (id),
  ADD COLUMN email text NOT NULL,
  ADD COLUMN email_normalized text NOT NULL,
  ADD COLUMN pseudonym text NOT NULL,
  ADD COLUMN role text NOT NULL DEFAULT 'member',
  ADD COLUMN origin text NOT NULL,
  ADD COLUMN invitation_id uuid REFERENCES invitations (id) ON DELETE SET NULL,
  ADD COLUMN created_by_id uuid REFERENCES owners (id) ON DELETE SET NULL,
  ADD COLUMN disabled_at timestamptz;

ALTER TABLE owners DROP CONSTRAINT owners_state_check;
ALTER TABLE owners ADD CONSTRAINT owners_state_check
  CHECK (state IN ('active', 'disabled', 'recovery-required'));
ALTER TABLE owners ADD CONSTRAINT owners_email_check
  CHECK (length(email) BETWEEN 3 AND 254 AND email_normalized = lower(btrim(email)));
ALTER TABLE owners ADD CONSTRAINT owners_pseudonym_check
  CHECK (length(pseudonym) BETWEEN 1 AND 64 AND pseudonym = btrim(pseudonym));
ALTER TABLE owners ADD CONSTRAINT owners_role_check
  CHECK (role IN ('administrator', 'member'));
ALTER TABLE owners ADD CONSTRAINT owners_origin_check
  CHECK (origin IN ('bootstrap', 'administrator', 'invitation', 'open'));
-- The invitation reference may be cleared when a link is purged; the origin
-- stays truthful. The bootstrap account is the administrator and vice versa.
ALTER TABLE owners ADD CONSTRAINT owners_bootstrap_is_administrator_check
  CHECK ((origin = 'bootstrap') = (role = 'administrator'));
ALTER TABLE owners ADD CONSTRAINT owners_disabled_check
  CHECK ((state = 'disabled') = (disabled_at IS NOT NULL));

CREATE UNIQUE INDEX owners_email_unique ON owners (email_normalized);
CREATE UNIQUE INDEX owners_workspace_unique ON owners (workspace_id);
CREATE UNIQUE INDEX owners_single_administrator
  ON owners (installation_id) WHERE role = 'administrator';
CREATE INDEX owners_invitation_idx ON owners (invitation_id);

-- The installation no longer names one owner and one workspace.
ALTER TABLE installations DROP CONSTRAINT installations_counts_check;
ALTER TABLE installations DROP COLUMN owner_id;
ALTER TABLE installations DROP COLUMN workspace_id;
ALTER TABLE installations
  ADD COLUMN administrator_id uuid REFERENCES owners (id),
  ADD COLUMN registration_mode text NOT NULL DEFAULT 'closed';
ALTER TABLE installations ADD CONSTRAINT installations_registration_mode_check
  CHECK (registration_mode IN ('closed', 'invitation', 'open'));
ALTER TABLE installations ADD CONSTRAINT installations_counts_check CHECK (
  (state IN ('uninitialized', 'bootstrap-in-progress') AND administrator_id IS NULL)
  OR
  (state IN ('recovery-required', 'ready', 'migration-in-progress', 'degraded')
    AND administrator_id IS NOT NULL)
);

-- Audit events name the account they concern (null for system events).
ALTER TABLE security_audit_events
  ADD COLUMN owner_id uuid REFERENCES owners (id) ON DELETE SET NULL;
CREATE INDEX security_audit_events_owner_idx
  ON security_audit_events (owner_id, occurred_at);

INSERT INTO schema_migrations (version) VALUES ('0001_baseline');

COMMIT;
