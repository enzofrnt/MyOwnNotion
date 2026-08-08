# Tasks: Files and Durable Storage

**Input**: Design documents from `/specs/007-files-storage/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Required by the specification and constitution. Write each story's failing tests before its implementation and preserve focused failure evidence during development.

**Organization**: Tasks are grouped by independently testable user story. All maintained source remains strict TypeScript; operational commands and container behavior receive the same gates as application code.

## Phase 1: Setup

**Purpose**: Add the pinned dependency and operations-project skeleton without changing runtime behavior.

- [x] T001 Create the strict TypeScript operations package, build entries, and workspace test project in `apps/operations/package.json`, `apps/operations/tsconfig.json`, `apps/operations/src/cli.ts`, and `vitest.workspace.ts`
- [x] T002 Add pinned S3 streaming, Workbox runtime-cache, and operations dependencies plus lockfile updates in `packages/blob-store/package.json`, `apps/web/package.json`, `apps/operations/package.json`, and `pnpm-lock.yaml`
- [x] T003 [P] Add deterministic safe-raster, document, ranged-byte, corrupt-object, and backup-manifest fixtures in `tests/fixtures/files-storage.ts` and export them from `tests/fixtures/workspace.ts`
- [x] T004 [P] Add ignored operation staging/status/restore data and Docker build-context exclusions in `.gitignore` and `.dockerignore`

---

## Phase 2: Foundational Streaming and Operations Contracts

**Purpose**: Establish storage, range, descriptor, manifest, and redaction primitives that block every story.

**⚠️ CRITICAL**: User-story work starts only after stored bytes can be streamed, independently verified, and described without exposing internal locators.

- [x] T005 [P] Add failing streaming put/open/head/list/compare, bounded-memory, abort-cleanup, and filesystem parity cases in `packages/blob-store/tests/streaming.spec.ts` and `packages/blob-store/tests/deduplication.spec.ts`
- [x] T006 [P] Add failing exact single-range, media allow-list, filename sanitization, and cache-admission cases in `packages/domain/tests/file-content.spec.ts`
- [x] T007 [P] Add failing current-revision descriptor, digest, verified-content, audit inventory, and legacy locator cases in `packages/database/tests/files-storage.integration.spec.ts`
- [x] T008 [P] Add failing OpenAPI and backup-manifest exactness cases in `tests/contract/files-storage.spec.ts` and `tests/contract/openapi.spec.ts`
- [x] T009 [P] Add failing manifest determinism, safe result envelope, process-output redaction, atomic status write, and exclusive-lock cases in `apps/operations/tests/foundation.spec.ts`
- [x] T010 Implement streaming blob sources/results plus filesystem put/open/head/list/compare/delete semantics in `packages/blob-store/src/blob-store.ts`, `packages/blob-store/src/content-store.ts`, and `packages/blob-store/src/filesystem-blob-store.ts`
- [x] T011 Implement the private S3-compatible streaming adapter, multipart abort, persisted-byte verification, range open, listing, and bucket initialization in `packages/blob-store/src/s3-blob-store.ts` and `packages/blob-store/src/index.ts`
- [x] T012 Implement exact range parsing, safe media/disposition, filename, digest, and offline cache-admission rules in `packages/domain/src/content/file-content.ts` and `packages/domain/src/index.ts`
- [x] T013 Implement server-internal file-content descriptors, verified inventories, audit comparisons, and safe legacy-locator updates in `packages/database/src/repositories/file-repository.ts` and `packages/database/src/index.ts`
- [x] T014 Add exact public file metadata/digest DTOs and canonical file-content contracts without storage locators in `packages/contracts/src/content-api.ts` and `specs/001-content-foundations/contracts/content-api.openapi.yaml`

**Checkpoint**: Filesystem and S3 adapters share one verified streaming contract; ranges, media, descriptors, manifests, and safe operation output have failing-then-passing focused evidence.

---

## Phase 3: User Story 1 — Open and Reuse Attachments (Priority: P1) 🎯 MVP

**Goal**: Let the owner safely inspect, preview, download, reuse, replace, and quota-cache exact file revisions.

**Independent Test**: Attach an image and document, preview/download exact bytes, reuse one logical file on a second page, replace it, then reload offline and distinguish cached, online-only, stale, and unavailable revisions.

### Tests for User Story 1

- [x] T015 [P] [US1] Add failing HEAD/full/single-range/suffix/open-ended/invalid/multiple/unsatisfiable, stale-revision, lifecycle, corruption, and storage-outage contract cases in `apps/api/tests/files-content.contract.spec.ts`
- [x] T016 [P] [US1] Add failing safe preview, existing-file selection, metadata, download, cached/online-only, stale, and unavailable component cases in `apps/web/src/features/attachments/file-preview.spec.tsx` and `apps/web/src/features/attachments/attachment-panel.spec.tsx`
- [x] T017 [P] [US1] Add desktop/mobile image/document preview, exact download, second-page reuse, replacement, offline reload, 400% zoom, and Axe journeys in `tests/e2e/files-storage.spec.ts`

### Implementation for User Story 1

- [x] T018 [US1] Implement revision-qualified HEAD/GET streaming with full and one-range responses plus safe lifecycle/integrity failures in `apps/api/src/routes/files.ts`
- [x] T019 [US1] Apply private immutable cache, nosniff, sandbox, digest, length, revision, range, and sanitized disposition headers in `apps/api/src/routes/files.ts` and `apps/api/src/plugins/errors.ts`
- [x] T020 [US1] Add typed file metadata inspection, immutable content URLs, and attachment download helpers in `apps/web/src/services/content-api.ts`
- [x] T021 [US1] Implement bounded labelled raster preview, metadata, download, cached/online-only, and unavailable states in `apps/web/src/features/attachments/file-preview.tsx` and `apps/web/src/styles.css`
- [x] T022 [US1] Add keyboard-operable existing-file search/placement reuse and integrate preview/download into `apps/web/src/features/attachments/attachment-panel.tsx`
- [x] T023 [US1] Cache only complete successful revision-qualified responses up to 16 MiB with 24-entry/30-day eviction and quota cleanup in `apps/web/src/service-worker.ts`
- [x] T024 [US1] Add file name, digest, range, disposition, cache, preview, and storage-error log-redaction assertions plus deterministic review attachments in `apps/api/tests/logging.spec.ts` and `tests/e2e/files-storage.spec.ts`

**Checkpoint**: User Story 1 works from the existing filesystem adapter and remains independently demonstrable without object storage or backup services.

---

## Phase 4: User Story 2 — Keep File Content Private and Durable (Priority: P1)

**Goal**: Use private production object storage, stream bounded uploads, survive interruption/restart, audit integrity, and migrate existing filesystem content explicitly.

**Independent Test**: Upload small/large/identical/interrupted files against isolated object storage, restart, retrieve exact full/range bytes, inject missing/mismatched/unreferenced objects, audit without mutation, and migrate a legacy fixture idempotently.

### Tests for User Story 2

- [x] T025 [P] [US2] Add failing streamed multipart, zero-byte, 256 MiB memory ceiling, abort, invalid-field, idempotency, transaction-failure cleanup, and byte-equal reuse cases in `apps/api/tests/files-streaming.contract.spec.ts` and `tests/performance/files-storage.perf.spec.ts`
- [x] T026 [P] [US2] Add isolated S3 bucket privacy, put/read/range/restart/outage/checksum/multipart-abort parity cases in `packages/blob-store/tests/s3.integration.spec.ts`
- [x] T027 [P] [US2] Add missing/mismatched/temporary/unreferenced audit and verified dry-run/confirmed/idempotent legacy migration cases in `apps/operations/tests/storage-commands.integration.spec.ts`
- [x] T028 [P] [US2] Extend production container smoke with private object health, streamed upload, full/range digest, restart, audit, and no-published-object-port assertions in `scripts/ci/test-containers.ts`

### Implementation for User Story 2

- [x] T029 [US2] Replace multipart `toBuffer()` with bounded streaming ingest, temporary-object cleanup, and transaction-aware acceptance in `apps/api/src/routes/files.ts` and `packages/blob-store/src/content-store.ts`
- [x] T030 [US2] Select filesystem or S3 adapter from exact protected configuration, initialize the private bucket, and expose storage readiness without secrets in `apps/api/src/app.ts`, `apps/api/src/context.ts`, and `apps/api/src/server.ts`
- [x] T031 [US2] Implement read-only verified inventory comparison, HMAC safe finding identifiers, bounded JSON report, and no-delete audit command in `apps/operations/src/audit.ts` and `apps/operations/src/cli.ts`
- [x] T032 [US2] Implement dry-run-first verified, per-object transactional, idempotent filesystem-to-S3 migration in `apps/operations/src/migrate-filesystem.ts` and `apps/operations/src/cli.ts`
- [x] T033 [US2] Add pinned private object service, health dependency, internal-only credentials, persistent volume, API adapter variables, and operations profile wiring in `compose.prod.yaml` and `.env.prod.example`
- [x] T034 [US2] Preserve current files and development filesystem behavior while exposing verified digest/revision metadata through hierarchy and page attachment projections in `packages/database/src/repositories/item-reader.ts`, `packages/client-core/src/outbox/apply-to-projection.ts`, and `apps/web/src/features/hierarchy/file-node.tsx`
- [x] T035 [US2] Run the isolated S3 parity, streamed API, audit/migration, and production restart checkpoint; record exact focused evidence in `specs/007-files-storage/validation.md`

**Checkpoint**: User Story 2 proves private object durability and explicit integrity operations independently through HTTP and the operations CLI.

---

## Phase 5: User Story 3 — Create Encrypted Recoverable Backups (Priority: P1)

**Goal**: Create non-overlapping, transactionally aligned database-and-object recovery points encrypted into a separate destination, with verification, status, scheduling, and retention.

**Independent Test**: Populate every canonical content kind, create complete backups amid concurrent writes, inject dump/object/restic/remote failures and overlap, list/check snapshots, run scheduled creation, and dry-run retention.

### Tests for User Story 3

- [x] T036 [P] [US3] Add failing exact manifest schema, stable sorting, count/digest, compatibility, private-field exclusion, and round-trip cases in `apps/operations/tests/manifest.spec.ts`
- [x] T037 [P] [US3] Add failing exported-snapshot alignment, referenced-object selection, advisory/repository lock, dump/object/restic/remote failure, incomplete-tag, and redacted-status cases in `apps/operations/tests/backup.integration.spec.ts`
- [x] T038 [P] [US3] Add failing complete-only list/check, full-data check, 7/4/12 dry-run/confirmed retention, invalid policy, UTC schedule, restart status, and overlap cases in `apps/operations/tests/backup-commands.spec.ts`

### Implementation for User Story 3

- [x] T039 [US3] Implement exact backup manifest validation/serialization, snapshot inventory queries, hashing, compatibility capture, process runner, atomic status, and exclusive locks in `apps/operations/src/manifest.ts`, `apps/operations/src/process-runner.ts`, `apps/operations/src/status-store.ts`, and `apps/operations/src/locks.ts`
- [x] T040 [US3] Implement synchronized PostgreSQL dump plus exact verified object staging, encrypted restic creation/check, complete tagging, cleanup, and safe failure paths in `apps/operations/src/backup.ts`
- [x] T041 [US3] Implement complete-only backup list, metadata/full-data check, and dry-run-first 7/4/12 forget/prune commands in `apps/operations/src/backup-maintenance.ts` and `apps/operations/src/cli.ts`
- [x] T042 [US3] Implement one-run-per-UTC-day scheduling through the same locked backup path and persistent safe status in `apps/operations/src/scheduler.ts` and `apps/operations/src/cli.ts`
- [x] T043 [US3] Build a least-privilege pinned operations image with Node, PostgreSQL client, restic, and rclone plus on-demand/scheduled Compose profiles and protected mounts in `apps/operations/Dockerfile`, `apps/operations/package.json`, and `compose.prod.yaml`
- [x] T044 [US3] Document repository initialization, protected secrets, local/rclone destinations, schedules, status, checks, full-data checks, retention dry-run/confirmation, and failure recovery in `docs/deployment.md` and `.env.prod.example`

**Checkpoint**: User Story 3 produces only encrypted verified complete recovery points, and every partial/failing path remains unselectable.

---

## Phase 6: User Story 4 — Restore and Prove a Complete Workspace (Priority: P1)

**Goal**: Verify and apply one selected complete backup to empty targets while blocking API readiness through any partial or failed restore.

**Independent Test**: Verify and restore a full fixture to clean database/object targets, compare all canonical identities and digests, then inject wrong secret, non-empty target, incompatible schema, missing/corrupt object, interrupted database/object apply, and retained guard failures.

### Tests for User Story 4

- [x] T045 [P] [US4] Add failing complete-tag, decrypt, compatibility, staged dump/object/manifest, empty-target, and safe-report preflight cases in `apps/operations/tests/restore-verify.integration.spec.ts`
- [x] T046 [P] [US4] Add failing guard-before-mutation, database/object apply, post-apply cross-verification, interruption, preserved-guard, and no-ready API cases in `apps/operations/tests/restore-apply.integration.spec.ts` and `apps/api/tests/restore-guard.spec.ts`
- [x] T047 [P] [US4] Add a clean-host source/backup/empty-target/restore/restart comparison covering every canonical identity and file digest in `tests/contract/backup-restore.spec.ts`

### Implementation for User Story 4

- [x] T048 [US4] Implement complete snapshot staging and manifest/schema/tool/dump/object/repository verification without target mutation in `apps/operations/src/restore.ts` and `apps/operations/src/cli.ts`
- [x] T049 [US4] Implement explicit empty-target proof, persistent guard, PostgreSQL/object apply, post-apply comparison, success unguard, and failure preservation in `apps/operations/src/restore.ts` and `apps/operations/src/status-store.ts`
- [x] T050 [US4] Refuse API initialization while the shared restore guard exists and expose only redacted not-ready diagnostics in `apps/api/src/app.ts`, `apps/api/src/routes/health.ts`, and `compose.prod.yaml`
- [x] T051 [US4] Extend production container smoke with encrypted backup creation, clean-target restore, exact database/object comparison, wrong-secret/corruption faults, and guard verification in `scripts/ci/test-containers.ts`
- [x] T052 [US4] Document clean-host verify/apply/start/audit rehearsal, explicit partial-target cleanup, rollback boundary, and disaster-recovery checklist in `docs/deployment.md` and `specs/007-files-storage/quickstart.md`

**Checkpoint**: User Story 4 proves a complete recovery and prevents every tested partial restore from becoming ready.

---

## Phase 7: Polish and Cross-Cutting Quality

- [x] T053 [P] Add one-second 10,000-object audit plus 256 MiB stream-memory and range-throughput assertions in `tests/performance/files-storage.perf.spec.ts`
- [x] T054 [P] Validate and merge the file-content OpenAPI fragment and backup manifest schema into canonical contract checks in `tests/contract/openapi.spec.ts`, `tests/contract/files-storage.spec.ts`, and `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [x] T055 [P] Add canonical export file digest/revision metadata and post-restore exact export assertions in `tests/contract/export.spec.ts`, `tests/contract/editor-export.spec.ts`, and `tests/contract/backup-restore.spec.ts`
- [x] T056 Add deterministic desktop/mobile attachment metadata, raster preview, reuse, cached-offline, online-only, and unavailable screenshots plus Axe and horizontal-overflow checks in `tests/e2e/files-storage.spec.ts`
- [x] T057 Update file use, offline quota, integrity audit, migration, backup/restore development, production, security, and troubleshooting guidance in `docs/editor.md`, `docs/development.md`, and `docs/deployment.md`
- [x] T058 Run toolchain policy, shell policy, formatting, Biome CI, exact types, migration checks, focused unit/integration/contract/performance suites, and record results in `specs/007-files-storage/validation.md`
- [x] T059 Run full coverage, complete browser matrix, production builds, and verify GitHub artifacts retain all required images/traces; record results in `specs/007-files-storage/validation.md`
- [x] T060 Run the complete object-storage, backup, clean-host restore, restart, and legacy migration quickstart in isolated Compose; record exact recoverability evidence in `specs/007-files-storage/validation.md`
- [x] T061 [US4] Allocate and assert disjoint valid source/restore host ports in the production container smoke so both projects can run concurrently in `scripts/ci/test-containers.ts`
- [x] T062 [US3] Document UID-aware owner-only backup-secret permissions for the non-root operations image in `.env.prod.example`, `docs/deployment.md`, and `specs/007-files-storage/quickstart.md`
- [x] T063 [US3] Align backup/restore CLI exit classification with the operations contract and cover configuration, overlap, preflight, integrity, dependency, and guarded-failure outcomes in `apps/operations/src/cli.ts` and `apps/operations/tests/backup-commands.spec.ts`

