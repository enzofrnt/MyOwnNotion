# Tasks: Canonical Content Foundations

**Input**: Design documents from `specs/001-content-foundations/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/content-api.openapi.yaml`, `quickstart.md`

**Tests**: Unit, property, local-storage contract, database integration, API contract, fault-injection, and Playwright coverage is mandatory for every changed behavior. Every changed interactive flow receives a responsive Playwright journey; numeric coverage is an additional floor, not a substitute for behavioral tests.

## Phase 1: Setup

**Purpose**: Establish a TypeScript-only monorepo, reproducible local environment, and CI entry points.

- [X] T001 Create the pnpm workspace, pin Node.js and an exact pnpm release, commit frozen-lockfile policy, and add TypeScript-only root scripts in `package.json` and `pnpm-workspace.yaml`
- [X] T002 [P] Add strict shared compiler options with JavaScript disabled in `tsconfig.base.json`
- [X] T003 [P] Configure Biome, pinned ShellCheck/shfmt checks, and TypeScript-only, foreign-lockfile, and unmanaged-Python policy checks in `biome.jsonc`, `.editorconfig`, and `scripts/ci/check-toolchain.ts`
- [X] T004 [P] Create shared Vitest projects with V8 coverage floors of 90% statements/lines/functions and 85% branches in `vitest.workspace.ts`
- [X] T005 [P] Create Chromium, Firefox, WebKit, desktop, and mobile Playwright projects with CI `forbidOnly`, deterministic workers, reports, and failure traces in `playwright.config.ts`
- [X] T006 Define PostgreSQL development topology, healthcheck, persistent volume, shared timezone, and loopback-only port bindings in `compose.yaml` and `compose.override.yaml`
- [X] T007 [P] Document safe development variables without secrets in `.env.example`
- [X] T008 Create least-privilege CI jobs and a stable aggregate `quality-gate` for frozen pnpm install, toolchain policy, Biome, ShellCheck/shfmt, types, coverage, all tests, migrations, Playwright, and builds in `.github/workflows/ci.yml`, plus the required protected-main rule definition in `.github/rulesets/main.json`

---

## Phase 2: Foundational Prerequisites

**Purpose**: Create blocking packages and application shells required by every user story.

**⚠️ CRITICAL**: Complete this phase before user-story implementation.

- [X] T009 Create platform-independent domain package boundaries in `packages/domain/package.json` and `packages/domain/src/index.ts`
- [X] T010 [P] Define UUIDv7, item-kind, lifecycle, placement-kind, and safe-error primitives in `packages/domain/src/content/types.ts`
- [X] T011 [P] Define mutation, change-cursor, conflict, and revision value objects in `packages/domain/src/revisions/types.ts`
- [X] T012 Create OpenAPI-derived request/response schemas and baseline contract validation in `packages/contracts/src/content-api.ts` and `tests/contract/openapi.spec.ts`
- [X] T013 Create Drizzle PostgreSQL configuration with reviewed-SQL migration output in `drizzle.config.ts` and `packages/database/src/client.ts`
- [X] T014 Implement the initial canonical PostgreSQL schema in `packages/database/src/schema/`
- [X] T015 Generate and review constraints and indexes in `packages/database/migrations/0001_content_foundations.sql`
- [X] T016 [P] Create disposable PostgreSQL fixtures and Testcontainers helpers in `packages/test-utils/src/postgres.ts` and `tests/fixtures/workspace.ts`
- [X] T017 Create Fastify composition, redacted problem responses, and health route in `apps/api/src/app.ts`, `apps/api/src/plugins/errors.ts`, and `apps/api/src/routes/health.ts`
- [X] T018 [P] Create the React/Vite shell and typed API boundary in `apps/web/src/app.tsx` and `apps/web/src/services/content-api.ts`
- [X] T019 [P] Define immutable blob-store interface and development filesystem adapter in `packages/blob-store/src/blob-store.ts` and `packages/blob-store/src/filesystem-blob-store.ts`
- [X] T020 [P] Define the Dexie local schema for projections, revisions, outbox, cursors, and conflicts in `packages/client-core/src/local-store/schema.ts`
- [X] T021 [P] Configure Workbox to retain only the versioned application shell in `apps/web/vite.config.ts` and `apps/web/src/service-worker.ts`
- [X] T022 Verify empty and forward fixture migrations in `packages/database/tests/migrations.integration.spec.ts`

**Checkpoint**: Strict TypeScript builds, PostgreSQL migrates, API health is ready, the web shell loads, and the local schema opens.

---

