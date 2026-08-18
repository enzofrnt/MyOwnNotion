# Tasks: Backup, Recovery and Updates

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Organised by user story so each phase is a complete, independently testable
increment. Tests are included because this feature fails in two ways that are
invisible by inspection — a backup that cannot be restored, and an update that
migrates without one — and neither reports an error at the time.

**Format**: `- [ ] [ID] [P?] [Story?] Description with file path`
`[P]` marks work that touches different files and depends on nothing incomplete.

---

## Phase 1: Setup

- [ ] T001 Add `MYOWNNOTION_BACKUP_DESTINATION`, `MYOWNNOTION_BACKUP_ROOT`, `MYOWNNOTION_BACKUP_HOUR` and `MYOWNNOTION_BACKUP_RETENTION_DAYS` to `.env.example`, each with the default and the failure it prevents
- [ ] T002 [P] Record the backup and restore commands in `docs/development.md` beside the existing administrative ones

---

## Phase 2: Foundational (blocking prerequisites)

**Nothing in phases 3 to 6 can start until this phase is done.**

- [X] T003 Write migration `packages/database/migrations/0005_backups.sql` — `backups`, `backup_verifications`, `restoration_attempts`, idempotent and self-recording like `0004`
- [X] T004 Extend `packages/database/src/schema/index.ts` with the three tables, and say in a comment why verifications are rows rather than columns
- [X] T005 [P] `packages/domain/src/backup/archive-manifest.ts` — the manifest shape, its validation, and the digest rule; pure and total
- [X] T006 [P] `packages/domain/src/backup/compatibility.ts` — whether this installation can read a given backup, returning what to say when it cannot
- [X] T007 [P] `packages/domain/src/backup/retention.ts` — which backups may be deleted, given that a recent verified one must remain
- [X] T008 `apps/api/src/backup/destinations/destination.ts` — the three-method boundary, and `filesystem.ts` implementing it

**Checkpoint**: the pieces exist; nothing is user-visible yet.

---

## Phase 3: User Story 2 — A backup happens and is verified (P1) 🎯 MVP

**Goal**: an encrypted, verified backup is produced without anyone asking.

**Independent test**: run the command, inspect the artefact and the two
verification rows.

*Ordered before User Story 1 deliberately: a restoration needs something to
restore, and this phase is what produces it.*

### Tests for User Story 2

- [X] T009 [P] [US2] Unit test in `packages/domain/tests/backup-manifest.spec.ts` — a manifest missing a digest, naming a file that is absent, or carrying content is refused
- [X] T010 [P] [US2] Unit test in `packages/domain/tests/retention.spec.ts` — the last verified backup is never deletable, whatever its age
- [X] T011 [P] [US2] Contract test in `apps/api/tests/backup-archive.contract.spec.ts` — a produced archive contains no seeded secret, session or key

### Implementation for User Story 2

- [X] T012 [US2] `apps/api/src/backup/backup-service.ts` — build the archive from the canonical export plus the content store, at one cursor, streamed
- [X] T013 [US2] Encrypt before transfer in the same service, reusing feature 002's material — the plaintext archive never reaches a destination
- [X] T014 [US2] Verify after creation and after transfer, recording a row per stage; the second re-reads through the boundary
- [X] T015 [US2] `packages/database/src/repositories/backup-repository.ts` — record backups, verifications and the query behind "a recent verified backup remains"
- [X] T016 [US2] `apps/api/src/backup/schedule.ts` — 04:00 in the configured zone, not holding the process open, and safe across a daylight-saving change
- [ ] T017 [P] [US2] `apps/api/src/admin/commands/backup-run.ts` and `backup-verify.ts` with the exit codes of [contracts/admin-commands.md](./contracts/admin-commands.md)
- [ ] T018 [P] [US2] `apps/web/src/features/backup/backup-panel.tsx` — when the last verified backup succeeded, and the 26-hour warning stated plainly
- [ ] T019 [US2] Retention pass that deletes only after confirming a more recent verified backup remains
- [ ] T020 [P] [US2] Playwright journey in `tests/e2e/backup.spec.ts` — the panel shows a verified backup, and the warning appears when the last one is stale

**Checkpoint**: the workspace is being copied somewhere, verifiably.

---

## Phase 4: User Story 1 — The workspace survives losing the machine (P1)

**Goal**: a backup restores onto an empty installation, completely.

**Independent test**: restore into a disposable database and compare against the
manifest.

### Tests for User Story 1

- [ ] T021 [P] [US1] Integration test in `packages/database/tests/restore.integration.spec.ts` — every item, file, relationship and revision the manifest lists is present after a restore
- [ ] T022 [P] [US1] Contract test in `apps/api/tests/restore-guards.spec.ts` — the six pre-flight steps run in order and the first failure stops before any write

### Implementation for User Story 1

