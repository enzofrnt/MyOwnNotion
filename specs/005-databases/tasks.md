# Tasks: Structured Databases

**Input**: Design documents from `specs/005-databases/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, contracts, and `quickstart.md`

**Tests**: Domain, contract, local-storage, fault-injection, performance, accessibility, responsive Playwright, export/revision, and production-container coverage are mandatory. Story tests precede implementation.

## Phase 1: Setup

- [x] T001 Create deterministic database/property/record/relation/view fixtures and a 1,000-record generator in `tests/fixtures/databases.ts`
- [x] T002 [P] Export database fixtures from `tests/fixtures/workspace.ts`
- [x] T003 [P] Add focused database validation and screenshot commands in `docs/development.md`

---

## Phase 2: Foundational Document and Projection Contracts

**Purpose**: Establish one strict version-5 database representation and pure view derivation before UI stories.

- [x] T004 Add failing version-5 database identity, property union, option, typed value, date, relation, uniqueness, limit, legacy v1-v4, and future-version cases in `packages/domain/tests/editor-document.spec.ts` and `packages/domain/tests/database.spec.ts`
- [x] T005 Implement database types, exact validation, cross-reference rules, limits, defaults, and version-5 document support in `packages/domain/src/content/database.ts` and `packages/domain/src/content/editor-document.ts`
- [x] T006 Export database types and helpers from `packages/domain/src/index.ts`
- [x] T007 Add failing search, readable value, type-aware sort, empty-value, tie-break, board grouping, gallery parity, and missing-relation cases in `packages/domain/tests/database.spec.ts`
- [x] T008 Implement pure readable-value, filter, sort, group, gallery, and diagnostics functions in `packages/domain/src/content/database.ts`
- [x] T009 Add failing runtime/OpenAPI and version-5 export contract cases in `packages/contracts/src/content-api.ts`, `tests/contract/openapi.spec.ts`, and `tests/contract/editor-export.spec.ts`
- [x] T010 Extend runtime and canonical OpenAPI document schemas for version-5 database blocks in `packages/contracts/src/content-api.ts` and `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [x] T011 Add version-5 create, replace, reject, and exact restore cases in `apps/api/tests/page-documents.contract.spec.ts`

**Checkpoint**: Strict database documents and deterministic equivalent view projections pass at every boundary.

---

## Phase 3: User Story 1 — Structure Records Inside a Page (Priority: P1) 🎯 MVP

### Tests for User Story 1

- [x] T012 [P] [US1] Add failing default block, property/option/record/value edit, property cleanup, duplicate repair, and stable-attribute cases in `apps/web/src/features/databases/database-block.spec.ts`
- [x] T013 [P] [US1] Add insert, property, record, typed value, remove-property, reload, rename/move, focus, responsive, and critical-Axe journeys in `tests/e2e/databases-edit.spec.ts`

### Implementation for User Story 1

- [x] T014 [US1] Implement immutable database block editing commands and stable identity repair in `apps/web/src/features/databases/database-block.ts`
- [x] T015 [US1] Implement the Tiptap database atom extension and version-5 save validation in `apps/web/src/features/databases/database-extension.ts` and `apps/web/src/features/editor/editor-extensions.ts`
- [x] T016 [US1] Add database insertion through the toolbar and slash command in `apps/web/src/features/editor/editor-toolbar.tsx` and `apps/web/src/features/editor/slash-command.ts`
- [x] T017 [US1] Implement labelled schema, property, record, and typed-value controls in `apps/web/src/features/databases/database-node-view.tsx`

**Checkpoint**: A page can own, edit, save, reload, rename, move, export, and restore stable structured records.

---

## Phase 4: User Story 2 — Find Records in a Table (Priority: P1)

### Tests for User Story 2

- [x] T018 [P] [US2] Add table search, value search, every type-aware sort, direction, update, exact count, empty, long-value, and overflow journeys in `tests/e2e/databases-table.spec.ts`
- [x] T019 [P] [US2] Add a one-second 1,000-record/20-property validation, filter, and sort assertion in `tests/performance/databases.perf.spec.ts`

### Implementation for User Story 2

- [x] T020 [US2] Implement persisted query, sort key, direction, result count, and empty-state controls in `apps/web/src/features/databases/database-node-view.tsx`
- [x] T021 [US2] Implement the semantic editable table over the shared projection in `apps/web/src/features/databases/database-table.tsx`
- [x] T022 [US2] Add contained table overflow, readable cells, focus, and narrow-viewport styles in `apps/web/src/styles.css`

