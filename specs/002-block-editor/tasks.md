# Tasks: Block Editor

**Input**: Design documents from `specs/002-block-editor/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/editor-document.schema.json`

**Tests**: Automated domain, contract, performance, accessibility, and Playwright coverage is required by the specification and constitution. Story tests are written before their implementation.

**Organization**: Tasks are grouped by independently testable user story.

## Phase 1: Setup

**Purpose**: Add the reviewed editor runtime while preserving the repository toolchain.

- [X] T001 Add Tiptap React, ProseMirror, StarterKit, list/task, Placeholder, and Suggestion dependencies with pnpm in `apps/web/package.json` and `pnpm-lock.yaml`
- [X] T002 [P] Add the editor feature module exports and test file routing in `apps/web/src/features/editor/index.ts` and `vitest.workspace.ts`

---

## Phase 2: Foundational Document Contract

**Purpose**: Establish safe version 2 content before any editable UI can consume it.

**⚠️ CRITICAL**: User story work starts only after malformed or future content cannot be silently changed.

- [X] T003 [P] Add version 2 valid, invalid, legacy-empty, and unknown-content domain tests in `packages/domain/tests/editor-document.spec.ts`
- [X] T004 Implement allow-listed editor document types, recursive validation, safe structural errors, empty document creation, and v1-empty normalization in `packages/domain/src/content/editor-document.ts`
- [X] T005 Export the editor contract and accept page-document version 2 while preserving explicit version 1 compatibility in `packages/domain/src/index.ts` and `packages/domain/src/content/hierarchy.ts`
- [X] T006 [P] Add version 2 API schema boundary fixtures and rejection tests in `apps/api/tests/page-documents.contract.spec.ts` and `tests/contract/openapi.spec.ts`
- [X] T007 Define the version 2 request schema without exposing arbitrary editor bodies as trusted content in `packages/contracts/src/content-api.ts`

**Checkpoint**: Canonical editor JSON is safe to load, save, synchronize, revise, and export.

---

## Phase 3: User Story 1 — Write and Format a Page (P1) 🎯 MVP

**Goal**: Replace raw JSON editing with accessible page authoring for all supported blocks and marks.

**Independent Test**: Create every supported block and mark on a page, undo/redo, reload, and recover identical structure while folders/files expose no editor.

### Tests for User Story 1

- [X] T008 [P] [US1] Add rich editing, toolbar, undo/redo, plain-text copy/paste, reload, and page-only Playwright journeys in `tests/e2e/block-editor.spec.ts`
- [X] T009 [P] [US1] Add version 2 export round-trip and private-content redaction contract tests in `tests/contract/editor-export.spec.ts` and `apps/api/tests/logging.spec.ts`

### Implementation for User Story 1

- [X] T010 [P] [US1] Implement the Tiptap extension set, canonical JSON loading, incompatibility state, and editor surface in `apps/web/src/features/editor/block-editor.tsx`
- [X] T011 [P] [US1] Implement keyboard-accessible block and mark controls with active state and undo/redo in `apps/web/src/features/editor/editor-toolbar.tsx`
- [X] T012 [US1] Replace the raw JSON form with the block editor only for active pages in `apps/web/src/features/pages/page-document-form.tsx` and `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`
- [X] T013 [US1] Add responsive editor, ProseMirror content, code, list, task, focus, placeholder, toolbar, and incompatibility styles in `apps/web/src/styles.css`

**Checkpoint**: The editor is a usable standalone MVP with durable canonical v2 content.

---

## Phase 4: User Story 4 — Keep Editing Through Connectivity Changes (P1)

**Goal**: Make rich edits locally durable, ordered, and honest through offline/reconnect/conflict transitions.

**Independent Test**: Edit offline, reload, reconnect, and confirm the latest document synchronizes once while a competing revision preserves the local version.

### Tests for User Story 4

- [X] T014 [P] [US4] Add debounce, one-in-flight, latest-value coalescing, failure, and disposal unit tests in `apps/web/src/features/editor/save-coordinator.spec.ts`
- [X] T015 [P] [US4] Add rich-document local transaction and outbox restart tests in `packages/client-core/tests/editor-local-mutation.spec.ts`
- [X] T016 [P] [US4] Add edit-offline, reload, reconnect, and conflict Playwright journeys in `tests/e2e/block-editor-offline.spec.ts`

### Implementation for User Story 4

- [X] T017 [US4] Implement a disposable debounced, serialized, latest-value save coordinator in `apps/web/src/features/editor/save-coordinator.ts`
- [X] T018 [US4] Connect editor updates to atomic local document mutations and current causal heads in `apps/web/src/features/editor/block-editor.tsx` and `apps/web/src/services/local-content.ts`
- [X] T019 [US4] Expose editing, saving-local, saved-local, pending, synchronizing, synchronized, error, and conflict feedback in `apps/web/src/features/editor/editor-save-status.tsx` and `apps/web/src/components/sync-status.tsx`

**Checkpoint**: Rich editing is offline-first and never claims durability it has not reached.

---

## Phase 5: User Story 2 — Insert Blocks with Commands (P2)

**Goal**: Insert every supported block through a local, discoverable, keyboard-operated slash menu.

**Independent Test**: Type `/`, filter, navigate, insert each command, dismiss with Escape/outside interaction, and observe an explicit empty-result state.

### Tests for User Story 2