## Phase 3: User Story 1 — Organize Knowledge Recursively (P1) 🎯 MVP

**Goal**: Create, nest, order, move, trash, and restore recursive page/folder branches without cycles or partial mutations.

**Independent Test**: Build a nested mixed hierarchy, reorder siblings, move a complete branch, reject a cycle, and confirm stable identities and descendants.

### Tests for User Story 1

- [X] T023 [P] [US1] Add containment-matrix and cycle property tests in `packages/domain/tests/hierarchy.property.spec.ts`
- [X] T024 [P] [US1] Add stable sibling-order and reorder property tests in `packages/domain/tests/ordering.property.spec.ts`
- [X] T025 [P] [US1] Add 10,000-item recursive query and branch-move integration tests in `packages/database/tests/hierarchy.integration.spec.ts`
- [X] T026 [P] [US1] Add create/list/reorder/move/trash/restore API contract tests in `apps/api/tests/hierarchy.contract.spec.ts`
- [X] T027 [P] [US1] Add responsive keyboard hierarchy journeys in `tests/e2e/hierarchy.spec.ts`

### Implementation for User Story 1

- [X] T028 [US1] Implement page/folder creation, parent validation, ordering, reorder, and cycle rejection in `packages/domain/src/content/hierarchy.ts`
- [X] T029 [US1] Implement transactional hierarchy reads and recursive cycle checks in `packages/database/src/repositories/hierarchy-repository.ts`
- [X] T030 [US1] Implement atomic branch move and reorder with serializable retry in `packages/database/src/repositories/move-branch.ts`
- [X] T031 [US1] Implement 30-day branch trash and placement-aware restore in `packages/domain/src/content/lifecycle.ts` and `packages/database/src/repositories/lifecycle-repository.ts`
- [X] T032 [US1] Implement item, reorder, move, trash, and restore routes in `apps/api/src/routes/items.ts` and `apps/api/src/routes/placements.ts`
- [X] T033 [US1] Implement accessible tree creation, reorder, move, trash, restore, loading, empty, and error states in `apps/web/src/features/hierarchy/`

**Checkpoint**: Recursive organization is fully demonstrable online through domain, database, API, and browser tests.

---

## Phase 4: User Story 6 — Continue Core Work Offline (P1)

**Goal**: Keep loaded core content readable/editable offline, persist local mutations with a durable outbox, and reconcile without silent loss.

**Independent Test**: Load once, disconnect and reload, mutate and restart offline, reconnect with duplicate delivery and a competing revision, then verify idempotent acceptance or durable conflict capture.

### Tests for User Story 6

- [X] T034 [P] [US6] Add local schema migration and projection contract tests in `packages/client-core/tests/local-store.contract.spec.ts`
- [X] T035 [P] [US6] Add atomic local-state/outbox fault-injection tests in `packages/client-core/tests/local-mutation.atomicity.spec.ts`
- [X] T036 [P] [US6] Add outbox retry, duplicate delivery, cursor catch-up, and conflict retention tests in `packages/client-core/tests/reconciliation.spec.ts`
- [X] T037 [P] [US6] Add ordered changes, verified snapshot fallback, and mutation-batch API contract tests in `apps/api/tests/reconciliation.contract.spec.ts`
- [X] T038 [P] [US6] Add reload-offline, mutate-offline, reconnect, and conflict Playwright journeys in `tests/e2e/offline-reconciliation.spec.ts`

### Implementation for User Story 6

- [X] T039 [US6] Implement transactional Dexie projection reads and writes in `packages/client-core/src/local-store/local-repository.ts`
- [X] T040 [US6] Implement atomic optimistic mutation plus outbox persistence in `packages/client-core/src/outbox/apply-local-mutation.ts`
- [X] T041 [US6] Implement durable retry states without mutation-ID regeneration in `packages/client-core/src/outbox/outbox.ts`
- [X] T042 [US6] Add monotonic workspace change sequence and cursor persistence in `packages/database/src/schema/change-sequence.ts` and `packages/database/src/repositories/change-repository.ts`
- [X] T043 [US6] Implement ordered change-cursor, verified snapshot, and idempotent mutation-batch routes in `apps/api/src/routes/changes.ts`, `apps/api/src/routes/snapshots.ts`, and `apps/api/src/routes/mutation-batch.ts`
- [X] T044 [US6] Implement cursor catch-up, verified snapshot fallback, acknowledgement, and conflict capture in `packages/client-core/src/reconciliation/reconcile.ts`
- [X] T045 [US6] Connect hierarchy and a minimal versioned page-document form to local projection reads and commands in `apps/web/src/services/local-content.ts` and `apps/web/src/features/pages/page-document-form.tsx`
- [X] T046 [US6] Implement offline, pending, synchronizing, synchronized, quota-failure, and conflict indicators in `apps/web/src/components/sync-status.tsx`
- [X] T047 [US6] Request persistent browser storage and expose quota diagnostics in `apps/web/src/services/storage-manager.ts`