**Checkpoint**: Table review is deterministic, searchable, editable, accessible, and responsive.

---

## Phase 5: User Story 3 — Review Board and Gallery (Priority: P2)

### Tests for User Story 3

- [x] T023 [P] [US3] Add table/board/gallery identity parity, option/unassigned grouping, no-select fallback, card summary, focus, mobile, screenshot, and critical-Axe journeys in `tests/e2e/databases-views.spec.ts`

### Implementation for User Story 3

- [x] T024 [P] [US3] Implement the semantic select-grouped board over the shared projection in `apps/web/src/features/databases/database-board.tsx`
- [x] T025 [P] [US3] Implement bounded semantic gallery cards over the same record order in `apps/web/src/features/databases/database-gallery.tsx`
- [x] T026 [US3] Compose view switching, grouping guidance, view parity, and record focus in `apps/web/src/features/databases/database-node-view.tsx`
- [x] T027 [US3] Add responsive board/gallery/card/group styles and non-color semantics in `apps/web/src/styles.css`

**Checkpoint**: Table, board, and gallery expose the exact same current records and keyboard focus destination.

---

## Phase 6: User Story 4 — Relate Records and Work Offline (Priority: P1)

### Tests for User Story 4

- [x] T028 [P] [US4] Add relation identity, rename resolution, missing-target diagnostics, self-selection, and malformed-relation cases in `packages/domain/tests/database.spec.ts` and `apps/web/src/features/databases/database-block.spec.ts`
- [x] T029 [P] [US4] Add version-5 atomic local write rollback, projection, accepted-head, catch-up, snapshot, and conflict-retention cases in `packages/client-core/tests/editor-local-mutation.spec.ts`, `packages/client-core/tests/local-mutation.atomicity.spec.ts`, and `packages/client-core/tests/reconciliation.spec.ts`
- [x] T030 [P] [US4] Add offline schema/record/relation/view edit, reload, reconnect-once, removal, and competing-revision journeys in `tests/e2e/databases-offline.spec.ts`

### Implementation for User Story 4

- [x] T031 [US4] Implement same-database relation selection, title resolution, and unavailable-target semantics in `apps/web/src/features/databases/database-node-view.tsx` and `packages/domain/src/content/database.ts`
- [x] T032 [US4] Preserve complete version-5 documents through existing optimistic projection, outbox, reconciliation, snapshot, and conflict paths in `packages/client-core/src/`

**Checkpoint**: Related database records remain completely local, synchronize once, and survive conflicts without partial schema state.

---

## Phase 7: Polish and Cross-Cutting Quality

- [x] T033 [P] Add exhaustive version-5 canonical export and retained-revision round trips in `tests/contract/export.spec.ts`, `tests/contract/editor-export.spec.ts`, and `tests/e2e/revision-restore.spec.ts`
- [x] T034 [P] Add database title/property/value/filter log-redaction cases in `apps/api/tests/logging.spec.ts`
- [x] T035 Attach deterministic desktop/mobile property, table, board, and gallery screenshots in the database Playwright journeys
- [x] T036 Extend production Compose smoke with version-5 database schema/record/relation/view persistence across restart in `scripts/ci/test-containers.ts`
- [x] T037 Update database editing, views, offline/export, production evaluation, and troubleshooting guidance in `docs/editor.md`, `docs/development.md`, and `docs/deployment.md`
- [x] T038 Verify GitHub Playwright artifacts retain database screenshots and traces in `.github/workflows/ci.yml`
- [x] T039 Run `specs/005-databases/quickstart.md`, formatting, lint/static analysis, exact types, coverage, contract/performance suites, browser matrix, production build, and isolated container smoke; record evidence in `specs/005-databases/validation.md`

## Dependencies and Implementation Strategy

Setup → Foundation → US1 → US2 → US3, while US4 follows US1 and the shared projection. Polish follows every selected story. Inside each story, observe failing focused tests before implementation, keep the complete database in one page mutation, validate an independent browser journey, and update this checklist only after focused checks pass.

All 39 tasks use the required checkbox, sequential identifier, optional parallel marker, required story label inside story phases, imperative action, and concrete file paths.
