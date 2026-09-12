# Tasks: Storage privacy and code coherence audit

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/storage.md](contracts/storage.md).
Tests are required by the specification and constitution. Implementation begins
only after cross-artifact analysis. Checked tasks require actual evidence.

## Phase 1: Setup

- [x] T001 Record the initial bounded audit inventory, reachability and evidence limits in `docs/audits/2026-09-pre-v1.md`, including authentication, files, sync, migrations, contracts, styling and native composition (FR-011).
- [x] T002 Update directly affected composition/convergence references in `specs/002-owner-security-foundation/plan.md`, `specs/005-files-and-local-storage/plan.md`, `specs/007-backup-recovery-updates/plan.md` and `specs/024-full-server-backups/plan.md` plus their task lists; preserve product requirements and record 024 delivery dependency (FR-011/FR-013).

## Phase 2: Foundations

- [x] T003 Define authenticated completed/partial manifests and corruption/shape property tests in `packages/domain/src/files/protected-file.ts` and `packages/domain/tests/protected-file.spec.ts` (FR-003/FR-006).
- [x] T004 Add format-aware content/upload fields, protected upload chunks, transition/quarantine references and constraints in `packages/database/migrations/0015_protected_file_storage.sql`, schema, ledger and migration tests (FR-001/FR-006/FR-007).
- [X] T005 Add bounded single-chunk write/read iteration and key wiping in `packages/blob-store/src/encryption/encrypted-chunk-store.ts`; cover tail deletion, substitution, exact/empty boundaries in `packages/blob-store/tests/encrypted-chunks.spec.ts` (FR-003/FR-004).
- [X] T006 Make ciphertext publication durable through exclusive private staging, verified bytes, fsync and directory fsync in `packages/blob-store/src/filesystem-blob-store.ts` and failure tests (FR-001/FR-008).
- [X] T007 Add purpose-specific content-index key derivation in `apps/api/src/security/key-hierarchy.ts` and encrypted file metadata/manifest entities in `apps/api/src/security/protected-content.ts`; verify no recovery-key accessor is reused (FR-002/FR-006).
- [X] T008 Add transaction-aware content/upload chunk repositories and candidate lookup in `packages/database/src/repositories/`, with format-specific reads and generation-lock boundaries (FR-003/FR-005/FR-006).
- [X] T009 Implement the shared protected-file runtime factory/service in `apps/api/src/files/`, composing existing key/record/blob services without unencrypted fallback (FR-001/FR-008).

## Phase 3: US1 — Private attachments (P1)

**Independent test**: Secured upload/rename/restart/download plus logical SQL and
application-file sentinel inspection. Prove failures before wiring new paths.

- [X] T010 [US1] Reproduce direct/tus plaintext bytes and metadata through secured real requests in `apps/api/tests/protected-files.integration.spec.ts`, retaining the failing baseline evidence (FR-001/FR-002, SC-001).
- [x] T011 [US1] Wire bounded multipart import/replacement through the protected service and accepted mutation guards in `apps/api/src/routes/files.ts`, preserving IDs and verified deduplication (FR-001/FR-004/FR-005).
- [x] T012 [US1] Implement encrypted resumable PATCH/tail replacement, atomic offsets, HEAD and finalization in `apps/api/src/routes/uploads.ts` and `apps/api/src/files/protected-upload-service.ts` (FR-001/FR-004/FR-005).
- [x] T013 [US1] Resolve/protect file metadata and historical snapshots across `apps/api/src/security/content-resolution.ts`, item/file/revision repositories and sync projection paths; neutralize readable source fields atomically (FR-002/FR-005).
- [x] T014 [US1] Implement authenticated streaming full/single-range downloads in `apps/api/src/routes/files.ts` and `apps/api/src/files/file-range.ts`; verify headers, 206/416, corruption and no unauthenticated bytes (FR-003/FR-004/FR-008).
- [x] T015 [US1] Use the shared factory in `apps/api/src/app.ts`, context, `admin/admin-cli.ts`, guarded migration and portable restoration; remove active raw file-service composition (FR-001/FR-005).
- [x] T016 [US1] Stream portable archive production directly into sealing in `apps/api/src/backup/backup-service.ts` and `archive-format.ts`; resolve/ingest protected contents and metadata in export/restore boundaries (FR-001/FR-002/FR-005).
- [x] T017 [US1] Extend format-aware inventory in `apps/api/src/backup/full/files.ts` for completed/upload/quarantine ciphertext while retaining legacy schema support; prove full and portable restored reads in backup integration tests (FR-005/FR-006).
- [x] T018 [US1] Extend data-key rewrite/checkpoint/count/revocation in `apps/api/src/security/` and security repositories to completed and partial chunks, with transactional generation reference checks and 024 lock ordering (FR-006/FR-008).
- [x] T019 [US1] Verify crash/retry/duplicate completion, empty/maximum files, corruption/substitution, missing keys, wrapping/data rotation and retained historical reads in `apps/api/tests/protected-files.integration.spec.ts` and `protected-file-rotation.integration.spec.ts` (SC-001/SC-002).
- [x] T020 [US1] Add real direct/resumable upload, rename, preview, offline/reconnect and range behavior journeys in `tests/e2e/protected-files.spec.ts`; use UI quality guidance for changed states (FR-013).
- [x] T021 [US1] Add isolated 2 GiB streaming/range memory verification in `tests/performance/protected-files.perf.spec.ts` and route it through the maintained performance gate with precise peak-memory evidence (SC-004).

