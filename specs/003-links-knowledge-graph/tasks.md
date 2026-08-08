# Tasks: Links and Knowledge Graph

**Input**: Design documents from `specs/003-links-knowledge-graph/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/knowledge-projection.md`, `contracts/wiki-link-document.schema.json`, `quickstart.md`

**Tests**: Domain, contract, local-storage, database integration, fault-injection, performance, accessibility, responsive Playwright, and production-container coverage are required by the specification and constitution. Story tests precede their implementation.

## Phase 1: Setup

**Purpose**: Establish shared fixtures and focused validation entry points without changing product behavior.

- [X] T001 Create reusable page-link, relationship, and graph fixtures in `tests/fixtures/knowledge.ts`
- [X] T002 [P] Export the knowledge fixtures from `tests/fixtures/workspace.ts`
- [X] T003 [P] Add focused knowledge-feature test guidance and review-artifact expectations in `docs/development.md`

---

## Phase 2: Foundational Document and Synchronization Contracts

**Purpose**: Make version-3 wiki-link content safe and make canonical relationships available to every offline story.

**⚠️ CRITICAL**: No user story work begins until version compatibility, runtime contracts, and relationship hydration pass.

- [X] T004 Add failing version-3 wiki-link validation, malformed-attribute, duplicate-occurrence, and v1/v2 compatibility cases in `packages/domain/tests/editor-document.spec.ts`
- [X] T005 Implement version-3 `wikiLink` mark validation, extraction, normalization, and page-context validation helpers in `packages/domain/src/content/editor-document.ts`
- [X] T006 Export the new wiki-link domain types and helpers from `packages/domain/src/index.ts`
- [X] T007 Add failing runtime-contract cases for version-3 marks and relationship change envelopes in `tests/contract/openapi.spec.ts` and `tests/contract/editor-export.spec.ts`
- [X] T008 Extend editor marks, relationship availability, and change-envelope runtime schemas in `packages/contracts/src/content-api.ts`
- [X] T009 Update the canonical OpenAPI source for version-3 documents and relationship-source changes in `specs/001-content-foundations/contracts/content-api.openapi.yaml`
- [X] T010 Add failing local-repository snapshot and source-replacement relationship cases in `packages/client-core/tests/local-store.contract.spec.ts`
- [X] T011 Hydrate snapshot relationships and add idempotent per-source derived-wiki replacement reads in `packages/client-core/src/local-store/local-repository.ts`
- [X] T012 Pass snapshot relationships through seed and reconciliation boundaries in `apps/web/src/services/local-content.ts` and `packages/client-core/src/reconciliation/reconcile.ts`

**Checkpoint**: Version 3 is non-destructive, relationship transport is executable, and local snapshot hydration is complete.

---

## Phase 3: User Story 1 — Link Pages While Writing (Priority: P1) 🎯 MVP

**Goal**: Insert, save, reload, and follow stable page links from the block editor.

**Independent Test**: Create Alpha and Beta, insert Beta from `[[` using only the keyboard, reload Alpha, activate the link, then rename/move Beta and verify stable navigation.

### Tests for User Story 1

- [X] T013 [US1] Add failing atomic add/retain/remove/reactivate and invalid-target integration cases in `packages/database/tests/relationships.integration.spec.ts`
- [X] T014 [P] [US1] Add failing `[[` filtering, empty state, insertion, dismissal, and keyboard cases in `apps/web/src/features/editor/wiki-link.spec.ts`
- [X] T015 [P] [US1] Add failing version-3 API replacement and logging-redaction cases in `apps/api/tests/page-documents.contract.spec.ts` and `apps/api/tests/logging.spec.ts`
- [X] T016 [P] [US1] Add the complete pointer and keyboard link-authoring journey in `tests/e2e/wiki-links.spec.ts`

### Implementation for User Story 1

- [X] T017 [US1] Reconcile document-derived `link:references` rows inside page replacement and revision restoration transactions in `packages/database/src/repositories/relationship-repository.ts` and `packages/database/src/mutations/execute-command.ts`
- [X] T018 [US1] Reconcile version-3 wiki relationships atomically with the local document projection in `packages/client-core/src/outbox/apply-to-projection.ts`
- [X] T019 [US1] Implement local page-candidate filtering, multi-character suggestion lifecycle, and stable occurrence insertion in `apps/web/src/features/editor/wiki-link.ts`
- [X] T020 [US1] Implement the accessible page-search popup and empty state in `apps/web/src/features/editor/wiki-link-menu.tsx`
- [X] T021 [US1] Configure wiki-link rendering and activation in `apps/web/src/features/editor/editor-extensions.ts` and `apps/web/src/features/editor/block-editor.tsx`
- [X] T022 [US1] Supply local page candidates and in-app target navigation through `apps/web/src/features/pages/page-document-form.tsx` and `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`

