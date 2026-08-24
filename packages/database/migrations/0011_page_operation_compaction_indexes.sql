-- Foreign-key support indexes for bounded page-operation compaction (feature 017).
--
-- PostgreSQL does not create indexes on referencing columns automatically.
-- Removing covered protected envelopes otherwise makes each parent-row delete
-- scan the complete update log once for base_frontier_envelope_id and once for
-- update_envelope_id, turning a 10,000-update compaction into quadratic work.

BEGIN;

CREATE INDEX page_operation_updates_base_frontier_envelope_idx
    ON page_operation_updates (base_frontier_envelope_id);

CREATE INDEX page_operation_updates_update_envelope_idx
    ON page_operation_updates (update_envelope_id);

INSERT INTO schema_migrations (version) VALUES ('0011_page_operation_compaction_indexes');

COMMIT;
