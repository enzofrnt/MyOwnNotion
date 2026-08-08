# Tasks: Freeform Canvas

**Input**: Design documents from `specs/006-freeform-canvas/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, contracts, and `quickstart.md`

**Tests**: Domain, contract, local-storage, fault-injection, performance, accessibility, responsive Playwright, export/revision, and production-container coverage are mandatory. Story tests precede implementation.

## Phase 1: Setup

- [x] T001 Create deterministic canvas/card/connection/stroke/page-target fixtures and a scale generator in `tests/fixtures/canvas.ts`
- [x] T002 [P] Export canvas fixtures from `tests/fixtures/workspace.ts`
- [x] T003 [P] Add focused canvas validation and screenshot commands in `docs/development.md`

---

## Phase 2: Foundational Document and Geometry Contracts

**Purpose**: Establish one strict version-6 representation, pure geometry, and canonical page-card occurrences before UI stories.

- [x] T004 Add failing identity, exact-union, coordinate, dimension, viewport, edge, stroke, limit, legacy v1-v5, and future-version cases in `packages/domain/tests/canvas.spec.ts` and `packages/domain/tests/editor-document.spec.ts`
- [x] T005 Implement canvas types, exact validation, cleanup invariants, limits, defaults, and version-6 document support in `packages/domain/src/content/canvas.ts` and `packages/domain/src/content/editor-document.ts`
- [x] T006 Export canvas types and helpers from `packages/domain/src/index.ts`
- [x] T007 Add failing center/endpoints, screen/world conversion, page-label resolution, order, and immutability cases in `packages/domain/tests/canvas.spec.ts`
- [x] T008 Implement pure connection geometry, coordinate conversion, page resolution, and projection helpers in `packages/domain/src/content/canvas.ts`
- [x] T009 Add failing version-6 runtime/OpenAPI, relationship, export, and restore contract cases in `packages/contracts/src/content-api.ts`, `tests/contract/openapi.spec.ts`, and `tests/contract/editor-export.spec.ts`
- [x] T010 Extend runtime and canonical OpenAPI schemas for version-6 canvas blocks in `packages/contracts/src/content-api.ts` and `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [x] T011 Add version-6 create, replace, malformed rejection, page-card relationship, and exact restore cases in `apps/api/tests/page-documents.contract.spec.ts`

**Checkpoint**: Strict canvas documents, page references, and deterministic geometry pass at every boundary.

---

## Phase 3: User Story 1 — Arrange Ideas Spatially (Priority: P1) 🎯 MVP

### Tests for User Story 1

- [x] T012 [P] [US1] Add failing add/edit/move/resize/remove/viewport/duplicate-rejection cases in `apps/web/src/features/canvas/canvas-block.spec.ts`
- [x] T013 [P] [US1] Add toolbar/slash insertion, text edit, drag, keyboard nudge, resize, pan/zoom/reset, reload, focus, responsive, screenshot, and critical-Axe journeys in `tests/e2e/canvas-cards.spec.ts`

### Implementation for User Story 1

- [x] T014 [US1] Implement immutable canvas/card/viewport commands that preserve stable identities and reject duplicate identifiers in `apps/web/src/features/canvas/canvas-block.ts`
- [x] T015 [US1] Implement the Tiptap canvas atom extension and version-6 save validation in `apps/web/src/features/canvas/canvas-extension.ts` and `apps/web/src/features/editor/editor-extensions.ts`
- [x] T016 [US1] Add canvas insertion through the editor toolbar and slash command in `apps/web/src/features/editor/editor-toolbar.tsx` and `apps/web/src/features/editor/slash-command.ts`
- [x] T017 [US1] Implement labelled canvas controls, selection, card editor, pointer drag, keyboard nudge, resize, and viewport controls in `apps/web/src/features/canvas/canvas-node-view.tsx` and `apps/web/src/features/canvas/canvas-surface.tsx`
- [x] T018 [US1] Add clipped spatial surface, grid/origin, card, selection, focus, and narrow-viewport styles in `apps/web/src/styles.css`

**Checkpoint**: Text cards can be arranged and navigated spatially with equivalent keyboard and pointer paths.

---

## Phase 4: User Story 2 — Connect and Sketch Ideas (Priority: P1)

### Tests for User Story 2

- [x] T019 [P] [US2] Add failing connection add/label/remove, endpoint-following, card cleanup, stroke commit/remove, abandoned gesture, and stable-identity cases in `apps/web/src/features/canvas/canvas-block.spec.ts` and `packages/domain/tests/canvas.spec.ts`
- [x] T020 [P] [US2] Add connection, semantic list, endpoint movement, drawing widths, stroke removal, card cleanup, screenshot, responsive, and critical-Axe journeys in `tests/e2e/canvas-connections-drawing.spec.ts`

### Implementation for User Story 2