- [ ] T023 [US1] `apps/api/src/backup/restore-service.ts` — read the archive, check the manifest, and write into a target workspace
- [ ] T024 [US1] The six pre-flight steps of FR-015, each refusing with what is missing rather than a generic failure
- [ ] T025 [US1] Refuse an incompatible version, naming both (FR-016), using `compatibility.ts`
- [ ] T026 [US1] Record a `restoration_attempt` when it starts, and finish it — an unfinished row is how an interruption is recognised
- [ ] T027 [US1] Refuse to report health at startup while an unfinished restoration exists, and say how to resume or roll back (FR-017)
- [ ] T028 [P] [US1] `apps/api/src/admin/commands/restore-apply.ts` — `--dry-run`, `--yes`, and no assumed consent when there is no terminal

**Checkpoint**: losing the machine is survivable.

---

## Phase 5: User Story 3 — A restoration can be rehearsed safely (P2)

**Goal**: the owner tests a restoration without risking the live installation.

**Independent test**: rehearse against a live installation and confirm the live
data is untouched.

### Tests for User Story 3

- [ ] T029 [P] [US3] Integration test in `packages/database/tests/restore.integration.spec.ts` — a rehearsal leaves the live workspace byte-identical
- [ ] T030 [P] [US3] Unit test that a rehearsal never opens the live database at all, which is what makes FR-018 structural

### Implementation for User Story 3

- [ ] T031 [US3] Restore into a disposable database and drop it afterwards, reusing the harness that already creates them
- [ ] T032 [US3] `apps/api/src/admin/commands/restore-test.ts` — the safe rehearsal, needing no confirmation
- [ ] T033 [P] [US3] `apps/web/src/features/backup/restore-rehearsal.tsx` — the date, the result, the invitation after a month, and no secret
- [ ] T034 [P] [US3] Playwright journey in `tests/e2e/backup.spec.ts` — a rehearsal is offered, run, and its result shown

**Checkpoint**: the backup is a capability somebody has seen work.

---

## Phase 6: User Story 4 — An update cannot lose data (P2)

**Goal**: no migration runs without a verified backup of the version being left.

**Independent test**: change the recorded version with no verified backup and
confirm no migration ran.

### Tests for User Story 4

- [ ] T035 [P] [US4] Integration test in `packages/database/tests/update-guard.integration.spec.ts` — a failed backup verification stops the migration, and the schema is unchanged
- [ ] T036 [P] [US4] Contract test in `apps/api/tests/version-inspect.spec.ts` — the command reports the versions, the pending migration and whether a verified backup exists

### Implementation for User Story 4

- [ ] T037 [US4] `apps/api/src/backup/update-guard.ts` — detect the version change at startup, before the migrator
- [ ] T038 [US4] Take a `pre-update` backup associated with the version being left, verify it, and refuse to migrate when either fails
- [ ] T039 [US4] Retain what is needed to return: the previous image, the previous format when reversible, and the matching backup (FR-025)
- [ ] T040 [US4] Report an update as successful only after health and integrity checks both pass (FR-026)
- [ ] T041 [P] [US4] `apps/api/src/admin/commands/version-inspect.ts`

**Checkpoint**: the most dangerous operation this product performs has a net under it.

---

## Phase 7: The destination the canvas names

- [ ] T042 `apps/api/src/backup/destinations/google-drive.ts` behind the same three methods, with credentials mounted rather than stored
- [ ] T043 [P] Contract test that the Drive destination satisfies the same boundary suite as the filesystem one, against a recorded interaction

---

## Phase 8: Polish

- [ ] T044 [P] `docs/architecture/backup.md` — why the archive is the export, why a rehearsal writes, and where the update guard lives
- [ ] T045 [P] Accessibility pass over the backup panel and the rehearsal invitation; add them to `tests/e2e/accessibility.spec.ts`
- [ ] T046 [P] Narrow-viewport pass at 320 px, asserted in `tests/e2e/narrow-viewport.spec.ts`
- [ ] T047 CI job restoring a reference backup for every supported migration path (SC-009)
- [ ] T048 Measure a backup and a restore on a workspace with a thousand items and record the figures in `validation.md`
- [ ] T049 Write `specs/007-backup-recovery-updates/validation.md` with evidence per requirement, marking anything unfinished as unfinished rather than ticking it

---

## Dependencies

- **Phase 2 blocks everything.** The tables, the manifest rules and the
  destination boundary are used by every story.
- **US2 before US1**: a restoration needs an archive to restore.
- **US3 depends on US1** — a rehearsal is a restoration into a different place.
- **US4 depends on US2** only: it needs a backup it can verify, not a restore.
- **Phase 7 is independent** of every story, because the boundary is what the
  stories depend on rather than any particular destination.

## Implementation strategy

**MVP is US2 plus US1.** A verified backup that has never been restored is a
belief, and a restoration with nothing to restore is a function. Neither alone is
worth shipping; together they are the feature. US3 turns it into something the
owner has seen work, and US4 puts it under the operation most likely to need it.

## Parallel opportunities

- Phase 2: T005, T006 and T007 together — three pure modules, no shared file.
- US2: T009, T010 and T011 (tests) together; T017 and T018 together.
- US1: T021 and T022 together.
- Phase 8: T044, T045 and T046 together.
