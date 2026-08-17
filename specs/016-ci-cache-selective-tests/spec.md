# Feature Specification: CI Cache and Selective Tests

**Feature Branch**: `agent/ci-cache-selective-tests`

**Created**: 2026-08-17

**Status**: Ready for Review

**Input**: Developer request: reuse safe CI work across runs, avoid repeated downloads and container rebuilds, and execute only unit and end-to-end tests that can be affected by a pull-request change.

**Product canvas scope**: sections 38 to 42, especially affected-scope CI in section 40.2, obsolete-run cancellation in section 40.3, image construction in section 41, and the test strategy in section 42.

**Dependencies**: feature 002 owns the secure delivery foundation and the single exact-commit quality gate. This feature refines its performance and selection policy without weakening that gate.

**Exclusions**: application behavior, user data, production runtime caching, branch-protection policy, release identity, security-check coverage, and the complete local pre-push gate do not change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reuse Safe CI Work (Priority: P1)

A contributor updating a pull request receives a new clean CI execution that reuses immutable dependency downloads, browser runtimes, and container build work from compatible prior executions instead of acquiring or rebuilding them again.

**Why this priority**: Repeated acquisition and container construction consume time before any useful feedback appears. Reuse delivers immediate value without changing which checks run.

**Independent Test**: Run the same candidate twice, inspect the second run's evidence, and verify that every unchanged reusable input is restored while all checks still execute against the current candidate.

**Acceptance Scenarios**:

1. **Given** a successful prior execution with identical dependency and browser inputs, **When** CI evaluates a new candidate with those inputs unchanged, **Then** it reuses the prior immutable downloads and still verifies the current candidate.
2. **Given** a successful prior container build with unchanged build inputs, **When** CI builds the same image target again, **Then** it reuses compatible layers and records the resulting image for the current candidate.
3. **Given** a dependency, browser, base-image, or build input has changed, **When** CI evaluates the candidate, **Then** the incompatible cached work is not treated as current work and the changed input is acquired or rebuilt.
4. **Given** a pull request can contain untrusted code, **When** it populates reusable work, **Then** no trusted `main` or release publication can consume that pull-request-owned cache.
5. **Given** no reusable entry exists or restoration fails, **When** CI continues, **Then** it performs the clean operation and does not turn cache availability into a required gate.

---

### User Story 2 - Run Only Affected Tests (Priority: P1)

A contributor receives unit, integration, contract, and browser-test feedback limited to tests whose declared or discoverable inputs can be affected by the pull-request change. The selection is conservative: uncertainty expands the test set rather than silently omitting evidence.

**Why this priority**: The complete test corpus and browser matrix dominate CI duration. Safe selection removes work that cannot provide information for the candidate.

**Independent Test**: Evaluate a table of representative change sets—documentation only, one domain module, one application feature, one test file, one shared fixture, and one unknown executable path—and compare the produced plan with the expected tests and fallback mode.

**Acceptance Scenarios**:

1. **Given** a pull request changes only documentation that no automated test reads, **When** the impact plan is produced, **Then** no application test process starts and the required test checks report an explicit successful no-runtime-tests result.
2. **Given** a source module changes, **When** unit-style tests are planned, **Then** tests related through the maintained module graph run and unrelated test files do not.
3. **Given** an end-to-end-owned feature path changes, **When** browser tests are planned, **Then** only its declared journeys run across every required browser and viewport variant.
4. **Given** a test file changes, **When** the plan is produced, **Then** that test is always included.
5. **Given** a shared test fixture, global test configuration, dependency lock, migration, security boundary, or unclassified executable path changes, **When** the plan is produced, **Then** every potentially affected suite runs.
6. **Given** a specification contract or configuration document is read by a contract test, **When** that document changes, **Then** its consumer test runs even though the input is not application source code.
7. **Given** CI runs for `main`, a release candidate, or a manual diagnostic, **When** the impact plan is produced, **Then** the complete required test corpus runs.

