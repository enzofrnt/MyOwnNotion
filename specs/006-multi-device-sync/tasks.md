# Tasks: Multi-Device Synchronization

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Organised by user story so each phase is a complete, independently testable
increment. Tests are included because this feature can lose an owner's work in
two ways that are invisible by inspection — an event that never arrives, and a
merge that silently prefers one version — and neither shows up as an error.

**Format**: `- [ ] [ID] [P?] [Story?] Description with file path`
`[P]` marks work that touches different files and depends on nothing incomplete.

---

## Phase 1: Setup

- [ ] T001 Add `PROTOCOL_VERSION`, `MINIMUM_READ_VERSION` and `MINIMUM_WRITE_VERSION` to `packages/domain/src/sync/protocol-version.ts`, with the two-stable-version window documented beside them
- [ ] T002 [P] Record the compatibility window in `docs/development.md` next to the toolchain table, so a release knows what it may drop
- [ ] T003 [P] Add `MYOWNNOTION_SSE_HEARTBEAT_MS` to `.env.example` with its default and a note that a proxy silently drops an idle stream

---

## Phase 2: Foundational (blocking prerequisites)

**Nothing in phases 3 to 6 can start until this phase is done.**

- [ ] T004 Write migration `packages/database/migrations/0004_revision_device.sql` — nullable `revisions.authored_by_device_id`, idempotent and self-recording like `0003`
- [ ] T005 Extend `packages/database/src/schema/index.ts` with the column, and say in a comment why it is nullable rather than defaulted
- [ ] T006 [P] `apps/api/src/sync/change-notifier.ts` — in-process fan-out: register a subscriber, publish a cursor, drop a closed one
- [ ] T007 [P] `apps/api/src/plugins/protocol.ts` — set `X-MyOwnNotion-Protocol` on every response through an `onSend` hook

**Checkpoint**: the pieces exist; nothing is user-visible yet.

---

## Phase 3: User Story 1 — A change appears on the other device (P1) 🎯 MVP

**Goal**: a change on one device reaches every other connected device in under
two seconds, without that device asking.

**Independent test**: open two contexts, change something in one, watch the
other without touching it.

### Tests for User Story 1

- [ ] T008 [P] [US1] Contract test in `apps/api/tests/change-stream.spec.ts` — the stream emits `advanced` with the new cursor and carries no content
- [ ] T009 [P] [US1] Unit test in `apps/api/tests/change-notifier.spec.ts` — a closed subscriber is dropped rather than written to, and one slow subscriber does not block another

### Implementation for User Story 1

- [ ] T010 [US1] `apps/api/src/routes/change-stream.ts` — `GET /v1/changes/stream` as SSE, with `Cache-Control: no-store` and the heartbeat of [contracts/live-stream.md](./contracts/live-stream.md)
- [ ] T011 [US1] Publish from `packages/database/src/repositories/change-repository.ts` after the change row commits — never before, or a device fetches a cursor the database has not reached
- [ ] T012 [P] [US1] `apps/web/src/features/sync/use-change-stream.ts` — subscribe, and on each event let the existing puller fetch from *its own* cursor
- [ ] T013 [P] [US1] `apps/web/src/features/sync/connection-state.tsx` — connected, or keeping changes locally (FR-010)
- [ ] T014 [P] [US1] Playwright journey in `tests/e2e/live-sync.spec.ts` — two contexts; an edit, a rename, a move and a file each appear in the other within two seconds

**Checkpoint**: the workspace feels like one workspace.

---

## Phase 4: User Story 2 — A device that was away misses nothing (P1)

**Goal**: a device that reconnects receives everything since its position, in
order, or is rebuilt from a snapshot.

**Independent test**: take a device offline, make many changes elsewhere, bring
it back, compare state.

### Tests for User Story 2

- [ ] T015 [P] [US2] Contract test in `apps/api/tests/change-stream.spec.ts` — a `Last-Event-ID` older than the retained window yields `compacted`, never a gap
- [ ] T016 [P] [US2] Property test in `packages/client-core/tests/catch-up.property.spec.ts` — for any interleaving of notifications and fetch failures, the applied cursor never skips a change

### Implementation for User Story 2

- [ ] T017 [US2] Honour `Last-Event-ID` in `apps/api/src/routes/change-stream.ts`, deciding between `advanced` and `compacted` from the retained window
- [ ] T018 [US2] Keep "told about" and "applied" apart in `apps/web/src/features/sync/use-change-stream.ts` — the device's cursor is the authority, because a notification can arrive and its fetch can fail
- [ ] T019 [US2] Rebuild from `/v1/snapshots/current` on `compacted` while keeping the outbox, reusing the existing path rather than a second one
- [ ] T020 [P] [US2] Playwright journey in `tests/e2e/live-sync.spec.ts` — twenty changes while offline, then reconnect; every one arrives and the two contexts agree

**Checkpoint**: no change can be lost by being away.

---

## Phase 5: User Story 3 — A real conflict is resolvable (P1)

**Goal**: compatible changes merge; a genuine divergence is presented with three
versions and resolved into a new one that keeps both sources.

**Independent test**: diverge two devices on the same block, resolve, confirm
both originals remain.

### Tests for User Story 3

