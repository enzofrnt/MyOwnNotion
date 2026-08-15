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

BEGIN;

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

INSERT INTO schema_migrations (version) VALUES ('0001_initial');

COMMIT;
