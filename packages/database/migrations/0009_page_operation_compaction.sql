-- Lossless compaction receipts for convergent page operations (feature 017).
--
-- Once a verified shallow checkpoint is safe for every authorized device, the
-- bulky update bytes and their base frontier can be removed. The immutable
-- update row, digest, original sequence and result frontier remain forever as
-- the idempotence receipt, so replaying an old request still returns the same
-- accepted event instead of inserting it again under a new sequence.

BEGIN;

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

INSERT INTO schema_migrations (version) VALUES ('0009_page_operation_compaction');

COMMIT;