## Phase 4: US2 — Historical storage transition (P1)

**Independent test**: Restore historical fixtures; interrupt every declared
publication/checkpoint/cutover/cleanup boundary, resume and compare exact data.

- [x] T022 [US2] Create historical shared/history-only/partial/orphan fixtures and failing interruption/backup-refusal tests in `apps/api/tests/file-storage-migration.integration.spec.ts` (FR-007, SC-003).
- [x] T023 [US2] Implement durable inventory and per-object checkpoints in `apps/api/src/security/file-storage-migration.ts` and transition repositories, bound to the verified 024 source-backup identity (FR-007).
- [x] T024 [US2] Backfill completed/partial ciphertext and sensitive current/history metadata, verify replacements and preserve recoverable orphan data in encrypted quarantine in `apps/api/src/security/file-storage-migration.ts` (FR-002/FR-007).
- [x] T025 [US2] Implement verified cutover and resumable retirement of readable originals with explicit corruption/disk/key failures in `apps/api/src/security/file-storage-migration.ts` (FR-007/FR-008).
- [x] T026 [US2] Integrate transition before successful version bookkeeping in `apps/api/src/backup/guarded-migration.ts`; block startup/incompatible mutation paths while transition is incomplete (FR-007/FR-008).
- [x] T027 [US2] Prove every durable interruption, backup-before-write, concurrent writer/rotation boundary and logical/file sentinel cleanup in `apps/api/tests/file-storage-migration.integration.spec.ts` (SC-001/SC-003).
- [x] T028 [US2] Document disk-space needs, resumable recovery, encrypted quarantine, historical WAL/snapshot limits and complete rollback in `docs/deployment/backups.md` and `docs/architecture/file-handling.md` (FR-007/FR-011).

## Phase 5: US3 — Recovery coherence (P1)

**Independent test**: Occupied import target refuses unchanged; empty target
adopts identity atomically and imports no devices; 024 invalidates restored trust.

- [x] T029 [US3] Verify actual reachability and occupied-target/rollback invariants in `apps/api/tests/administrative-recovery.integration.spec.ts`, including real active devices/sessions on the refused source target (FR-009, SC-005).
- [x] T030 [US3] Remove or correct the unreachable inconsistent `resetDeviceTrust` branch in `packages/database/src/repositories/security/recovery-import-repository.ts` and its sole administrative caller; preserve result compatibility, empty-target refusal and key cleanup (FR-009/FR-012).
- [x] T031 [US3] Re-run actual full-restore trust invalidation and post-activation attachment reads in `apps/api/tests/full-restore.integration.spec.ts`; record distinction between key import and complete restore in the audit (FR-009, SC-005).

## Phase 6: US4 — Predictable controls and credible checks (P2)

**Independent test**: Pointer cancellation, keyboard submit, dirty input and IME
survive projection updates; active caret/style and native runtime are exercised.

- [x] T032 [US4] Add failing real pointer-down/move-away/release, exactly-once keyboard and dirty-form composition/projection journeys in `tests/e2e/database-form-lifecycle.spec.ts` (FR-010, SC-006).
- [x] T033 [US4] Restore semantic activation in `apps/web/src/ui/stable-action-button.tsx` and stabilize affected database forms/list rows across projection changes without replacing unsaved values (FR-010).
- [x] T034 [US4] Remove the unimported `apps/web/src/styles.css` and its string-matching test in `apps/web/tests/editor-input.spec.ts`; verify empty-line caret/focus through active `global.css` in browser journeys and fix stale references (FR-012).
- [x] T035 [US4] Remove only proven unused native locking scaffold in `apps/desktop/src/single-instance.ts` and tests; preserve live partition/profile helpers and actual Electron single-instance lifecycle coverage (FR-012/FR-013).
- [x] T036 [US4] Complete evidence/disposition for every declared audit boundary in `docs/audits/2026-09-pre-v1.md`, including checked auth/revocation, sync/revisions, migration/recovery, sensitive logging, shared contracts and native/window state (FR-011, SC-007).