- [X] T020 [P] [US2] Add command catalogue filtering and execution unit tests in `apps/web/src/features/editor/slash-command.spec.ts`
- [X] T021 [P] [US2] Add slash open, filter, keyboard selection, dismissal, empty-result, and mobile journeys in `tests/e2e/slash-command.spec.ts`

### Implementation for User Story 2

- [X] T022 [US2] Implement the local command catalogue and Tiptap Suggestion extension with start-of-line activation in `apps/web/src/features/editor/slash-command.ts`
- [X] T023 [US2] Implement the accessible managed-position command list and keyboard contract in `apps/web/src/features/editor/slash-command-menu.tsx`
- [X] T024 [US2] Integrate slash commands into the editor extension set and responsive styles in `apps/web/src/features/editor/block-editor.tsx` and `apps/web/src/styles.css`

**Checkpoint**: Every supported block is discoverable and insertable without a pointer.

---

## Phase 6: User Story 3 — Use Familiar Markdown Shortcuts (P3)

**Goal**: Support documented start-of-block shortcuts without transforming ordinary mid-block text.

**Independent Test**: Exercise every positive shortcut and negative fixture, then undo each transformation back to literal input.

### Tests for User Story 3

- [X] T025 [P] [US3] Add positive, negative, and undo shortcut fixtures in `apps/web/src/features/editor/markdown-shortcuts.spec.ts`
- [X] T026 [P] [US3] Add keyboard-only Markdown shortcut journeys in `tests/e2e/markdown-shortcuts.spec.ts`

### Implementation for User Story 3

- [X] T027 [US3] Configure heading, list, quote, code, divider, and task input rules with documented activation contexts in `apps/web/src/features/editor/editor-extensions.ts`
- [X] T028 [US3] Publish the supported shortcut reference beside editor help without modifying canonical content in `apps/web/src/features/editor/editor-help.tsx`

**Checkpoint**: Fast keyboard input complements the toolbar and slash menu safely.

---

## Phase 7: Polish and Cross-Cutting Quality

**Purpose**: Prove performance, accessibility, compatibility, deployment, and documentation across all stories.

- [X] T029 [P] Add a 2,000-block keystroke/render/save performance project in `tests/performance/block-editor.perf.spec.ts`
- [X] T030 [P] Extend keyboard, focus, semantic, critical-violation, and responsive overflow coverage in `tests/e2e/accessibility.spec.ts`
- [X] T031 [P] Document the editor content format, shortcuts, offline states, incompatibility recovery, and local workflow in `docs/editor.md` and `docs/development.md`
- [X] T032 Update container smoke coverage to create, persist, and retrieve a version 2 document in `scripts/ci/test-containers.ts`
- [X] T033 Run and record the complete `specs/002-block-editor/quickstart.md`, all quality gates, coverage, Playwright matrix, build, and container smoke evidence in `specs/002-block-editor/validation.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup** has no dependency.
- **Foundational contract** depends on Setup and blocks every story.
- **US1** and **US4** are both P1; US4 integrates with the US1 editor surface and follows its MVP implementation.
- **US2** and **US3** depend on the US1 editor surface but remain independently testable command-input increments.
- **Polish** follows all selected stories.

### User Story Dependencies

- **US1**: starts after Phase 2 and establishes the editor MVP.
- **US4**: uses US1 content updates but independently proves offline durability.
- **US2**: uses US1 editor commands but independently proves discoverability and insertion.
- **US3**: uses US1 extensions but independently proves input-rule behavior.

### Parallel Opportunities

- T002 and dependency installation review can proceed separately.
- T003 and T006 test separate domain/API boundaries.
- Within each story, Playwright/contract fixtures can be authored before implementation in separate files.
- US2 and US3 can proceed in parallel after US1 stabilizes.
- T029–T031 cover separate performance, accessibility, and documentation surfaces.

---

## Implementation Strategy

### First usable increment

1. Complete Setup and the foundational v2 contract.
2. Complete US1 to replace the raw JSON textarea with the rich editor.
3. Validate US1 independently before layering automatic saving and command discovery.

### Incremental delivery

1. **MVP**: supported blocks/marks, toolbar, history, reload, and safe versioned content.
2. **Offline guarantee**: serialized local-first saves, reconnect, and conflict preservation.
3. **Discovery**: slash commands.
4. **Speed**: Markdown shortcuts.
5. **Release confidence**: accessibility, performance, documentation, container smoke, and full CI.

## Format Validation

All tasks use the required checkbox, sequential ID, optional parallel marker, required story label inside story phases, imperative description, and exact file paths.

## Phase 8: Convergence

- [X] T034 [US1] Expand the save/reload Playwright journey to preserve every supported block, mark, order, and checklist state per SC-001 and FR-002/FR-003/FR-005 (partial)
- [X] T035 [US1] Add one pointer-free Playwright journey that creates the complete formatted page with keyboard controls per SC-002 and FR-020 (partial)
- [X] T036 [US2] Execute every slash catalogue entry through the browser command menu and assert its resulting block per SC-003 and US2 independent test (partial)
- [X] T037 [P] Measure a real Tiptap 2,000-block keystroke-to-visible-DOM update at p95 below 100 ms per SC-006 (partial)
- [X] T038 [P] Expand the canonical export round-trip fixture to every supported block and mark with version metadata per SC-008 and FR-023 (partial)
- [X] T039 [P] Assert the active block remains inside desktop and mobile viewports during keyboard editing per SC-009 (partial)
