# Tasks: Complete server backups

## Phase 1 — Setup

- [x] T001 Inspect current backup, migration, upload and runtime paths; record findings and primary sources in `specs/024-full-server-backups/research.md`.
- [x] T002 Resolve cross-artifact coverage, source-version and security reactivation decisions in `specs/024-full-server-backups/analysis.md` before implementation.

## Phase 2 — Foundations

- [x] T003 Define and test full manifest/framing validation in `packages/domain/src/backup/full-manifest.ts` and `packages/domain/tests/full-manifest.spec.ts`.
- [x] T004 Add stream-only authenticated encryption and bounded archive IO in `apps/api/src/backup/full/crypto.ts`, `archive.ts` and `apps/api/tests/full-backup-archive.spec.ts`; cover corruption, truncation, unsafe names and interruption without plaintext staging.
- [x] T005 Add source inspection and PostgreSQL process adapters in `apps/api/src/backup/full/source.ts` and `postgres.ts`; preserve unknown source provenance and keep credentials out of argv/logs.
- [x] T006 Install verified PG18 client tools in `docker/api.Dockerfile`, update local/CI prerequisites and verify both architectures with existing image/Compose contracts.

## Phase 3 — US1: Complete recoverable data

**Independent test**: Restore an actual PG18 dump and all file bytes, including
an extra table not known to content repositories, without the source catalogue.

- [x] T007 [US1] Add `apps/api/tests/full-backup.integration.spec.ts` with real source/target DBs, sequences, unknown table, auth/envelopes, operations and attachments.
- [x] T008 [US1] Implement schema-independent backup and file coordination in `apps/api/src/backup/full/locks.ts`, integrating upload prefix mutations in `apps/api/src/routes/uploads.ts` and actual blob deletion paths.
- [x] T009 [US1] Implement snapshot/dump/file capture, local verification, atomic publication and independent receipts in `apps/api/src/backup/full/service.ts` and `receipts.ts`; keep verified local files after remote failures.
- [x] T010 [US1] Implement authenticated empty-target restoration and incomplete-state handling in `apps/api/src/backup/full/restore.ts`; preserve historical records but require explicit security reactivation before service.
- [x] T011 [US1] Add pre-context CLI full run/inspect/verify/restore routing in `apps/api/src/admin/full-backup-commands.ts` and `admin-cli.ts` following `contracts/admin-commands.md`.
- [x] T012 [US1] Prove concurrent upload finalization/deletion, interrupted archive creation, bad keys and refused targets in `apps/api/tests/full-backup-consistency.integration.spec.ts` and `full-restore.integration.spec.ts`.

## Phase 4 — US2: Pre-migration safety

**Independent test**: A source older than migration 0006 stays unchanged when
backup fails; successful backup carries source V0/unknown rather than target version.

- [x] T013 [US2] Extend `packages/database/tests/update-guard.integration.spec.ts` for no pre-backup schema mutation, source provenance, empty initialization and failed integrity.
- [x] T014 [US2] Replace bootstrap-before-backup in `apps/api/src/backup/guarded-migration.ts` with catalogue inspection, verified full backup and post-migration integrity/version recording.
- [x] T015 [US2] Keep full-backup provenance/receipts discoverable after migration failure in `apps/api/src/backup/full/source.ts`, `receipts.ts` and administrative version output.

## Phase 5 — US3: Nightly protection and retry

**Independent test**: Controlled clock covers 04:00, failed run/retry, downtime,
DST and concurrent scheduler/CLI calls; remote outage retains local protection.

- [x] T016 [US3] Extend `apps/api/tests/backup-schedule.spec.ts` for verified-success deadlines, same-day retries, boot catch-up and time-zone changes.
- [x] T017 [US3] Wire complete backup scheduling and verified outcomes in `apps/api/src/server.ts`, `backup/schedule.ts`, `backup/backup-config.ts`, `.env.example` and `compose.yaml`.
- [x] T018 [US3] Implement remote retry and conservative full-artifact retention in `apps/api/src/backup/full/service.ts` and `receipts.ts`; test last-copy preservation and lost-catalogue recovery.

## Phase 6 — US4: Inspection and rehearsal

**Independent test**: CLI and backup settings distinguish full/local/remote/portable
results; a real isolated rehearsal reports verification without touching live data.

