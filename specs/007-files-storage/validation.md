# Validation: Files and Durable Storage

## User Story 2 checkpoint — 2026-08-08

The private object-storage and durable streaming checkpoint passes on the local production topology.

### Focused evidence

| Area | Command | Result |
| --- | --- | --- |
| UUIDv7 regression | `node --import tsx` 100,000-identity invariant loop | Passed: every identifier had version 7 and an RFC 9562 variant |
| Domain identity | `pnpm exec vitest run packages/domain/tests/ordering.property.spec.ts` | Passed: 7 tests |
| Streamed API | `pnpm exec vitest run apps/api/tests/files-streaming.contract.spec.ts` | Passed: 7 tests, including abort, invalid input, idempotency, deduplication, and transaction cleanup |
| S3 adapter | `pnpm exec vitest run packages/blob-store/tests/s3.integration.spec.ts` | Passed: bucket privacy, full/range parity, restart, outage, persisted digest, and multipart abort |
| Audit and migration | `pnpm exec vitest run apps/operations/tests/foundation.spec.ts apps/operations/tests/storage-commands.integration.spec.ts` with isolated PostgreSQL | Passed: 12 tests |
| Performance | `pnpm exec vitest run tests/performance/files-storage.perf.spec.ts` | Passed: 256 MiB streaming under the 32 MiB ArrayBuffer ceiling, range response under one second, and 10,000-object audit under one second |
| Production topology | `pnpm test:containers` | Passed: images built; private object storage had no published host port; streamed upload, full and range digests, restart persistence, health proxy, migrations, and storage audit succeeded |

### Fault and recovery evidence

- Missing, mismatched, temporary, and unreferenced objects are reported without deletion or disclosure of internal locators.
- Filesystem-to-S3 migration is dry-run-first, verifies destination bytes before changing a locator, and is idempotent.
- Interrupted multipart uploads are aborted and temporary filesystem uploads are removed.
- The object volume survived complete application container removal and recreation, and the same revision-qualified bytes and range were returned afterward.
- A production-container audit exposed an intermittent UUID variant defect; the generator was corrected and guarded by a 5,000-identity domain test plus the 100,000-identity checkpoint above.

### Remaining gates

Backup, restore, full browser evidence, coverage, documentation, and the final cross-feature validation remain open in T036–T060.
