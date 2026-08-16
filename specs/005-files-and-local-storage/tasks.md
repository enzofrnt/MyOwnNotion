# Tasks: Files and Local Storage

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

Organised by user story so each phase is a complete, independently testable
increment. Tests are included because this feature can lose an owner's data in
three distinct ways — a broken reference, a corrupt resumed upload, and an
eviction that releases unsynchronized work — and none of the three is visible
by inspection.

**Format**: `- [ ] [ID] [P?] [Story?] Description with file path`
`[P]` marks work that touches different files and depends on nothing incomplete.

---

## Phase 1: Setup

- [ ] T001 Add the tus server dependency and pin it, then record it in `docs/development.md` alongside the existing toolchain table
- [ ] T002 [P] Vendor the Draw.io editor assets under `apps/web/public/drawio/` with the upstream version recorded in a `VERSION` file beside them
- [ ] T003 [P] Add `MYOWNNOTION_MAX_FILE_BYTES` to `.env.example` with the 2 GB default and a note that the real bound is what the proxy and storage carry

---

## Phase 2: Foundational (blocking prerequisites)

**Nothing in phases 3 to 6 can start until this phase is done.**

- [X] T004 Write migration `packages/database/migrations/0003_files_and_offline.sql` — `file_usages`, `uploads`, and `items.offline_intent` — idempotent and self-recording like `0002`
- [X] T005 Extend `packages/database/src/schema/index.ts` with the three additions from [data-model.md](./data-model.md)
- [X] T006 [P] Add `offlineIntent` to the item read model in `packages/database/src/repositories/item-reader.ts` and to the revision snapshot in `revision-repository.ts`, so it reaches every device
- [X] T007 [P] Add `offlineIntent` and `localAvailability` to `LocalItemRow` in `packages/client-core/src/local-store/schema.ts`, with a Dexie version bump and an upgrade that defaults them
- [X] T008 [P] Add `ItemSchema.offlineIntent` and the upload DTOs to `packages/contracts/src/content-api.ts`

**Checkpoint**: schema in place on both sides; nothing user-visible yet.

---

## Phase 3: User Story 1 — Seeing and organising files (P1) 🎯 MVP

**Goal**: every file states what it is, where it lives, and what uses it.

**Independent test**: attach several files to a page, place one in the
hierarchy, open the attachment list, and confirm all nine fields per row.

### Tests for User Story 1

- [X] T009 [P] [US1] Property test in `packages/domain/tests/file-usages.property.spec.ts` — extracting embeds from any valid block document finds every file reference and invents none
- [X] T010 [P] [US1] Integration test in `packages/database/tests/file-usages.integration.spec.ts` — the index matches reality after attach, embed, move, and remove

### Implementation for User Story 1

- [X] T011 [P] [US1] `packages/domain/src/files/usages.ts` — pure extraction of file references from a block document, total and never throwing on an unknown block
- [X] T012 [US1] `packages/database/src/repositories/content/usage-repository.ts` — write the derived index inside the mutation transaction whenever a document or placement changes
- [X] T013 [US1] Expose usages on the item read path in `packages/database/src/repositories/item-reader.ts` so a file reports every page that attaches or embeds it (FR-005)
- [X] T014 [P] [US1] `apps/web/src/features/files/attachment-list.tsx` — the nine fields of FR-002, each reachable by keyboard
- [X] T015 [US1] Show local availability and sync state per row in `apps/web/src/features/files/attachment-list.tsx`, using the three distinct states rather than a boolean (FR-002)
- [X] T016 [P] [US1] Playwright journey in `tests/e2e/files.spec.ts` — a page with three attachments states every field; a file used twice lists both usages

**Checkpoint**: files are findable and truthfully described.

---

## Phase 4: User Story 2 — Moving, renaming, deleting without losing references (P1)

**Goal**: a reference never breaks, and no in-use file is deleted unseen.

**Independent test**: attach a file to two pages, rename it, move it, confirm
both still resolve it; delete it and confirm the dialogue names both usages.

### Tests for User Story 2

- [ ] T017 [P] [US2] Integration test in `packages/database/tests/file-references.integration.spec.ts` — rename and move leave every reference resolving
- [ ] T018 [P] [US2] Domain test in `packages/domain/tests/file-deletion.spec.ts` — a deletion plan refuses while usages remain and lists them

### Implementation for User Story 2

