---

description: "Implementation tasks for CI cache and selective test execution"
---

# Tasks: CI Cache and Selective Tests

**Input**: Design documents from `/specs/016-ci-cache-selective-tests/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`,
`contracts/impact-plan.schema.json`

**Tests**: Contract and workflow tests are required because the feature changes
which verification is executed and therefore must fail closed.

**Organization**: Tasks are grouped by user story so caching, impact selection,
and observability can each be validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story from `spec.md`
- Every task names the files it changes or validates

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the declarative contracts and command entry points used
by the implementation.

- [x] T001 Create the versioned impact-policy skeleton in `ci/test-impact.json`
- [x] T002 [P] Add `ci:test-impact` and `ci:test:affected` commands in `package.json`
- [x] T003 [P] Register the new required CI scripts in `scripts/ci/check-toolchain.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement and validate the deterministic plan contract that every
user story consumes.

**⚠️ CRITICAL**: No workflow selection may be enabled until these fail-closed
contract tests pass.

- [x] T004 Write failing policy-completeness, change-classification, fallback, and deterministic-plan tests in `tests/contract/test-impact.spec.ts`
- [x] T005 Implement policy loading, validation, exact Git change-set collection, impact calculation, cache-scope calculation, JSON output, and GitHub outputs in `scripts/ci/test-impact.ts`
- [x] T006 Populate `ci/test-impact.json` with all current Vitest consumers, all Playwright journeys, broad-trigger rules, and safe non-executable rules
- [x] T007 Validate generated plans against `specs/016-ci-cache-selective-tests/contracts/impact-plan.schema.json` through `tests/contract/test-impact.spec.ts`

**Checkpoint**: A pull-request change set deterministically produces `none`,
`affected`, or `full`; invalid or unknown inputs produce `full`.

---

## Phase 3: User Story 1 - Reuse safe CI work (Priority: P1) 🎯 MVP

**Goal**: Reuse package downloads, Playwright browsers, and container layers
without crossing the pull-request/trusted publication boundary.

**Independent Test**: Workflow contract tests prove that keys include the
required compatibility inputs, API/web BuildKit scopes are distinct, and no
trusted image build imports a PR scope.

### Tests for User Story 1

- [x] T008 [P] [US1] Add dependency, browser, BuildKit target-scope, and cache-trust assertions in `tests/contract/release-gates.spec.ts`
- [x] T009 [P] [US1] Add exact-SHA cached publication assertions in `tests/contract/release-artifacts.spec.ts`

### Implementation for User Story 1

- [x] T010 [US1] Add target- and trust-scoped BuildKit cache imports/exports to image build and scan steps in `.github/workflows/ci.yml`
- [x] T011 [US1] Reuse exact-commit trusted BuildKit caches during image publication in `.github/workflows/ci.yml` and `.github/workflows/release.yml`
- [x] T012 [US1] Preserve lockfile-keyed pnpm caching and version-keyed Playwright caching across selected jobs in `.github/workflows/ci.yml`

**Checkpoint**: Repeated compatible runs reuse downloads and image layers, while
PR-produced caches cannot feed main or release publication.

---

## Phase 4: User Story 2 - Run only affected tests (Priority: P1)

**Goal**: Pull requests run only demonstrably affected Vitest and Playwright
tests, with complete conservative fallbacks and full trusted/local gates.

**Independent Test**: Documentation-only, narrow source, changed-test,
cross-cutting, rename, unknown-path, and non-PR scenarios all produce and execute
the expected plan.

### Tests for User Story 2

- [x] T013 [P] [US2] Add affected/no-op/full runner tests to `tests/contract/test-impact.spec.ts`
- [x] T014 [P] [US2] Add required-job, dynamic-E2E-matrix, and full-trusted-run assertions to `tests/contract/release-gates.spec.ts`

### Implementation for User Story 2

- [x] T015 [US2] Implement explicit no-op, direct, related, mixed, and full Vitest group execution in `scripts/ci/run-affected-vitest.ts`
- [x] T016 [US2] Add the impact-plan job, uploaded plan artifact, and compact downstream outputs to `.github/workflows/ci.yml`
- [x] T017 [US2] Make unit, integration, and contract jobs consume the plan without ever disappearing from `.github/workflows/ci.yml`
- [x] T018 [US2] Replace the fixed E2E matrix with the selected project matrix and `none` sentinel while preserving isolated reports in `.github/workflows/ci.yml`
- [x] T019 [US2] Keep push, workflow-call, manual, release, and `pnpm checks:local` execution full in `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `package.json`

