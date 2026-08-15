# Tasks: Unified Items and Page/Folder Conversion

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Branch**: `004-unified-items-conversion`

**Design inputs**: [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests are mandatory.** Constitution principle III requires automated tests for
changed behaviour and a Playwright journey for every changed interactive flow.
Test tasks sit inside each story rather than in a polish phase.

**Organisation**: one phase per user story, in priority order. US1 alone —
folder becomes page — is shippable and useful on its own.

---

## Phase 1: Setup

- [X] T001 Reset the local database volume so the collapsed migration applies cleanly: `docker compose down -v && docker compose up -d --wait postgres`
- [X] T002 Record the migration-collapse exception in `plan.md` Complexity Tracking with its removal condition — *already written; verify it survived review before implementing*

**Checkpoint**: a clean database, and the exception documented where the constitution requires.

---

## Phase 2: Foundational — the schema and the domain rules

**Blocking**: every story depends on this. Nothing in Phase 3+ starts until the checkpoint passes.

**Why first**: the schema is what makes the kind mutable at all. Building the interface first would mean writing it against a constraint that still forbids the operation.

### Schema

- [X] T003 Collapse `packages/database/migrations/0001`–`0005` into a single `0001_initial.sql`, preserving every table, constraint and index that exists today
- [X] T004 In `0001_initial.sql`, add `is_file boolean GENERATED ALWAYS AS (kind = 'file') STORED` to `items` with a unique index on `(id, is_file)`
- [X] T005 In `0001_initial.sql`, replace `placements.item_kind` with `item_is_file boolean` and repoint the composite foreign key at `(id, is_file)`, keeping both constraints that used it (`placements_attachment_file_check`, `placements_single_hierarchy_unique`)
- [X] T006 Mirror the change in `packages/database/src/schema/index.ts`, keeping the comment explaining *why* the denormalisation copies the immutable property rather than the kind
- [X] T007 Verify the migration self-registers in `schema_migrations`, as every migration in this repository must

### Domain rules

- [X] T008 Define the conversion rules in `packages/domain/src/content/conversion.ts` — the total transition table from [data-model.md](./data-model.md), including the no-op and the file exclusion
- [X] T009 Require `confirmedDestruction` when a page holding content becomes a folder, in `packages/domain/src/content/conversion.ts` (FR-010, FR-014)
- [X] T010 Add the `item.convert` command to `packages/domain/src/content/mutations.ts` and its error codes to `types.ts` (`conversion.confirmation-required`, `conversion.file-not-convertible`)
- [X] T011 [P] Update `packages/domain/src/content/file-placements.ts` to read the item's file-ness rather than its kind, so the rules keep working when the kind changes
- [X] T012 [P] Document the command shape in `packages/contracts/src/content-api.ts`, per [contracts/convert-mutation.md](./contracts/convert-mutation.md)

### Tests

- [X] T013 [P] Unit tests in `packages/domain/tests/conversion.spec.ts` — every row of the transition table, including the no-op and both file refusals
- [X] T014 [P] Unit tests in `packages/domain/tests/conversion.spec.ts` — a page with content is refused without confirmation, and accepted with it
- [X] T015 [P] Property test in `packages/domain/tests/conversion.property.spec.ts` — over generated trees, every hierarchy child keeps its parent and position through a conversion in either direction
- [X] T016 [P] Property test in `packages/domain/tests/conversion.property.spec.ts` — identity and revision lineage are preserved, and converting twice is the same as converting once

**Checkpoint**: passed ✅ — 20 conversion tests, 858 unit, 292 property, 242 integration, 750 contract. The kind is mutable, the rules exist and the command executes, with no interface yet.

**Planning correction**: T017 and T025 were listed in Phases 3 and 4 but had to land here. TypeScript's exhaustive command switch does not compile with a command that has no execution, so `item.convert` could not exist as a parsed command without its repository. Splitting them across phases was a planning error rather than a scope change, and the phases that follow are correspondingly lighter.

---

## Phase 3: User Story 1 — Turn a folder into a page (P1) 🎯 MVP

**Goal**: an owner converts a folder to a page and writes in it; every child stays where it was.

**Independent test**: folder with two pages and a file inside, convert, write a sentence, reload — the sentence is there and all three children are in place, in order.

- [X] T017 [US1] Implement the conversion in one transaction in `packages/database/src/repositories/content/conversion-repository.ts` — the kind change and the revision, committed together
- [ ] T018 [US1] Route the command to the domain in `apps/api/src/routes/` so it goes through the same validation as every other mutation
- [ ] T019 [US1] Apply the conversion to the local projection in `packages/client-core/src/outbox/apply-to-projection.ts`, so it works offline like every other command
- [ ] T020 [P] [US1] Add the conversion control to `apps/web/src/features/navigation/convert-item.tsx`, reachable from the keyboard (FR-018)
- [ ] T021 [US1] Reflect the new kind in the tree without a reload in `apps/web/src/features/navigation/tree.tsx` (FR-017)
- [X] T022 [P] [US1] Integration test in `packages/database/tests/conversion.integration.spec.ts` — converting touches no placement row and the composite key still holds
- [ ] T023 [US1] Playwright journey in `tests/e2e/item-conversion.spec.ts` — folder with children becomes a page, content is written, children survive a reload in order
- [ ] T024 [P] [US1] Playwright case in `tests/e2e/item-conversion.spec.ts` — folder to page asks for no confirmation, because nothing is lost (FR-009)

**Checkpoint**: US1 is shippable on its own. An owner can turn a container into something they can write in.

---

## Phase 4: User Story 2 — Turn a page into a folder (P1)

**Goal**: the destructive direction, with a confirmation that tells the truth about what is lost and for how long it can be undone.

**Independent test**: page with content and two child pages, convert, confirm the warning names the loss, verify children intact and content restorable.

- [X] T025 [US2] Delete the page document and its protected envelope in the same transaction as the kind change, in `packages/database/src/repositories/content/conversion-repository.ts` (research decision 3)
- [ ] T026 [US2] Build the confirmation dialog in `apps/web/src/features/navigation/convert-item.tsx` — names the content and its attachments, states that recovery is limited to the retention window without quoting a number (FR-010, FR-011)
- [ ] T027 [US2] Send `confirmedDestruction` in the command rather than setting it later, so a replayed command cannot destroy content the owner never agreed to lose (research decision 5)
- [ ] T028 [P] [US2] Say there is nothing to lose when the page is empty, rather than warning about content that does not exist (US2 scenario 6)
- [ ] T029 [P] [US2] Make the dialog a real focus-trapping dialog announced to assistive technology, returning focus to its trigger on close (FR-018)
- [X] T030 [P] [US2] Integration test in `packages/database/tests/conversion.integration.spec.ts` — after a destructive conversion no page document and no protected envelope remain for that item
- [ ] T031 [US2] Playwright journey in `tests/e2e/item-conversion.spec.ts` — the warning names the loss, declining changes nothing, accepting keeps every child
- [ ] T032 [P] [US2] Playwright case in `tests/e2e/item-conversion.spec.ts` — restoring the revision from before the conversion brings the content back (FR-012, SC-005)
- [ ] T033 [P] [US2] Contract test in `apps/api/tests/conversion.contract.spec.ts` — the API refuses a destructive conversion without the flag, whatever the caller (FR-014, the point of the whole design)

**Checkpoint**: both directions work, and the destructive one cannot be performed silently by any caller.

---

## Phase 5: User Story 3 — See the two relations a page has (P2)

**Goal**: hierarchy children and content attachments are shown separately and never merged.

**Independent test**: a file under a page and a different file attached to its content each appear in their own place, and neither in both.

- [ ] T034 [US3] Show hierarchy children under a page exactly as under a folder, in `apps/web/src/features/navigation/tree.tsx` (FR-015)
- [ ] T035 [US3] Show content attachments in their own disclosure, offered for pages only, in `apps/web/src/features/navigation/tree.tsx` (FR-015, FR-016)
- [ ] T036 [P] [US3] Ensure a folder offers no attachments control at all, rather than an empty one (FR-016)
- [ ] T037 [US3] Playwright journey in `tests/e2e/item-conversion.spec.ts` — a filed file and an attached file appear in their own place and never in both
- [ ] T038 [P] [US3] Playwright case — a page converted to a folder loses its attachments disclosure along with its content

---

## Phase 6: User Story 4 — Put things exactly where you want them (P2)

**Goal**: conversion disturbs neither placement nor order.

- [ ] T039 [US4] Playwright journey in `tests/e2e/item-conversion.spec.ts` — four siblings in a deliberate order, one converted, order unchanged after a reload
- [ ] T040 [P] [US4] Playwright case — a converted item can still be moved to another parent and keeps its own children

---

## Phase 7: Polish & cross-cutting

- [ ] T041 Extend `tests/e2e/accessibility.spec.ts` with the conversion flow **including its confirmation**, which is easy to miss because it is not on screen at load (SC-008)
- [ ] T042 [P] Add the SC-009 benchmark — conversion within 2 seconds in a workspace of 1,000 items — to the performance suite
- [ ] T043 [P] Playwright case for the offline path: convert while offline, come back online, and confirm the outcome is the one the owner confirmed
- [ ] T044 [P] Create `specs/004-unified-items-conversion/validation.md` recording evidence per FR and SC
- [ ] T045 Run the full local gate — `pnpm checks:local` then `pnpm test:e2e` — before the pull request

---

## Dependencies

**Phase order**: Setup → Foundational → US1 → US2 → US3 → US4 → Polish.

**Hard blocks**:

- Phase 2 blocks everything: until the schema stops denormalising the kind, the conversion is not expressible.
- T003–T005 are one migration file and must land together; T006 must match them exactly or the ORM and the database disagree.
- T008–T010 block T017 and everything after.
- T025 blocks T030 and T032.
- T045 depends on everything.

**Soft ordering**: US3 touches only presentation and could move earlier if the two-disclosure confusion turns out to bite during US1.

---

## Parallel opportunities

- **Phase 2**: T011 and T012 are separate packages; T013–T016 are independent test files.
- **Phase 3**: T020 and T022 are independent; T024 is a separate case.
- **Phase 4**: T028, T029, T030, T032, T033 touch different files.
- **Phase 7**: T042, T043, T044 are fully independent.

---

## Implementation strategy

**MVP is Phases 1–3.** Folder → page is the whole non-destructive half, and it
removes the friction that made an owner hesitate at creation.

**Then US2**, which is where the care is: a confirmation that tells the truth
about what is destroyed and for how long it can be undone.

**Then US3 and US4**, both small, both about not making the existing model
harder to see than it is.

**Batching**: Phases 1–2 in one pull request, Phase 3 in one, Phase 4 in one,
Phases 5–7 in one. Each still passes the full local gate and a green CI before
merging.