- [ ] T019 [US2] `packages/domain/src/files/deletion.ts` — pure plan: what a deletion would remove, what still uses it, whether confirmation is required (FR-004)
- [ ] T020 [US2] Assert in `packages/database/src/repositories/move-branch.ts` and `execute-command.ts` that rename and move rewrite no reference — identity is the item, not the name or the path (FR-003)
- [ ] T021 [P] [US2] `apps/web/src/features/files/delete-file.tsx` — an `alertdialog` naming every usage before anything is destroyed
- [ ] T022 [US2] Route a confirmed deletion through the existing trash in `packages/database/src/repositories/lifecycle-repository.ts` rather than a second mechanism
- [ ] T023 [P] [US2] Playwright journey in `tests/e2e/files.spec.ts` — rename, move, both usages still resolve; deletion names both and declining changes nothing

**Checkpoint**: the file experience is safe to use for real content.

---

## Phase 5: User Story 3 — Previewing and editing safely (P2)

**Goal**: files open in the application without giving file content the
application's privileges.

**Independent test**: upload one file of each previewable type plus an
unrecognised one; each previews or states name, type and size with a download.

### Tests for User Story 3

- [ ] T024 [P] [US3] Contract test in `apps/api/tests/file-download.spec.ts` — every download carries `Content-Disposition: attachment`, `nosniff`, and the restrictive policy
- [ ] T025 [P] [US3] Playwright journey in `tests/e2e/file-preview.spec.ts` — an SVG carrying script cannot reach the workspace around it

### Implementation for User Story 3

- [ ] T026 [US3] Serve downloads inert in `apps/api/src/routes/files.ts` — the three headers of [contracts/file-transfer.md](./contracts/file-transfer.md), plus `Range` for progressive PDF
- [ ] T027 [US3] `apps/web/src/features/files/file-preview.tsx` — a sandboxed frame fed opaque bytes, with no same-origin access (FR-013)
- [ ] T028 [P] [US3] Preview PDF, SVG, PNG, JPEG, GIF and WebP through that one frame in `apps/web/src/features/files/file-preview.tsx` (FR-010)
- [ ] T029 [P] [US3] `apps/web/src/features/files/unsupported-file.tsx` — name, type, size and a download or external-open action (FR-012)
- [ ] T030 [US3] `apps/web/src/features/files/drawio-editor.tsx` — the vendored engine, served from this origin, never `diagrams.net`
- [ ] T031 [US3] Save a Draw.io edit through the ordinary save path in `apps/web/src/features/files/drawio-editor.tsx` so its state is reported like any other content (FR-011)
- [ ] T032 [P] [US3] Playwright journey in `tests/e2e/file-preview.spec.ts` asserting no request leaves this origin while editing a diagram — a request to `diagrams.net` fails the test

**Checkpoint**: files are useful, and previewing one is not a risk.

---

## Phase 6: User Story 4 — Keeping what matters available offline (P2)

**Goal**: the owner decides what stays, the device says what it holds, and no
eviction costs unsaved work.

**Independent test**: mark a branch always available, go offline, open
everything in it; lower the limit and confirm what is offloaded and how it
reads.

### Tests for User Story 4

- [ ] T033 [P] [US4] Property test in `packages/domain/tests/eviction.property.spec.ts` — for any workspace and any limit, the plan never releases unsynchronized changes, unresolved conflicts, or content under an offline intent
- [ ] T034 [P] [US4] Unit test in `packages/client-core/tests/availability.spec.ts` — `offloaded` and `never-fetched` stay distinct through a full cycle

### Implementation for User Story 4

