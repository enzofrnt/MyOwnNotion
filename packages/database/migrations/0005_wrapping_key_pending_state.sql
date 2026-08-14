-- Wrapping-key rotation needs two versions to coexist (T083, US5, FR-017).
--
-- A rotation rewraps one root key per workspace, and each rewrap must
-- reference the version it rewrapped *to*. That reference is a foreign key, so
-- the new version row has to exist before the first rewrap — while the old
-- version is still the one the installation is running under.
--
-- The original three states could not express that. Inserting the new version
-- as 'current' would break the partial unique index and, worse, would make a
-- workspace created mid-rotation record a root key wrapped with the old key
-- but labelled with the new version. Inserting it as 'previous' would fit the
-- index and lie about what the row is.
--
-- 'pending' is the honest fourth state: the row exists, rewraps may target it,
-- and it is not what new work uses until the rotation completes and promotes
-- it. The partial unique index on 'current' is untouched and keeps its
-- guarantee that exactly one version is ever current.

BEGIN;

ALTER TABLE wrapping_key_versions
  DROP CONSTRAINT wrapping_key_versions_state_check;

ALTER TABLE wrapping_key_versions
  ADD CONSTRAINT wrapping_key_versions_state_check
  CHECK (state IN ('current', 'pending', 'previous', 'revoked'));

-- Each migration records itself, matching 0001–0004: the runner skips a
-- version already present, so without this the file would be replayed on the
-- next run and the DROP CONSTRAINT would fail against the already-widened
-- constraint.
INSERT INTO schema_migrations (version) VALUES ('0005_wrapping_key_pending_state');

COMMIT;