## Phase 7: Cross-cutting validation and delivery

- [ ] T037 Validate exact file format/digest/identity compatibility and image/runtime restores on AMD64 and ARM64, including existing reference backups, in `specs/025-storage-coherence-audit/validation.md` (FR-005/FR-006/FR-013).
- [ ] T038 Complete real browser/theme/viewport/native parity, performance and all failure evidence; update directly affected shared artifacts and audit limitations in `specs/025-storage-coherence-audit/validation.md` (SC-001–SC-007).
- [x] T039 Run Spec Kit convergence against all requirements and acceptance scenarios, append/fix remaining gaps and keep `specs/025-storage-coherence-audit/tasks.md` current (FR-011/FR-013).
- [ ] T040 Read `docs/development.md`, pass `bun run checks:local` and required image scans on the exact commit, then push and open the feature PR with concrete evidence (FR-013).
- [ ] T041 Review and pass every PR CI, merge, verify all main CI/images and record commit-addressable delivery in `specs/025-storage-coherence-audit/validation.md` (FR-013).

## Additional confirmed privacy boundary — required before delivery

- [x] T042 [US1] Reproduce readable canonical presentation/snapshots and restored payloads through secured HTTP in `apps/api/tests/canonical-storage-privacy.integration.spec.ts`, recording SQL sentinel evidence (FR-014).
- [x] T043 [US1] Resolve protected canonical payloads at mutation/snapshot boundaries and neutralize committed plaintext copies in `apps/api/src/plugins/mutations.ts`, content resolution and database mutation/revision repositories; preserve neutral edits, structured values, restore and sync (FR-014).
- [x] T044 [US2] Apply the same canonical privacy boundary to portable restoration and historical transition in `apps/api/src/backup/database-restore-target.ts` and `apps/api/src/security/file-storage-migration.ts` (FR-007/FR-014).
- [x] T045 [US4] Verify secured canonical SQL sentinel absence, subsequent edits/history, database definitions/values, offline sync and portable/full restored reads; update the audit and convergence evidence (FR-014).

## Additional confirmed implementation and verification gaps

- [x] T046 [US4] Remove the uncalled plaintext staging writer and obsolete readable-digest lookup in `apps/api/src/backup/archive-format.ts` and `packages/database/src/repositories/file-repository.ts`; move archive framing/failure proofs onto the production streaming boundary (FR-001/FR-012).
- [x] T047 [US4] Share canonical operand preparation between `packages/domain/src/databases/query.ts` and `apps/api/src/databases/database-query-service.ts`; reproduce and correct normalized equality filters losing valid rows, and compare indexed filters, incremental changes and cursor refusals with canonical results in `apps/api/tests/database-query-service.spec.ts` (FR-011/FR-013).
- [x] T048 [US1] Reconcile authenticated current content/upload manifests with their complete chunk indexes before rotation completion and key revocation in `apps/api/src/files/` and `apps/api/src/admin/commands/rotation-data-key.ts`; prove that missing indexes remain recoverable and cannot authorize revoking a referenced generation in `apps/api/tests/protected-file-references.integration.spec.ts` (FR-006/FR-008, SC-002).
- [x] T049 [US1] Bound production allocations in `packages/domain/src/security/crypto.ts`, `packages/blob-store/src/filesystem-blob-store.ts` and `apps/api/src/files/protected-file-service.ts`; correct the measured 271.8 MiB additional RSS overrun without weakening the 256 MiB budget, verify three isolated 2 GiB ingest/full-read/range runs per standard/maintained Bun mode in `tests/performance/protected-files.perf.spec.ts`, and retain crypto ownership, durable publication and file corruption/concurrency tests. Implementation and focused checks pass; renewed complete gates remain T038/T040 (SC-004, FR-004).

## Dependencies and strategy

T001–T002 → T003–T009 → US1 → US2 → cross-cutting delivery. US3/US4 have
independent reproduction work after setup; their implementation is kept separate
from shared storage edits. US1 on a fresh fixture is the smallest useful technical
slice; no historical installation is shipped that slice until US2 is complete.
Feature 024 must be merged and verified before this feature's migration delivery.

Independent work examples: US1 chunk properties and secured HTTP fixture setup;
US2 fixture construction and operational documentation after the format is fixed;
US3 occupied-target tests while US4 browser reproduction runs. These are dependency
opportunities, not a requirement to run extra agents or overlap heavy DB suites.

All 59 task lines follow the checklist/ID/path format. Counts: setup 2,
foundations 7, US1 12, US2 7, US3 3, US4 5, cross-cutting 5, canonical privacy extension 4, additional gaps 4, resumed migration convergence 1, active page response convergence 1, historical source-key convergence 1, selective graph coverage 1, page title reflow 1, multipart conflict recovery 1, editor geometry 1, bounded multipart evidence 1, direct bounded reads 1, CI gate topology 1. Each story's acceptance
criteria precede its implementation and its completion requires recorded proof.

