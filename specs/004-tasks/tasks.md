# Tasks: Tasks and Planning Views

**Input**: Design documents from `specs/004-tasks/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/task-projection.md`, `contracts/task-document.schema.json`, `quickstart.md`

**Tests**: Domain, contract, local-storage, database integration, fault-injection, performance, accessibility, responsive Playwright, and production-container coverage are required by the specification and constitution. Story tests precede their implementation.

## Phase 1: Setup

**Purpose**: Establish deterministic task fixtures and focused validation guidance without changing product behavior.

- [X] T001 Create reusable version-4 task documents, page sets, calendar boundaries, and expected view fixtures in `tests/fixtures/tasks.ts`
- [X] T002 [P] Export task fixtures from `tests/fixtures/workspace.ts`
- [X] T003 [P] Add focused task-feature test commands and screenshot expectations in `docs/development.md`

---

## Phase 2: Foundational Document and Projection Contracts

**Purpose**: Make version-4 task metadata safe and provide one deterministic task projection for every user story.

**⚠️ CRITICAL**: No user story begins until compatibility, validation, extraction, contracts, and planning functions pass.

- [X] T004 Add failing version-4 task-attribute, real-date, status/checkbox, duplicate-ID, legacy v1-v3, wiki-mark coexistence, and unsupported-version cases in `packages/domain/tests/editor-document.spec.ts`
- [X] T005 Implement version-4 task types, validation, extraction, uniqueness, compatibility, and write helpers in `packages/domain/src/content/editor-document.ts`
- [X] T006 Export task document types and helpers from `packages/domain/src/index.ts`
- [X] T007 Add failing task projection, calendar-scope, lifecycle, filtering, deterministic sorting, and list/board parity cases in `packages/domain/tests/task-planning.spec.ts`
- [X] T008 Implement pure extraction, classification, filtering, sorting, and grouping in `packages/domain/src/content/task-planning.ts`
- [X] T009 Add failing runtime and OpenAPI contract cases for version-4 task attributes in `tests/contract/openapi.spec.ts` and `tests/contract/editor-export.spec.ts`
- [X] T010 Extend editor document runtime schemas in `packages/contracts/src/content-api.ts` and the canonical OpenAPI source in `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [X] T011 Add version-4 server create/replace/reject/restore contract cases in `apps/api/tests/page-documents.contract.spec.ts`

**Checkpoint**: Version 4 is non-destructive, strict task metadata is executable at every boundary, and planning derivation is deterministic.

---

## Phase 3: User Story 1 — Capture Tasks While Writing (Priority: P1) 🎯 MVP

**Goal**: Insert, edit, complete, reopen, save, reload, and focus stable task items inside pages.

**Independent Test**: Create one task through every insertion path, edit its text, toggle with keyboard/pointer, reload, restore, rename/move the page, and verify stable task identity.

### Tests for User Story 1

- [X] T012 [P] [US1] Add failing missing-ID upgrade, default metadata, checkbox transition, duplicate repair, and stable-render-attribute cases in `apps/web/src/features/editor/task-item.spec.ts`
- [X] T013 [P] [US1] Add task capture, title edit, keyboard/pointer toggle, reload, page rename/move, and focused-source journeys in `tests/e2e/tasks-capture.spec.ts`
- [X] T014 [P] [US1] Extend block-editor contract and export round-trip fixtures with stable version-4 task identities in `tests/contract/editor-export.spec.ts` and `tests/contract/export.spec.ts`

### Implementation for User Story 1

- [X] T015 [US1] Implement the extended task-item node, missing-metadata assignment, checkbox/status reconciliation, and stable render attributes in `apps/web/src/features/editor/task-item.ts`
- [X] T016 [US1] Configure the extended task item and version-4 save validation in `apps/web/src/features/editor/editor-extensions.ts` and `apps/web/src/features/editor/block-editor.tsx`
- [X] T017 [US1] Add task-target reveal and focus support through `apps/web/src/features/pages/page-document-form.tsx` and `apps/web/src/features/editor/block-editor.tsx`

**Checkpoint**: Stable tasks can be captured and completed independently of the planning workspace.

---

## Phase 4: User Story 2 — Plan with Status, Due Date, and Priority (Priority: P1)

**Goal**: Edit consistent status, calendar due date, and priority from the selected task without leaving normal page editing.

**Independent Test**: Set every status and priority, assign/clear boundary dates, verify checkbox consistency, reload, restore, and reject malformed metadata safely.

### Tests for User Story 2

- [X] T018 [P] [US2] Add failing state-transition, date-edit, clear, and metadata-command cases in `apps/web/src/features/editor/task-item.spec.ts`
- [X] T019 [P] [US2] Add keyboard/pointer task-detail, completion/reopen/cancel, date, priority, reload, responsive, and critical-Axe journeys in `tests/e2e/tasks-metadata.spec.ts`
- [X] T020 [P] [US2] Add version-4 private-title and malformed-metadata logging-redaction cases in `apps/api/tests/logging.spec.ts`

### Implementation for User Story 2

- [X] T021 [US2] Implement selected-task discovery and atomic metadata commands in `apps/web/src/features/editor/task-item.ts`
- [X] T022 [US2] Implement labelled task status, date, and priority controls in `apps/web/src/features/editor/task-details.tsx`
- [X] T023 [US2] Compose task details into the editor and add non-color status semantics in `apps/web/src/features/editor/block-editor.tsx` and `apps/web/src/styles.css`

**Checkpoint**: Task metadata is editable, predictable, accessible, versioned, and internally consistent.

---

## Phase 5: User Story 3 — Review Tasks Across Pages (Priority: P1)

**Goal**: Review the same exact task set through calendar scopes, filters, deterministic sorts, list view, and status board, then navigate to the source task.

**Independent Test**: Create a multi-page boundary-date fixture, exercise every scope/filter/sort, compare list and board IDs/counts, and open a source task from both views.

### Tests for User Story 3

- [X] T024 [US3] Extend domain fixtures for 5,000-task extraction, view parity, duplicate titles, empty titles, nesting, long labels, and lifecycle boundaries in `packages/domain/tests/task-planning.spec.ts`
- [X] T025 [P] [US3] Add a one-second 5,000-task extraction/filter/sort/view-switch assertion in `tests/performance/tasks.perf.spec.ts`
- [X] T026 [P] [US3] Add All/Today/Upcoming/Overdue/Finished, count, combined-filter, sort, empty, list/board parity, navigation, lifecycle, mobile-overflow, and critical-Axe journeys in `tests/e2e/tasks-views.spec.ts`

### Implementation for User Story 3

- [X] T027 [US3] Expose current task projections from the durable local item projection in `apps/web/src/services/local-content.ts`
- [X] T028 [P] [US3] Implement the semantic filtered task list and source actions in `apps/web/src/features/tasks/task-list.tsx`
- [X] T029 [P] [US3] Implement the fixed-status semantic board from the same filtered task IDs in `apps/web/src/features/tasks/task-board.tsx`
- [X] T030 [US3] Implement task scopes, counts, filters, sort, view switching, empty states, and legacy-upgrade guidance in `apps/web/src/features/tasks/task-workspace.tsx`
- [X] T031 [US3] Integrate the task workspace, source selection, and task focus handoff in `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`
- [X] T032 [US3] Add responsive list/board, long-label, filter, focus, status, priority, and empty-state styles in `apps/web/src/styles.css`

**Checkpoint**: Cross-page task planning is complete, exact, navigable, accessible, responsive, and within the reference performance bound.

---

## Phase 6: User Story 4 — Manage Tasks Offline and Recover Conflicts (Priority: P1)

**Goal**: Preserve task documents and planning views through offline reload, catch-up, conflict, and snapshot replacement.

**Independent Test**: Create/update tasks offline, reload, inspect views, reconnect exactly once, then prove a competing revision preserves the complete local task document.

### Tests for User Story 4

- [X] T033 [US4] Add version-4 atomic local document/outbox, failed-write rollback, and recoverable-task cases in `packages/client-core/tests/editor-local-mutation.spec.ts` and `packages/client-core/tests/local-mutation.atomicity.spec.ts`
- [X] T034 [P] [US4] Add version-4 incremental catch-up, verified snapshot replacement, acknowledged-head, and conflict-preservation cases in `packages/client-core/tests/reconciliation.spec.ts`
- [X] T035 [P] [US4] Add offline capture/update/reload/view/reconnect-once/removal and competing-revision journeys in `tests/e2e/tasks-offline.spec.ts`

### Implementation for User Story 4

- [X] T036 [US4] Preserve version-4 documents through optimistic projection, accepted-head mapping, conflicts, and snapshot replacement in `packages/client-core/src/outbox/apply-to-projection.ts`, `packages/client-core/src/outbox/outbox.ts`, and `packages/client-core/src/local-store/local-repository.ts`
- [X] T037 [US4] Keep task views refreshed from local mutations, reconciliation, and offline state transitions in `apps/web/src/services/local-content.ts` and `apps/web/src/features/tasks/task-workspace.tsx`

**Checkpoint**: Offline task edits survive reload, synchronize once, and remain recoverable on conflict without a separate task cache.

---

## Phase 7: Polish and Cross-Cutting Quality

**Purpose**: Close export, revision, accessibility, responsive, evidence, production, and documentation obligations.

- [X] T038 [P] Add exhaustive version-4 task export and revision round trips in `tests/contract/editor-export.spec.ts`, `tests/contract/export.spec.ts`, and `tests/e2e/revision-restore.spec.ts`
- [X] T039 Attach deterministic desktop/mobile screenshots for capture, metadata, list, and board journeys in `tests/e2e/tasks-capture.spec.ts`, `tests/e2e/tasks-metadata.spec.ts`, and `tests/e2e/tasks-views.spec.ts`
- [X] T040 Extend the production Compose smoke with version-4 task metadata persistence across restart in `scripts/ci/test-containers.ts`
- [X] T041 Update task editing, task-view, export, offline, production-like evaluation, and troubleshooting guidance in `docs/editor.md`, `docs/development.md`, and `docs/deployment.md`
- [X] T042 Verify GitHub Playwright artifacts retain new task screenshots and traces in `.github/workflows/ci.yml`
- [X] T043 Run `specs/004-tasks/quickstart.md`, formatting, lint/static analysis, exact types, coverage, database/contract/performance suites, browser matrix, production build, and isolated container smoke; record evidence in `specs/004-tasks/validation.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundation (Phase 2)**: Depends on setup and blocks every story.
- **US1 (Phase 3)**: Depends on the version-4 contract and establishes stable task capture.
- **US2 (Phase 4)**: Depends on US1 identity/extension work and adds planning metadata.
- **US3 (Phase 5)**: Depends on domain projection plus US1/US2 content and is independently useful without offline mutation.
- **US4 (Phase 6)**: Depends on all prior stories to exercise the complete local planning path.
- **Polish (Phase 7)**: Depends on all selected stories.

