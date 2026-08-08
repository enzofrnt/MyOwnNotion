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

Encrypted backup implementation, restore, full browser evidence, coverage, documentation, and the final cross-feature validation remained open after this checkpoint; later sections supersede items as they are completed.

## User Story 3 implementation checkpoint — 2026-08-08

The encrypted backup implementation and isolated fault matrix are complete. A final real-container repository rehearsal remains required before the feature-wide validation tasks can close.

| Area | Command | Result |
| --- | --- | --- |
| Manifest and operations foundation | `vitest` focused manifest/foundation projects | Passed: 18 tests |
| Backup and maintenance isolation | `vitest` focused backup integration/command projects, excluding the temporarily unavailable external PostgreSQL case | Passed: 19 tests plus the manifest/foundation tests; one external snapshot test deferred |
| Operations type safety | operations package strict TypeScript check | Passed |
| Operations production bundle | operations package production build | Passed; bundled Node 24 CLI produced |
| Compose contract | focused production Compose security contract | Passed |

The injected matrix covers database dump failure, missing object, repository write/remote failure, snapshot lookup failure, repository check failure, completion-tag failure, overlap, invalid retention, daily scheduler restart, and redacted persistent status. No failed path returns a recoverable snapshot identity or adds a completion tag before verification.

The external PostgreSQL snapshot case and a real restic/rclone/Docker run could not be repeated at this point because the execution environment temporarily refused further privileged service access after reaching its usage allowance. They remain explicit gates for T058–T060; this is not recorded as recoverability proof.

## User Story 4 implementation checkpoint — 2026-08-08

Restore verification, guarded apply, exact object-key reproduction, API startup refusal, Compose wiring, and the operator rehearsal are implemented. The pure canonical comparison contract is complete; its production-container execution remains open because it requires the currently unavailable Docker/PostgreSQL services.

| Area | Command | Result |
| --- | --- | --- |
| Restore and guard isolation | focused restore verify/apply, API guard, filesystem exact-key, and Compose contract suites | Passed: 37 tests |
| Backup/restore fault set | focused operations suite | Passed: 65 tests; the one real PostgreSQL snapshot test could not start without a container runtime |
| Strict types | blob-store, operations, API, domain, and root TypeScript projects under Node 24 | Passed |
| Canonical contracts | focused OpenAPI, file-storage, and backup/restore comparison suites | Passed: 30 tests |

The restore preflight requires one complete-tagged encrypted snapshot and validates repository state, manifest closure, schema/PostgreSQL compatibility, archive readability, exact staged inventory, and every database/object length and digest before mutation. Apply requires an explicit empty-target confirmation, proves both targets empty, writes a persistent guard before the first mutation, restores the database in one transaction, reproduces collision-suffixed object keys exactly, and removes the guard only after count and digest cross-verification. Injected database/object interruptions and post-apply disagreement preserve the guard; the API refuses initialization with a redacted diagnostic while it exists.

The documented clean-host workflow now uses a distinct Compose project and fresh named volumes, includes exact verify/apply/start/audit/restart commands, and defines whole-target deletion as the only partial-restore rollback. The production smoke now implements encrypted repository initialization, complete backup/list/full-data check, wrong-secret rejection, empty-target restore, canonical export and file-digest comparison, target restart, repository corruption rejection, and API guard rehearsal. Its TypeScript path is valid, but it has not been executed in this checkpoint because Docker is unavailable; T058–T060 therefore remain open rather than being inferred from isolated evidence.

New canonical exports explicitly carry file content and revision identities beside byte length and SHA-256. Legacy version-1 exports without the two added identity fields remain valid, while the recovery comparison rejects changes to file digest/content/revision, placement, relationship, document, cursor, or any other canonical field. The isolated comparison suite passes 8 tests; the real source-versus-restored export assertions are wired into the pending container rehearsal.
