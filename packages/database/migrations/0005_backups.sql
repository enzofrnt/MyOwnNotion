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

BEGIN;

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

INSERT INTO schema_migrations (version) VALUES ('0005_backups');

COMMIT;