- [ ] T035 [US4] `packages/domain/src/files/eviction.ts` — the priority order of [data-model.md](./data-model.md), pure and total; recoverability admits, size and age only order
- [ ] T036 [US4] `item.offline` command across `packages/domain/src/content/mutations.ts`, `packages/database/src/mutations/execute-command.ts`, `packages/contracts/src/content-api.ts` and `apps/api/src/routes/items.ts`, carrying the desired state rather than toggling (FR-016)
- [ ] T037 [US4] Resolve a folder's offline intent by inheritance at read time in `packages/database/src/repositories/item-reader.ts`, so moving a branch cannot strand a stale marking
- [ ] T038 [P] [US4] `packages/client-core/src/local-store/availability.ts` — the three states and the transitions between them
- [ ] T039 [P] [US4] `packages/client-core/src/local-store/budget.ts` — measure with `navigator.storage.estimate()`, request `persist()`, record the measurement time
- [ ] T040 [US4] Run the eviction pass in `packages/client-core/src/local-store/budget.ts` when measured usage exceeds the limit, recording what was released and why (FR-017, FR-018)
- [ ] T041 [P] [US4] `apps/web/src/features/files/storage-panel.tsx` — limit, usage, breakdown, and what was offloaded (FR-019)
- [ ] T042 [P] [US4] Mark offloaded and never-fetched content in `apps/web/src/features/hierarchy/hierarchy-explorer.tsx` and the attachment list, never as missing
- [ ] T043 [US4] Retrieve offloaded content on open in `apps/web/src/features/files/file-preview.tsx`, saying so while it fetches; offline, say the connection is what is missing
- [ ] T044 [P] [US4] Playwright journey in `tests/e2e/offline-availability.spec.ts` — a marked branch opens with no network; at the limit, an unsynchronized change survives

**Checkpoint**: the product is local-first rather than a website that caches.

---

## Phase 7: Resumable transfer (cross-cutting, needed by US1 and US3)

Placed last because nothing above depends on resumability to be *testable*,
and it is the largest single piece.

- [ ] T045 [P] Contract test in `apps/api/tests/uploads.spec.ts` — `HEAD` reports the server's offset; a `PATCH` at a disagreeing offset is refused rather than corrected
- [ ] T046 `packages/database/src/repositories/content/upload-repository.ts` — the upload lifecycle, including expiry of abandoned uploads
- [ ] T047 `apps/api/src/routes/uploads.ts` — `POST`, `HEAD`, `PATCH` per [contracts/file-transfer.md](./contracts/file-transfer.md)
- [ ] T048 Refuse an oversized upload in `apps/api/src/routes/uploads.ts` before accepting a byte, stating the limit and the reason (FR-008, FR-009)
- [ ] T049 Complete an upload in one transaction in `packages/database/src/repositories/content/upload-repository.ts` — hash, deduplicate against `file_contents`, set `verified_at`, create the logical file and its placement (FR-007)
- [ ] T050 [P] Client-side resume in `apps/web/src/features/files/upload.ts` — seek to the server's offset, never to a locally remembered one
- [ ] T051 [P] Report `uploading`, `verifying`, `synchronized` and `blocked` in `apps/web/src/features/files/transfer-state.tsx`, mirroring the save states of feature 003
- [ ] T052 [P] Playwright journey in `tests/e2e/file-transfer.spec.ts` — an interrupted transfer resumes rather than restarting, and a partial upload never appears in the tree

---

## Phase 8: Polish

- [ ] T053 [P] `docs/architecture/file-handling.md` — why previews are sandboxed, why Draw.io is self-hosted, and what admits content to eviction
- [ ] T054 [P] Accessibility pass over the attachment list, the preview frame, the deletion dialogue and the storage panel; add them to `tests/e2e/accessibility.spec.ts`
- [ ] T055 [P] Narrow-viewport pass at 320 px for the same four surfaces, asserted in `tests/e2e/narrow-viewport.spec.ts`
- [ ] T056 Write `specs/005-files-and-local-storage/validation.md` with evidence per requirement, marking anything unfinished as unfinished rather than ticking it

---

## Dependencies

- **Phase 2 blocks everything.** Schema first on both sides.
- **US1 before US2**: a deletion cannot enumerate usages before usages exist.
- **US3 and US4 are independent of each other**; both need US1.
- **Phase 7 is independent of US2 to US4** and can proceed in parallel with
  them once phase 2 is done.

## Implementation strategy

**MVP is US1 + US2.** Files that are findable, truthfully described, and safe
to move or delete. That is a usable file experience without a single preview,
and it is the part where being wrong loses content rather than convenience.

US3 then makes files useful, US4 makes them available offline, and phase 7
makes large ones practical. Each phase ends at a checkpoint that can ship.

## Parallel opportunities

- Phase 1: T002 and T003 together.
- Phase 2: T006, T007 and T008 together once T004 and T005 land.
- US1: T009 and T010 (tests) together; T011 and T014 together.
- US3: T024 and T025 together; T028 and T029 together.
- US4: T033 and T034 together; T038, T039 and T041 together.
