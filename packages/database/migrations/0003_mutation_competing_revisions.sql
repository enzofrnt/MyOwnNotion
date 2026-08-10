-- Migration 0003: retain competing revision identities on rejected mutations
-- (T105, FR-042).
--
-- Reviewed SQL; applied explicitly (never schema push).
--
-- FR-042 requires a rejected concurrent mutation to remain locally recoverable
-- "with its base and competing revision identities". Those identities were only
-- ever held in the in-memory SafeError and returned on the first response, so a
-- replay could not restore them: if that first response was lost and the client
-- retried the same mutation ID, its durable conflict record ended up with an
-- empty competing set and the owner had nothing to compare against.
--
-- Storing them alongside failure_code makes the recorded rejection complete, so
-- every replay returns the same information as the original response.

BEGIN;

ALTER TABLE mutations
    ADD COLUMN competing_revision_ids uuid[] NOT NULL DEFAULT '{}';

-- Competing identities only make sense for a rejection: an accepted mutation
-- has no competitor, and recording one would misreport the outcome.
ALTER TABLE mutations
    ADD CONSTRAINT mutations_competing_only_when_rejected CHECK (
        status = 'rejected' OR cardinality(competing_revision_ids) = 0
    );

INSERT INTO schema_migrations (version) VALUES ('0003_mutation_competing_revisions');

COMMIT;