T042–T045 extend T013/T016/T024 and block T039–T041; they must not be deferred beyond this audit delivery.

## Phase 8: Convergence — resumed migration protection

- [x] T050 [US2] Authenticate the original full backup of a pending storage transition before any additional SQL migration in `apps/api/src/backup/guarded-migration.ts`; reproduce a missing/corrupted archive plus a new migration, prove unchanged SQL ledger/data/transition/blob state on refusal, and complete the same transition after exact archive repair in `apps/api/tests/full-guarded-migration.integration.spec.ts` (FR-007/FR-008, SC-003).

## Phase 9: Convergence — active page response rejection

- [x] T051 [US4] Prove active `PageReconciler` transport refusals with real Loro transactions in `packages/client-core/tests/page-reconciler-rejection.spec.ts`: missing/foreign acknowledgements, regressive/incompatible frontiers, corrupt remote digests or reused local update identities, and regressive cursors must retain the checkpoint, cursor, content and recoverable local updates without false synchronization; prove a healthy subsequent response resumes the supported path, reject the confirmed passive frontier regression in `packages/client-core/src/page-sync/page-reconciler.ts`, and record focused tests/types/Biome in `specs/025-storage-coherence-audit/validation.md` (FR-011/FR-012/FR-013; partial evidence).

## Phase 10: Convergence — historical source-backup keys

- [x] T052 [US2] Integrate corrected 024 backup-key history without losing T050/T051; adapt `apps/api/src/backup/guarded-migration.ts` to authenticate the original source archive with the explicitly configured read keys and clear owned copies on success/failure. Exercise actual wrapping-key CLI rotation during an interrupted storage transition, then prove source A/current B plus historical A either resumes the same transition or is refused by the actual rotation guard; preserve T050 refusal-before-SQL for absent/corrupt archives in `apps/api/tests/full-guarded-migration.integration.spec.ts`. Update A23/A24 in `docs/audits/2026-09-pre-v1.md` and targeted validation, retaining full delivery gates (FR-007/FR-008/FR-011, SC-003).

## Phase 11: Convergence — selective graph coverage

- [x] T053 [US4] Reproduce and correct graph tests omitted by `scripts/ci/run-affected-vitest.ts` for changed graph sources; verify the public impact-plan consumer against declared unit projects in `tests/contract/test-impact.spec.ts`, run actual related graph tests, and record A33 plus focused evidence (FR-011/FR-012). Complete delivery remains T038/T040/T041.

## Phase 12: Convergence — page title reflow

- [x] T054 Keep the complete page title visible when its reading column narrows or widens without a title edit. Reproduce clipped native title geometry after a viewport/column resize, observe layout changes without replacing the draft or selection, and verify both themes, 320 px, and restored wide layout before complete delivery gates (FR-010/FR-012/FR-013, UI-quality, audit A35).
- [x] T055 Explain and recover a transient multipart publication conflict without replaying a consumed server stream: reproduce PostgreSQL serialization rollback after ingestion, return an explicit safe retryable response, retry fresh client multipart requests with the same mutation identity at most three times, preserve stale/unrelated/offline failures and verify exact file bytes, unique canonical acceptance and the original Firefox hierarchy-file journey (FR-004/FR-005/FR-008/FR-010/FR-013, audit A36).
- [x] T056 Stabilize the editor loading-to-ready boundary above embedded database controls: reproduce the real WebKit 32 px scroll displacement with a held property-save pointer while the page checkpoint finishes, contain the history toolbar's negative margin without moving it from the title row, and verify retained control position, pointer release/cancellation and all browser profiles (FR-010/FR-012/FR-013, audit A37).

- [x] T057 Align the multipart browser regression with T055's bounded retry contract after the complete WebKit gate records two genuine 409 responses followed by 201. Verify every retry response/code, two-to-three total attempts, one stable mutation identity and one canonical hierarchy entry in `tests/e2e/files.spec.ts`; retain unrelated-error refusal and renewed complete gates.

- [x] T058 Restore SC-004 under Bun 1.4.2 after the integrated 2 GiB fixture measures 265.5 MiB additional RSS: investigate filesystem read allocations, preserve short-read, length, digest and output-ownership guarantees, test disk corruption races, and repeat the unchanged fixture three times in each runtime mode before renewing complete delivery gates.
- [x] T059 [US4] Make the documented `test:security` and `compose:check` responsibilities explicit in PR/main CI through independently observable blocking jobs, require both from `quality-gate`, and add a workflow contract regression so either job cannot disappear silently (FR-011/FR-013). Focused contract verification passes; complete local/PR/main delivery remains T040/T041.