---

### User Story 3 - Understand and Supersede CI Work (Priority: P2)

A contributor can see why each suite ran or did not run, which cache scopes were used, and which earlier pull-request execution was superseded. Browser work is split into isolated variants so one slow variant does not force the others to wait before starting.

**Why this priority**: Selection that cannot be audited is difficult to trust. Cancelling obsolete candidates and running isolated variants concurrently reduce wasted elapsed time after correctness is established.

**Independent Test**: Update one pull request twice in quick succession, then inspect the latest run's summary and artifacts to verify cancellation, selected tests, fallback reasons, cache ownership, and isolated browser variants.

**Acceptance Scenarios**:

1. **Given** a pull-request CI execution is still running, **When** a newer commit for the same pull request starts, **Then** the obsolete execution is cancelled without cancelling an unrelated pull request, `main`, or release execution.
2. **Given** an impact plan selected or omitted suites, **When** a contributor reads the run summary, **Then** the changed paths, selection mode, selected suites, and conservative fallback reasons are available.
3. **Given** browser journeys are selected, **When** they execute, **Then** required browser and viewport variants run concurrently in isolated environments and retain distinct failure evidence.
4. **Given** no browser journey is selected, **When** the required browser-test check executes, **Then** one explicit successful no-op result is produced without installing browsers or starting the application stack.

### Edge Cases

- A renamed or deleted file is classified using both its previous and current
  paths where Git exposes both; removed TypeScript sources force full Vitest
  because their former static dependency graph is no longer available.
- A pull request with no usable merge base falls back to the complete test corpus.
- A cache restores successfully but its consumer detects missing or corrupt content; the clean operation runs and the gate records the cache miss/fallback.
- A path matches both a narrow journey mapping and a global trigger; the global trigger wins.
- A new end-to-end test is added without an impact declaration; impact-policy validation fails rather than leaving the test unreachable.
- A new first-party executable directory is added without a classification; pull-request selection expands to the complete corpus and reports the unknown path.
- A documentation file becomes an executable test input; it remains excluded only after its consumer mapping is added and validated.
- A browser variant fails while the others pass; the aggregate required gate fails and preserves that variant's report.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: CI MUST reuse compatible dependency downloads, browser runtimes, and container build work across executions.
- **FR-002**: Every reusable entry MUST be invalidated by all inputs that can make it incompatible, including platform and tool versions where relevant.
- **FR-003**: Pull-request-owned reusable work MUST NOT be consumed by trusted `main` or release publication paths; reusable entries MUST contain no secrets, credentials, or user content.
- **FR-004**: A missing, evicted, corrupt, or unavailable cache MUST fall back to the clean operation and MUST NOT count as passed evidence by itself.
- **FR-005**: Pull-request impact selection MUST compare the exact candidate against its pull-request base and MUST fall back to the complete corpus when that comparison cannot be established.
- **FR-006**: Every changed path MUST resolve to one of three explicit outcomes: no runtime tests, a named affected test set, or a complete-suite fallback.
- **FR-007**: No-runtime-test classification MUST be limited to maintained non-executable paths with no declared test consumer; test-consumed documents and configurations MUST map to their consumers.
- **FR-008**: Every added or changed test file MUST run in the candidate that changes it.
- **FR-009**: Unit-style selection MUST follow maintained source-to-test dependency relationships and MUST expand to the appropriate complete suite for unsupported dynamic or global inputs.
- **FR-010**: End-to-end selection MUST use an explicit, versioned ownership map from application and infrastructure inputs to journey files; an unmapped executable input MUST select the complete journey corpus.
- **FR-011**: Shared fixtures, global test configuration, dependency locks, migrations, security boundaries, and other declared broad inputs MUST select every suite they can affect.
- **FR-012**: Pull requests MAY use affected-test selection; pushes to `main`, release candidates, and manual diagnostics MUST execute the complete required test corpus.
- **FR-013**: Every required test job MUST finish with success or failure evidence. A valid empty selection MUST be represented by a successful explicit no-op, never by a skipped or missing required check.
- **FR-014**: Each execution MUST retain a machine-readable impact plan and a readable summary containing changed paths, selection mode, selected suites, fallback reasons, and cache trust scope.
- **FR-015**: The impact policy MUST have automated contract tests covering documentation-only, direct source, transitive source, changed test, test-consumed document, shared/global, unknown-path, missing-base, `main`, release, and manual execution scenarios.
- **FR-016**: CI MUST cancel an obsolete in-progress pull-request execution when a newer candidate for the same pull request starts, without cancelling `main`, release, manual, or unrelated pull-request executions.
- **FR-017**: Selected browser journeys MUST execute across every required browser and viewport variant in isolated environments, and each variant MUST retain distinct diagnostics.
- **FR-018**: The complete local pre-push gate MUST remain the required pre-push evidence and MUST NOT silently adopt pull-request-only selective behavior.
- **FR-019**: Container build, scan, and publication paths MAY reuse compatible layers, but every scan and published image MUST still be attributable to and verified for the exact candidate commit.
- **FR-020**: Formatting, lint, type, migration, build, Compose, security, and publication gates MUST remain required unless a future specification explicitly defines their own affected-scope policy.
- **FR-021**: The repository MUST validate that every maintained end-to-end journey and every non-executable exception is represented by the impact policy before selection can pass.