**Checkpoint**: PR selection is narrow where proven safe; every ambiguity runs
the full relevant suite; all trusted and local gates remain full.

---

## Phase 5: User Story 3 - Understand and supersede CI work (Priority: P2)

**Goal**: Make every optimization auditable and stop obsolete pull-request work.

**Independent Test**: A generated GitHub summary explains the change boundary,
selected/no-op/full decisions, and cache scope; a newer PR run cancels the older
run without canceling unrelated trusted work.

### Tests for User Story 3

- [x] T020 [P] [US3] Add plan-summary and stable-concurrency-group assertions in `tests/contract/test-impact.spec.ts` and `tests/contract/release-gates.spec.ts`

### Implementation for User Story 3

- [x] T021 [US3] Emit concise impact reasons, selected files/groups, unknown fallbacks, and cache scope to `GITHUB_STEP_SUMMARY` in `scripts/ci/test-impact.ts`
- [x] T022 [US3] Add pull-request-specific cancel-in-progress concurrency while preserving unrelated trusted runs in `.github/workflows/ci.yml`
- [x] T023 [US3] Keep E2E artifact names isolated by browser/viewport project and report no-op/full/affected execution in `.github/workflows/ci.yml`

**Checkpoint**: Maintainers can explain every selected or omitted test and no
obsolete PR run continues consuming runners.

---

## Phase 6: Polish & Cross-Cutting Validation

**Purpose**: Document the policy, validate all gates, and capture evidence.

- [x] T024 [P] Document policy maintenance, cache behavior, local/full safety nets, and diagnostic commands in `docs/development.md`
- [x] T025 [P] Reconcile feature status and decisions in `docs/product/roadmap.md` and `specs/016-ci-cache-selective-tests/spec.md`
- [x] T026 Run targeted planner, workflow-contract, and type/lint checks and record evidence in `specs/016-ci-cache-selective-tests/validation.md`
- [x] T027 Run every scenario from `specs/016-ci-cache-selective-tests/quickstart.md` and record results in `specs/016-ci-cache-selective-tests/validation.md`
- [x] T028 Run the mandatory full `pnpm checks:local` pre-push gate and record the result in `specs/016-ci-cache-selective-tests/validation.md`
- [x] T029 Re-run Spec Kit consistency and convergence checks, mark completed tasks in `specs/016-ci-cache-selective-tests/tasks.md`, and resolve all HIGH findings

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on T001–T003 and blocks workflow selection.
- **User Story 1 (Phase 3)**: Depends on cache-scope output from T005.
- **User Story 2 (Phase 4)**: Depends on the complete planner foundation.
- **User Story 3 (Phase 5)**: Depends on the planner and workflow jobs from US2.
- **Polish (Phase 6)**: Depends on all selected user stories.

### User Story Dependencies

- **US1** can be validated once cache scopes exist; it does not require selective
  execution.
- **US2** depends only on the foundational plan contract and can operate without
  US1 cache improvements.
- **US3** consumes US2's plan and job topology but adds no selection semantics.

### Parallel Opportunities

- T002 and T003 can run in parallel with T001.
- T008 and T009 can run in parallel before cache implementation.
- T013 and T014 can run in parallel before selective workflow implementation.
- T020's two test-file changes can be developed independently.
- T024 and T025 can run in parallel after behavior stabilizes.

## Implementation Strategy

1. Establish and test the fail-closed impact contract.
2. Add safe cache reuse without changing which gates run.
3. Enable selective PR execution behind the tested plan contract.
4. Add summaries and concurrency cancellation.
5. Validate narrow scenarios, then execute the unchanged full local gate before
   push and pull request creation.

## Notes

- A skipped or missing required job is a regression; empty selections must be
  successful no-ops.
- Any unmapped executable path is a policy failure and selects the full relevant
  suite.
- Changed tests always run, even when their associated source path is absent.
- Full main/release/manual/local execution is the safety net for map drift.
- Check tasks off only after their implementation and evidence are complete.