### User Story Dependency Graph

```text
Setup → Foundation → US1 → US2 → US3
                         └────────→ US4
US1 + US2 + US3 + US4 → Polish
```

### Within Each User Story

- Write and observe failing focused tests before implementation.
- Keep document validation and task planning pure and shared across boundaries.
- Complete the independent Playwright journey before declaring the story done.
- Mark a task complete only after its focused checks pass.

### Parallel Opportunities

- T002 and T003 follow T001 in separate files.
- Domain projection tests (T007), runtime contracts (T009), and API contracts (T011) are independent after document fixtures exist.
- US1 unit (T012), E2E (T013), and export (T014) tests are independent after foundation.
- US2 editor commands (T018), browser journey (T019), and logging tests (T020) touch separate surfaces.
- US3 performance (T025), E2E (T026), list (T028), and board (T029) can proceed independently against the projection contract.
- US4 client fault tests (T033), reconciliation tests (T034), and browser journeys (T035) are independent once all visible stories exist.

## Implementation Strategy

### MVP First

1. Complete version-4 validation and pure task extraction.
2. Complete US1 so stable tasks can be captured and toggled in pages.
3. Validate the independent capture journey before adding metadata and workspace views.

### Incremental Delivery

1. Add explicit status, date, and priority as a complete editor increment.
2. Add exact list scopes and filters over the local projection.
3. Add the board as an equivalent presentation of the same IDs.
4. Exercise the complete task system through offline and conflict paths.
5. Close export, evidence, responsive, documentation, build, and production-container gates.

## Format Validation

All 43 tasks use the required checkbox, sequential ID, optional parallel marker, required story label inside story phases, imperative description, and concrete file paths.