**Checkpoint**: Wiki-link authoring and stable navigation work independently online and from already-loaded local data.

---

## Phase 4: User Story 2 — Understand Incoming and Outgoing Links (Priority: P1)

**Goal**: Expose exact, navigable backlink and outgoing-link summaries with lifecycle diagnostics.

**Independent Test**: Link Alpha to Beta twice, verify one backlink with count 2, remove occurrences one at a time, and exercise trashed/restored target status.

### Tests for User Story 2

- [X] T023 [P] [US2] Add failing aggregation, reciprocal-link, lifecycle, and deterministic-order cases in `packages/domain/tests/knowledge-graph.spec.ts`
- [X] T024 [P] [US2] Add local relationship query and lifecycle-join cases in `packages/client-core/tests/local-store.contract.spec.ts`
- [X] T025 [P] [US2] Add backlink, outgoing-count, unavailable-target, and keyboard-navigation journeys in `tests/e2e/backlinks.spec.ts`

### Implementation for User Story 2

- [X] T026 [US2] Implement directed relationship aggregation and endpoint summaries in `packages/domain/src/content/knowledge-graph.ts` and export them from `packages/domain/src/index.ts`
- [X] T027 [US2] Add local relationship listing and knowledge-summary reads in `packages/client-core/src/local-store/local-repository.ts` and `apps/web/src/services/local-content.ts`
- [X] T028 [US2] Implement accessible incoming and outgoing panels with occurrence counts and availability states in `apps/web/src/features/knowledge/knowledge-links.tsx`

**Checkpoint**: Links provide useful bidirectional navigation even without the visual graph.

---

## Phase 5: User Story 3 — Explore the Knowledge Graph (Priority: P2)

**Goal**: Provide local/global deterministic graphs and an equivalent semantic navigation list.

**Independent Test**: Build a four-page network, switch between local/global modes, filter and select nodes in the SVG and semantic list, and open a connected page.

### Tests for User Story 3

- [X] T029 [US3] Extend graph-builder cases for local/global scope, cycles, reciprocal links, isolated pages, filtering, and 500/1,000 scale in `packages/domain/tests/knowledge-graph.spec.ts`
- [X] T030 [P] [US3] Add a one-second 500-node/1,000-connection performance assertion in `tests/performance/knowledge-graph.perf.spec.ts`
- [X] T031 [P] [US3] Add local/global, filter, pointer, keyboard, semantic-list, mobile-overflow, and critical-Axe journeys in `tests/e2e/knowledge-graph.spec.ts`

### Implementation for User Story 3

- [X] T032 [US3] Complete deterministic local/global graph construction and stable radial/concentric layout in `packages/domain/src/content/knowledge-graph.ts`
- [X] T033 [US3] Implement the responsive SVG graph, selection summary, filter, and semantic list in `apps/web/src/features/knowledge/knowledge-graph.tsx`
- [X] T034 [US3] Compose links and graph modes into the selected-page knowledge panel in `apps/web/src/features/knowledge/knowledge-panel.tsx`
- [X] T035 [US3] Integrate the knowledge panel and current-page focus/navigation in `apps/web/src/features/hierarchy/hierarchy-explorer.tsx`

**Checkpoint**: Both graph modes are deterministic, navigable, accessible, responsive, and within the reference performance bound.

---

## Phase 6: User Story 4 — Keep the Knowledge Network Offline (Priority: P1)

**Goal**: Preserve document/relationship atomicity through offline reload, catch-up, conflict, and snapshot replacement.

**Independent Test**: Add a link offline, reload, inspect backlinks and graph, reconnect, and verify one accepted occurrence; then prove a conflicting edit remains recoverable without partial canonical state.

### Tests for User Story 4

- [X] T036 [US4] Add fault-injection coverage for atomic local document/relationship/outbox writes in `packages/client-core/tests/editor-local-mutation.spec.ts` and `packages/client-core/tests/local-mutation.atomicity.spec.ts`
- [X] T037 [P] [US4] Add snapshot and incremental relationship catch-up/idempotency cases in `packages/client-core/tests/reconciliation.spec.ts`
- [X] T038 [P] [US4] Add offline reload, reconnect-once, removal, and competing-revision journeys in `tests/e2e/wiki-links-offline.spec.ts`