- [x] T019 [US4] Add complete backup status and rehearsal contracts in `packages/contracts/` and `apps/api/src/routes/backups.ts`, preserving portable status explicitly.
- [x] T020 [US4] Load `.agents/skills/ui-quality/SKILL.md` and update `apps/web/src/features/backup/` for clear full protection, source version, failure and rehearsal states.
- [x] T021 [US4] Cover full backup states, 26-hour warning, keyboard/narrow layout and actual rehearsal in `tests/e2e/backup.spec.ts` and focused API tests.

## Phase 7 — Convergence and delivery

- [x] T022 Update `docs/architecture/backup.md`, `docs/deployment/backups.md`, `docs/development.md` and feature 007 artifacts with full/portable distinction, recovery keys, image tooling and actual commands.
- [ ] T023 Run real production-image backup/restore checks, Spec Kit convergence and required `bun run checks:local`; record evidence and limits in `specs/024-full-server-backups/validation.md`.
- [ ] T024 Run current pre-push gates, all PR CI, merge after green checks and verify all main CI; record provenance in `specs/024-full-server-backups/validation.md`.

## Dependencies and strategy

T001 → T002 → T003–T006 → US1 → US2 → US3 → US4 → T022–T024.
T003 manifest review and T006 runtime-package research can proceed independently,
but no integration is complete without both. US1 provides the smallest useful
recovery capability; later stories add automatic protection and observability.
Full validation and production-image tests must use isolated fixtures, not the
owner's source checkout or live database. Preserve existing page-operation
retention evidence until full backups explicitly prove equivalent coverage.

## Phase 8: Convergence

- [x] T025 Reject unsupported PostgreSQL major versions during authenticated manifest parsing in `packages/domain/src/backup/full-manifest.ts`, before any restore target writes; cover older/future versions and malformed source provenance in `packages/domain/tests/full-manifest.spec.ts` per FR-015/FR-016 and SC-003 (partial, HIGH).

- [x] T026 Close provider upload sources on credential/session preflight failure and handle early source-read errors in `apps/api/src/backup/destinations/google-drive.ts`; verify refused/partial uploads, safe provider diagnostics and retained local archives per FR-005/FR-007 (partial, HIGH).

- [x] T027 Align existing accessibility, narrow-layout and settings-history journeys with full backup as the primary panel and explicitly opened portable exports in `tests/e2e/accessibility.spec.ts`, `tests/e2e/narrow-viewport.spec.ts` and `tests/e2e/workspace-settings-boundary.spec.ts`; retain both surfaces' checks (FR-018/FR-019).


## Storage audit follow-up — feature 025

Feature 025 follows delivery of this feature. Its historical storage transition requires a verified full pre-update artifact. Full inventory becomes format-aware for encrypted completed/upload chunks and quarantine while retaining legacy-schema recovery; complete archive format remains opaque SQL plus durable files.

See the [canonical plan](../025-storage-coherence-audit/plan.md) and
[implementation tasks](../025-storage-coherence-audit/tasks.md). This reference
does not mark that follow-up implemented or delivered.

## Phase 9 — Historical backup keys

- [x] T028 Preserve complete-backup recovery across wrapping-key rotation: implement bounded external historical-key configuration and private loading, current-only writes and authenticated historical reads for archives/receipts/activity/rehearsal, wire all runtime and CLI entry points, preserve explicit restore keys and immutable archives, document optional Docker mounting and version/fingerprint custody, remove destructive rotation advice, and verify real A→B rotation/catalogue/scheduling/retry/retention/A restoration with restored root-key access and refusal tests. Record focused checks in `validation.md`; T023/T024 remain integration delivery gates.

- [ ] T029 Bound per-component archive-reader resources in `apps/api/src/backup/full/crypto.ts`: reproduce retained FileHandle close listeners across completed/cancelled reads, use bounded positional I/O without weakening authentication or truncation checks, verify archive and real recovery suites plus the existing performance budget, and record integration evidence (FR-007/FR-015/FR-016, audit A31).

- [ ] T030 Run full-image recovery verification without a host Bun installation: parse the backup receipt with the tested image's pinned runtime, reproduce the CI host boundary locally with Bun absent from PATH, and retain full real restore, activation and provenance assertions plus renewed delivery gates.
