-- Convergent page-operation state (feature 017).
--
-- Routing, identities and monotonic sequences remain queryable. Checkpoints,
-- version vectors, updates and ambiguity details are referenced through the
-- existing protected-envelope store; no owner-authored page content is added
-- to these tables in clear text.

BEGIN;

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

INSERT INTO schema_migrations (version) VALUES ('0008_page_operations');

COMMIT;