**Checkpoint**: Core loaded content survives server loss and browser restart; no local success exists without matching durable outbox state.

---

## Phase 5: User Story 2 — Distinguish Pages, Folders, and Files (P2)

**Goal**: Enforce type semantics and support one canonical file through multiple hierarchy and page-attachment placements.

**Independent Test**: Exercise every containment rule, safely reuse verified bytes, add/remove many placements, and replace content copy-on-write from any placement.

### Tests for User Story 2

- [X] T048 [P] [US2] Add page/folder/file type and placement cardinality property tests in `packages/domain/tests/content-types.property.spec.ts`
- [X] T049 [P] [US2] Add 100-placement, final-placement trash, and restore integration tests in `packages/database/tests/file-placements.integration.spec.ts`
- [X] T050 [P] [US2] Add identical-import, near-match, collision simulation, and copy-on-write tests in `packages/blob-store/tests/deduplication.spec.ts`
- [X] T051 [P] [US2] Add page-document type discrimination tests in `apps/api/tests/page-documents.contract.spec.ts`
- [X] T052 [P] [US2] Add import, placement, and file-content replacement contract tests in `apps/api/tests/files.contract.spec.ts`
- [X] T053 [P] [US2] Add attachment-list, hierarchy-file, and replace-content Playwright journeys in `tests/e2e/files.spec.ts`

### Implementation for User Story 2

- [X] T054 [US2] Implement page-document envelope and content-role validation in `packages/domain/src/content/content-items.ts`
- [X] T055 [US2] Implement file-placement add/remove/final-trash invariants in `packages/domain/src/content/file-placements.ts`
- [X] T056 [US2] Implement immutable SHA-256 ingest, byte verification, physical reuse, and copy-on-write in `packages/blob-store/src/content-store.ts`
- [X] T057 [US2] Implement logical-file and placement persistence without implicit logical merging in `packages/database/src/repositories/file-repository.ts`
- [X] T058 [US2] Implement page-document replacement only for page items in `apps/api/src/routes/page-documents.ts`
- [X] T059 [US2] Implement multipart import, file-placement, and copy-on-write content replacement routes in `apps/api/src/routes/files.ts`
- [X] T060 [US2] Implement hierarchy file nodes and the discreet per-page attachment panel in `apps/web/src/features/hierarchy/file-node.tsx` and `apps/web/src/features/attachments/attachment-panel.tsx`
- [X] T061 [US2] Implement file-content replacement feedback across every placement in `apps/web/src/features/attachments/replace-file-content.tsx`

**Checkpoint**: Identical imports stay logically separate; one logical file appears in many places and copy-on-write updates only that logical file.

---

## Phase 6: User Story 3 — Preserve Identity and Relationships (P3)

**Goal**: Keep stable identities and typed relations intact across rename, move, trash, restore, and name reuse.

**Independent Test**: Relate items, reorganize them repeatedly, and prove every surviving edge still resolves to the original target.

### Tests for User Story 3

- [X] T062 [P] [US3] Add randomized identity-preservation tests for 1,000 operations over 10,000 items in `packages/domain/tests/identity.property.spec.ts`
- [X] T063 [P] [US3] Add endpoint and unavailable-target integration tests in `packages/database/tests/relationships.integration.spec.ts`
- [X] T064 [P] [US3] Add relationship create/list/remove API contract tests and responsive relationship-diagnostic journeys in `apps/api/tests/relationships.contract.spec.ts` and `tests/e2e/relationships.spec.ts`

### Implementation for User Story 3

- [X] T065 [US3] Implement typed relationship validation and unavailable-target semantics in `packages/domain/src/content/relationships.ts`
- [X] T066 [US3] Implement stable endpoint persistence and diagnostics in `packages/database/src/repositories/relationship-repository.ts`
- [X] T067 [US3] Implement relationship create/list/remove routes in `apps/api/src/routes/relationships.ts`
- [X] T068 [US3] Expose stable IDs and relationship diagnostics in `apps/web/src/features/hierarchy/item-details.tsx`

**Checkpoint**: Moves, renames, trash, restoration, duplicate names, and purged targets never silently redirect a relation.

---