- [ ] T021 [P] [US3] Property test in `packages/domain/tests/merge-documents.property.spec.ts` — a merge never loses a block that changed on exactly one side, and never silently resolves a block that changed on both
- [ ] T022 [P] [US3] Unit test in `packages/domain/tests/merge-documents.spec.ts` — the whole table from [contracts/conflict-resolution.md](./contracts/conflict-resolution.md), including deleted-on-one-side-and-rewritten-on-the-other
- [ ] T023 [P] [US3] Integration test in `packages/database/tests/resolution-lineage.integration.spec.ts` — a resolution revision has both conflicting revisions as parents

### Implementation for User Story 3

- [ ] T024 [US3] `packages/domain/src/sync/merge-documents.ts` — pure and total over ancestor, local and remote; returns merged or the blocks needing the owner
- [ ] T025 [US3] Merge automatically in `packages/client-core/src/reconciliation/reconcile.ts` when nothing is conflicted, so an owner is not asked about different paragraphs (FR-013)
- [ ] T026 [US3] `packages/client-core/src/reconciliation/resolve-conflict.ts` — write the resolution with both revisions as parents (FR-016)
- [ ] T027 [P] [US3] `apps/web/src/features/sync/conflict-resolution.tsx` — three columns, per-block choice, reorder, and a review of exactly what will be saved
- [ ] T028 [US3] Reach the screen from the existing notice in `apps/web/src/features/save-state/conflict-notice.tsx`, so a conflict leads somewhere instead of only being reported
- [ ] T029 [P] [US3] Playwright journey in `tests/e2e/conflict-resolution.spec.ts` — different blocks merge silently; the same block conflicts, resolves, and both originals remain retrievable
- [ ] T030 [P] [US3] Playwright journey in `tests/e2e/conflict-resolution.spec.ts` asserting a device that is merely behind produces no conflict (FR-011), so the property is protected rather than assumed

**Checkpoint**: a conflict is a moment, not a permanent state.

---

## Phase 6: User Story 4 — Version mismatch and revoked devices fail safely (P2)

**Goal**: an out-of-date client refuses to write and says what to update; a
revoked device stops.

**Independent test**: announce an unsupported version and write; separately,
revoke a connected device.

### Tests for User Story 4

- [ ] T031 [P] [US4] Unit test in `packages/domain/tests/protocol-version.spec.ts` — the window admits the matching and preceding stable versions, and the two thresholds make read-only expressible
- [ ] T032 [P] [US4] Contract test in `apps/api/tests/protocol-gate.spec.ts` — a write below the write minimum is refused with what to update; a read at that version still succeeds

### Implementation for User Story 4

- [ ] T033 [US4] Enforce the gate on writes in `apps/api/src/plugins/protocol.ts`, leaving reads open wherever they are safe (FR-020)
- [ ] T034 [US4] Refuse a revoked device's stream in `apps/api/src/routes/change-stream.ts` and close any open one (FR-021)
- [ ] T035 [P] [US4] Say what happened in `apps/web/src/features/sync/connection-state.tsx` — an update needed, or access withdrawn
- [ ] T036 [P] [US4] Playwright journey in `tests/e2e/protocol-compatibility.spec.ts` — read-only rather than locked out, and a revoked device stops within a minute

**Checkpoint**: the failure modes that corrupt or over-permit are closed.

---

## Phase 7: History attribution

- [ ] T037 Record the authoring device in `packages/database/src/repositories/revision-repository.ts`, taken from the request's device rather than from anything the client asserts
- [ ] T038 [P] Show date, device and nature per entry in `apps/web/src/features/history/revision-restore.tsx` (FR-022)
- [ ] T039 [P] Contract test in `apps/api/tests/history-attribution.spec.ts` — no entry carries a session identifier or key material (FR-023)

---

## Phase 8: Polish

- [ ] T040 [P] `docs/architecture/synchronization.md` — why the event carries a position, why detection was not rebuilt, and what the merge refuses to decide
- [ ] T041 [P] Accessibility pass over the resolution screen and the connection state; add them to `tests/e2e/accessibility.spec.ts`
- [ ] T042 [P] Narrow-viewport pass at 320 px for the three-column resolution screen, asserted in `tests/e2e/narrow-viewport.spec.ts`
- [ ] T043 Measure the two-second target in `tests/e2e/live-sync.spec.ts` over repeated attempts, and record the observed figure in `validation.md`
- [ ] T044 Write `specs/006-multi-device-sync/validation.md` with evidence per requirement, marking anything unfinished as unfinished rather than ticking it

---

## Dependencies

- **Phase 2 blocks everything.** The notifier and the protocol hook are used by
  every story.
- **US1 before US2**: catch-up is the same stream with a position.
- **US3 is independent of US1 and US2** — it needs no transport, only the
  reconciliation that already exists — and is therefore the safest phase to run
  in parallel.
- **US4 depends on phase 2** only.
- **Phase 7 is independent** of every story.

## Implementation strategy

**MVP is US1.** A change appearing on another device is the feature; everything
else protects it. US2 makes it trustworthy, US3 makes divergence recoverable, and
US4 closes the two failure modes that corrupt or over-permit.

US3 is worth starting early despite being third: the merge rule is pure, so it
can be written and tested while the transport is still being wired.

## Parallel opportunities

- Phase 1: T002 and T003 together.
- Phase 2: T006 and T007 together once T004 and T005 land.
- US1: T008 and T009 (tests) together; T012 and T013 together.
- US3: T021, T022 and T023 together; T024 can proceed while the transport work
  continues.
- US4: T031 and T032 together.