### Key Entities

- **Impact Plan**: Immutable decision for one candidate, including event type, base and head commits, changed paths, selection mode, selected test groups and journeys, browser variants, and fallback reasons.
- **Impact Rule**: Versioned declaration connecting source, infrastructure, test, or non-executable paths to affected suites or a full-suite fallback.
- **Cache Scope**: Trust and compatibility boundary for reusable work, including event ownership, target, platform, and input identity.
- **Test Variant**: One isolated browser and viewport execution of the selected journey set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A documentation-only pull request starts zero application test processes while all required test checks remain present and successful.
- **SC-002**: In the maintained impact-policy scenario matrix, 100% of expected affected tests are selected and 0 tests outside the expected set are selected for bounded narrow-change scenarios.
- **SC-003**: Every unknown executable path, missing comparison base, and declared global input selects the complete relevant corpus in 100% of contract-test scenarios.
- **SC-004**: A second execution with unchanged reusable inputs performs zero external dependency or browser-runtime downloads and reuses compatible container layers, while a changed compatibility input produces a miss.
- **SC-005**: No pull-request cache entry is used by a `main` or release publication scenario in the cache-isolation contract matrix.
- **SC-006**: Every `main`, release, and manual diagnostic scenario selects the complete required test corpus.
- **SC-007**: Every maintained browser journey has exactly one or more declared impact owners, and adding an undeclared journey fails policy validation.
- **SC-008**: For a narrowly mapped browser change, no unrelated journey executes, while 100% of required browser and viewport variants execute and report independently.
- **SC-009**: Starting a newer candidate cancels the older in-progress execution for the same pull request in the workflow contract, and never cancels executions from another trust or pull-request scope.
- **SC-010**: The machine-readable impact plan and human-readable summary agree on changed paths, selected suites, empty selections, and fallback reasons in every policy contract scenario.

## Assumptions

- GitHub Actions remains the official CI platform and the existing single aggregate `quality-gate` remains the protected-branch check.
- Pull-request code is treated as untrusted for cache ownership even when it originates in the main repository.
- Static dependency analysis is useful for unit-style tests but is not sufficient for browser journeys, runtime file loading, shared configuration, or unknown paths; explicit rules and complete-suite fallbacks cover those cases.
- Full local checks, `main`, release, and manual diagnostic executions provide recurring complete-corpus evidence; selective execution is a pull-request optimization only.
- CI performance is evaluated from run evidence rather than a fixed wall-clock threshold because hosted-runner provisioning and external service latency are outside repository control.