## Phase 7: User Story 4 — Recover from Interrupted Changes (P4)

**Goal**: Ensure every server and local canonical mutation is all-or-nothing and idempotent under interruption or retry.

**Independent Test**: Inject failures at every persistence boundary and reopen both stores to observe only complete prior or accepted new states.

### Tests for User Story 4

- [X] T069 [P] [US4] Add mutation idempotency and validation rejection unit tests in `packages/domain/tests/mutations.spec.ts`
- [X] T070 [P] [US4] Add server transaction fault injection for every mutation class in `packages/database/tests/atomicity.integration.spec.ts`
- [X] T071 [P] [US4] Add duplicate idempotency-key and safe-error API contract tests in `apps/api/tests/mutations.contract.spec.ts`
- [X] T072 [P] [US4] Add browser/server interruption recovery Playwright tests in `tests/e2e/interrupted-mutations.spec.ts`

### Implementation for User Story 4

- [X] T073 [US4] Implement typed mutation dispatch and idempotent results in `packages/domain/src/content/mutations.ts`
- [X] T074 [US4] Implement shared transactional mutation runner with serializable bounded retry in `packages/database/src/mutations/run-mutation.ts`
- [X] T075 [US4] Integrate mutation IDs and safe conflict responses across routes in `apps/api/src/plugins/mutations.ts`
- [X] T076 [US4] Add explicit pending, accepted, rejected, retry, recovered, and conflict feedback in `apps/web/src/features/hierarchy/mutation-status.tsx`

**Checkpoint**: Fault injection produces zero partial states and replay never duplicates side effects.

---

## Phase 8: User Story 5 — Retain Verifiable Change Lineage (P5)

**Goal**: Record causal ancestry, retain superseded content 24 hours, restore it as new history, and preserve classification after pruning.

**Independent Test**: Create sequential/concurrent revisions, restore an older retained revision, classify with skewed clocks, prune eligible snapshots, and classify again.

### Tests for User Story 5

- [X] T077 [P] [US5] Add exhaustive ancestry/concurrency graph tests in `packages/domain/tests/revision-lineage.property.spec.ts`
- [X] T078 [P] [US5] Add 24-hour retention, conflict protection, restore-as-descendant, and pruning integration tests in `packages/database/tests/revision-retention.integration.spec.ts`
- [X] T079 [P] [US5] Add revision fetch, restore, expired snapshot, and comparison API contract tests in `apps/api/tests/revisions.contract.spec.ts`
- [X] T080 [P] [US5] Add retained-revision restore and stale-head conflict Playwright journeys in `tests/e2e/revision-restore.spec.ts`

### Implementation for User Story 5

- [X] T081 [US5] Implement immutable revision headers, parent validation, and causal classification in `packages/domain/src/revisions/lineage.ts`
- [X] T082 [US5] Persist revisions and parent edges atomically with mutations in `packages/database/src/repositories/revision-repository.ts`
- [X] T083 [US5] Implement deterministic snapshot retention and restore-as-new-descendant rules in `packages/domain/src/revisions/retention.ts`
- [X] T084 [US5] Implement revision retrieval, comparison, and restoration routes in `apps/api/src/routes/revisions.ts`
- [X] T085 [US5] Implement retained revision preview/restore feedback in `apps/web/src/features/history/revision-restore.tsx`

**Checkpoint**: History restoration never rewrites ancestry, stale heads conflict explicitly, and classification survives content expiry.

---

## Phase 9: Export, Performance, and Cross-Cutting Quality

**Purpose**: Close specification-wide integrity, backup-input, ownership, accessibility, and operational validation.

- [X] T086 [P] Implement the versioned canonical export and backup-input manifest in `packages/domain/src/export/canonical-export.ts`
- [X] T087 [P] Add export completeness, 30-day trash inclusion, and round-trip tests in `tests/contract/export.spec.ts`
- [X] T088 Implement asynchronous export creation, status, validation, and artifact retrieval routes in `apps/api/src/routes/export.ts`
- [X] T089 [P] Add the 10,000-item/1,000-operation performance suite in `tests/performance/content-foundations.perf.spec.ts`
- [X] T090 [P] Add keyboard, focus, semantic tree, and responsive accessibility assertions in `tests/e2e/accessibility.spec.ts`
- [X] T091 [P] Add structured safe logging with private-content redaction tests in `apps/api/src/plugins/logging.ts` and `apps/api/tests/logging.spec.ts`
- [X] T092 [P] Add CI assertion that Compose publishes only loopback ports in `tests/contract/compose-security.spec.ts`
- [X] T093 Validate every scenario and command in `specs/001-content-foundations/quickstart.md`
- [ ] T094 Record measured coverage, Playwright matrix, aggregate CI status, protected-main ruleset verification, and justified deviations in `specs/001-content-foundations/validation.md`
- [X] T095 Document pnpm-only Node.js work, uv-only future Python work, Biome, ShellCheck/shfmt, test layers, local commands, and merge-blocking CI in `docs/development.md`