## Dependencies and Execution Order

### Phase dependencies

- **Setup (Phase 1)** starts immediately.
- **Foundation (Phase 2)** depends on setup and blocks all stories.
- **US1 (Phase 3)** depends on file descriptor/range/stream primitives and is the first user-visible MVP.
- **US2 (Phase 4)** depends on the shared stream contract but is independently testable through the API/operations CLI; T034 integrates US1 metadata after its core object behavior passes.
- **US3 (Phase 5)** depends on the S3 adapter, verified inventory, operations foundation, and production storage topology from US2.
- **US4 (Phase 6)** depends on complete backup sets from US3 and the restore guard foundation; verify remains read-only until apply tests pass.
- **Polish (Phase 7)** depends on all selected stories.

### Within each story

- Test tasks must be observed failing before implementation.
- Exact domain/storage rules precede database/API/UI adapters.
- Operations manifest, process, status, and locks precede backup/restore orchestration.
- Read-only audit/verify paths precede migration/prune/apply paths.
- A story checkpoint must pass before its tasks are marked complete.

### Parallel opportunities

- T003 and T004 are independent after T001/T002 paths are known.
- T005–T009 target separate test projects and can be authored independently.
- T015–T017, T025–T028, T036–T038, and T045–T047 are per-story independent failing-test groups.
- T053–T055 target separate final suites.

## Parallel Examples

### User Story 1

```text
T015 API retrieval contracts
T016 attachment component states
T017 responsive/offline browser journey
```

### User Story 2

```text
T025 streamed multipart and memory faults
T026 isolated S3 adapter parity
T027 audit and legacy migration commands
T028 production object-store restart smoke
```

### User Story 3

```text
T036 manifest exactness
T037 backup consistency and failure injection
T038 maintenance and scheduling commands
```

### User Story 4

```text
T045 restore verification preflight
T046 guarded apply fault injection
T047 clean-host canonical comparison
```

## Implementation Strategy

1. Complete streaming and descriptor foundations without changing accepted logical behavior.
2. Deliver US1 retrieval/reuse/offline cache against the filesystem adapter and validate its browser journey.
3. Add US2 S3 production storage, streaming upload, audit, and migration while keeping development compatibility.
4. Build US3 backups from the exact verified object inventory and make incomplete snapshots unselectable.
5. Build US4 read-only verification first, then guarded empty-target apply and clean-host proof.
6. Run convergence after implementation; append any remaining gaps without rewriting these tasks.

All 60 tasks use the required checkbox, sequential identifier, optional parallel marker, required story label inside story phases, imperative action, and concrete file paths.