### Implementation for User Story 4

- [X] T039 [US4] Return complete per-source derived wiki relationships from incremental change routes in `apps/api/src/routes/changes.ts`
- [X] T040 [US4] Apply relationship-source changes transactionally and idempotently during reconciliation in `packages/client-core/src/reconciliation/reconcile.ts`
- [X] T041 [US4] Preserve relationship projections during conflict capture and verified snapshot replacement in `packages/client-core/src/outbox/outbox.ts` and `packages/client-core/src/local-store/local-repository.ts`

**Checkpoint**: Offline link edits and their graph projections survive reload, synchronize once, and remain recoverable on conflict.

---

## Phase 7: Polish and Cross-Cutting Quality

**Purpose**: Close export, revision, accessibility, responsive, operational, evidence, and documentation obligations.

- [X] T042 [P] Add exhaustive version-3 document and relationship export round-trip cases in `tests/contract/editor-export.spec.ts` and `tests/contract/export.spec.ts`
- [X] T043 Add revision-restore relationship-projection coverage in `apps/api/tests/page-documents.contract.spec.ts` and `tests/e2e/revision-restore.spec.ts`
- [X] T044 [P] Add graph, link, menu, lifecycle, focus, and narrow-viewport styles in `apps/web/src/styles.css`
- [X] T045 Attach deterministic desktop and mobile screenshots for link, backlink, and graph journeys in `tests/e2e/wiki-links.spec.ts`, `tests/e2e/backlinks.spec.ts`, and `tests/e2e/knowledge-graph.spec.ts`
- [X] T046 Extend the production Compose smoke with version-3 link persistence across restart in `scripts/ci/test-containers.ts`
- [X] T047 Update editor, deployment, data-export, and feature-operation guidance in `docs/editor.md`, `docs/deployment.md`, and `docs/development.md`
- [X] T048 Verify the existing GitHub Playwright artifact publication retains the new screenshots and traces in `.github/workflows/ci.yml`
- [X] T049 Run `specs/003-links-knowledge-graph/quickstart.md`, formatting, lint/static analysis, exact types, coverage, database/contract/performance suites, browser matrix, production build, and isolated container smoke; record evidence in `specs/003-links-knowledge-graph/validation.md`

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on setup and blocks all stories.
- **US1 (Phase 3)**: Depends on Phase 2 and establishes persisted wiki links.
- **US2 (Phase 4)**: Depends on US1 relationships but is independently useful without a graph.
- **US3 (Phase 5)**: Depends on the US2 aggregation model.
- **US4 (Phase 6)**: Depends on US1 persistence and the US2/US3 read models; validates the complete offline path.
- **Polish (Phase 7)**: Depends on all selected stories.

### User Story Dependency Graph

```text
Setup → Foundation → US1 → US2 → US3
                         └──────→ US4
US2 + US3 + US4 → Polish
```

### Within Each User Story

- Write and observe failing focused tests before implementation.
- Keep canonical/server and local projection rules behaviorally equivalent.
- Complete the independent Playwright journey before declaring the story done.
- Mark a task complete only after its focused checks pass.

### Parallel Opportunities

- T002 and T003 can run after T001 in separate files.
- Contract tests (T007), local-store tests (T010), and domain work (T004–T006) can proceed in separate files before integration.
- US1 editor tests (T014), API tests (T015), and E2E scaffold (T016) are independent once Phase 2 passes.
- US2 domain (T023), client (T024), and E2E (T025) tests can be authored in parallel.
- US3 performance (T030) and E2E (T031) tests can be authored independently after graph contracts exist.
- US4 reconciliation (T037) and browser journeys (T038) can be authored independently after the local mutation test (T036).
- Export tests, styles, and documentation tasks use separate files during polish.

## Implementation Strategy

### MVP First

1. Complete setup and foundational contracts.
2. Complete US1 so stable wiki links can be authored, persisted, and followed.
3. Validate the independent US1 journey before adding discovery surfaces.

### Incremental Delivery

1. Add backlinks/outgoing summaries as a complete second increment.
2. Add local/global graph exploration on the same aggregate model.
3. Exercise the whole knowledge network through offline/conflict paths.
4. Close export, evidence, responsive, deployment, and full-gate obligations.

## Format Validation

All 49 tasks use the required checkbox, sequential ID, optional parallel marker, required story label inside story phases, imperative description, and concrete file paths.