---

## Phase 10: User Story 7 — Run the Finished Application from Published Artifacts (P2)

**Goal**: Publish reproducible API and web images to GitHub Container Registry and provide a documented loopback-only production-like composition that another maintainer can validate on a clean host.

**Independent Test**: Build both images from a clean checkout, render the production-like composition, start storage/migrations/API/web in dependency order, verify direct and proxied health, restart without data loss, and inspect the publication workflow for immutable revision tags.

### Tests for User Story 7

- [X] T096 [P] [US7] Extend production Compose security, migration-order, image-reference, healthcheck, volume, and immutable-tag contract assertions in `tests/contract/compose-security.spec.ts`
- [X] T097 [P] [US7] Add a clean-build container smoke script for API readiness, same-origin web proxying, and restart persistence in `scripts/ci/test-containers.ts` and expose it through `package.json`

### Implementation for User Story 7

- [X] T098 [P] [US7] Create a reproducible non-root API image containing the bundled server and migration runner in `apps/api/Dockerfile`, `apps/api/package.json`, and `.dockerignore`
- [X] T099 [P] [US7] Create an unprivileged static web image with same-origin `/v1` and `/health` proxying in `apps/web/Dockerfile` and `apps/web/nginx.conf`
- [X] T100 [US7] Define PostgreSQL, migration, API, and web services with named persistence, health gates, GHCR image defaults, local-build fallback, and loopback-only ports in `compose.prod.yaml` and `.env.prod.example`
- [X] T101 [US7] Build API and web images on pull requests and publish multi-architecture immutable commit plus release aliases from trusted revisions in `.github/workflows/container-images.yml`
- [X] T102 [US7] Document prerequisites, registry authentication, configuration, pull/build, startup, verification, logs, stop, restart, update, persistence, cleanup, and unauthenticated exposure limits in `docs/deployment.md`
- [ ] T103 [US7] Validate the complete production-like procedure and record image build, Compose render, migration/API/web health, restart, and publication-workflow evidence in `specs/001-content-foundations/validation.md`

**Checkpoint**: A clean host can retrieve or build the exact API and web revision, start the complete stack locally, verify it, and restart it without undocumented steps or public exposure.

---

## Dependencies and Execution Order

- **Setup → Foundational** blocks all stories.
- **US1** is the first online vertical slice.
- **US6** immediately follows US1 and is required before calling the core flow constitution-compliant.
- **US2** reuses hierarchy and local projection behavior.
- **US3** can begin after Foundational, with UI integration following US1.
- **US4** consolidates server and local mutation boundaries after US1/US6.
- **US5** relies on the shared mutation runner and conflict capture.
- **Cross-cutting** follows all content stories.
- **US7** follows the production builds and migration path, and can proceed in parallel with final validation documentation once application behavior is stable.

```text
Setup → Foundational → US1 → US6 → US2
                              ├──→ US3
                              └──→ US4 → US5
All stories → Cross-cutting validation
Production build + migrations → US7 packaging and deployment validation
```

## Parallel Opportunities

- Setup configuration tasks T002–T005 and T007 are independent.
- Foundational helpers T016 and application/storage shells T018–T021 can proceed in parallel after package setup.
- Test tasks at the start of each story are parallel and precede implementation.
- Blob implementation T056 can proceed beside file-domain work T055 after failing tests exist.
- Relationship model work can proceed beside US2 after the foundational schema.
- Pure lineage tests can be prepared while the shared mutation runner is completed.
- US7 API and web container builds T098–T099 can proceed in parallel after their contract tests are defined.

## Implementation Strategy

1. Complete Setup and Foundational phases.
2. Deliver US1, then US6 before treating the MVP as constitution-compliant.
3. Demonstrate online and offline acceptance journeys.
4. Add files, relationships, interruption recovery, and lineage incrementally.
5. Update checkboxes only after relevant tests and gates pass.
6. Package the validated applications, publish immutable image references from trusted revisions, and prove the documented production-like startup path.

## Format Validation

All tasks use the required checkbox, sequential `T###` identifier, optional `[P]`, required story label in story phases, concrete action, and explicit path.