- [x] T021 [US2] Implement immutable connection/stroke commands in `apps/web/src/features/canvas/canvas-block.ts`
- [x] T022 [US2] Render deterministic SVG arrows/strokes plus semantic connection/stroke lists in `apps/web/src/features/canvas/canvas-surface.tsx` and `apps/web/src/features/canvas/canvas-node-view.tsx`
- [x] T023 [US2] Implement pointer-captured transient draw mode with atomic complete-stroke commit in `apps/web/src/features/canvas/canvas-surface.tsx`
- [x] T024 [US2] Add non-color arrow, label, stroke-width, draw-mode, and semantic-list styles in `apps/web/src/styles.css`

**Checkpoint**: Connections and complete freehand strokes remain stable as cards move and are accessible beyond their visual geometry.

---

## Phase 5: User Story 3 — Include Workspace Pages (Priority: P1)

### Tests for User Story 3

- [x] T025 [P] [US3] Add page-card occurrence, target resolution, rename/move, self/missing target, duplicate occurrence, and unavailable-label cases in `packages/domain/tests/editor-document.spec.ts`, `packages/domain/tests/canvas.spec.ts`, and `apps/web/src/features/canvas/canvas-block.spec.ts`
- [x] T026 [P] [US3] Add page-card picker, mixed connection, current-name, unavailable state, open action, reload, backlink, graph, and screenshots in `tests/e2e/canvas-pages.spec.ts`

### Implementation for User Story 3

- [x] T027 [US3] Project page cards through existing `link:references` occurrence validation and relationship reconciliation in `packages/domain/src/content/editor-document.ts`
- [x] T028 [US3] Configure canvas page candidates/navigation from the editor and implement add/open/unavailable page-card controls in `apps/web/src/features/canvas/canvas-extension.ts`, `apps/web/src/features/canvas/canvas-node-view.tsx`, and `apps/web/src/features/editor/editor-extensions.ts`
- [x] T029 [US3] Add page-card, current-label, unavailable, and open-action styles in `apps/web/src/styles.css`

**Checkpoint**: Canvas page references use stable workspace identity and participate in existing backlinks and graph projection.

---

## Phase 6: User Story 4 — Work Offline and Recover Complete Canvases (Priority: P1)

### Tests for User Story 4

- [x] T030 [P] [US4] Add version-6 atomic local rollback, relationship projection, accepted-head, catch-up, snapshot, and conflict-retention cases in `packages/client-core/tests/editor-local-mutation.spec.ts`, `packages/client-core/tests/local-mutation.atomicity.spec.ts`, and `packages/client-core/tests/reconciliation.spec.ts`
- [x] T031 [P] [US4] Add offline card/geometry/edge/stroke/page/viewport edit, reload, reconnect-once, removal, and competing-revision journeys in `tests/e2e/canvas-offline.spec.ts`

### Implementation for User Story 4

- [x] T032 [US4] Preserve complete version-6 documents and page-card relationships through existing optimistic projection, outbox, reconciliation, snapshot, and conflict paths in `packages/client-core/src/`

**Checkpoint**: Complete canvases remain local, synchronize once, and survive conflicts without dangling or partial geometry.

---

## Phase 7: Polish and Cross-Cutting Quality

- [x] T033 [P] Add exhaustive version-6 canonical export and retained-revision round trips in `tests/contract/export.spec.ts`, `tests/contract/editor-export.spec.ts`, and `tests/e2e/revision-restore.spec.ts`
- [x] T034 [P] Add card text, connection label, geometry, stroke point, viewport, page label, and identifier log-redaction cases in `apps/api/tests/logging.spec.ts`
- [x] T035 [P] Add a one-second 500-card/1,000-connection/200-stroke validation and projection assertion in `tests/performance/canvas.perf.spec.ts`
- [x] T036 Attach deterministic desktop/mobile empty, connected, page-card, and drawing screenshots in the canvas Playwright journeys
- [x] T037 Extend production Compose smoke with version-6 canvas card/geometry/edge/stroke/page-target/viewport persistence across restart in `scripts/ci/test-containers.ts`
- [x] T038 Update canvas editing, navigation, accessibility, offline/export, production evaluation, and troubleshooting guidance in `docs/editor.md`, `docs/development.md`, and `docs/deployment.md`
- [x] T039 Verify GitHub Playwright artifacts retain canvas screenshots and traces in `.github/workflows/ci.yml`
- [ ] T040 Run `specs/006-freeform-canvas/quickstart.md`, formatting, static analysis, exact types, coverage, contract/performance suites, browser matrix, production build, and isolated container smoke; record evidence in `specs/006-freeform-canvas/validation.md`

## Dependencies and Implementation Strategy

Setup → Foundation → spatial cards → connections/drawing → page inclusion → offline recovery → polish. Inside each story, observe focused failures before implementation, update one complete atom per accepted action, validate one independent browser journey, and mark this checklist only after evidence passes.

All 40 tasks use the required checkbox, sequential identifier, optional parallel marker, required story label inside story phases, imperative action, and concrete file paths.
