# Feature Specification: E2E Gate Throughput and Fast Failure

**Feature Branch**: `ci/058-e2e-gate-throughput`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Accélérer et fiabiliser la porte E2E de la CI. Constat (run 43266767307, PR #196) : les jobs Playwright prennent 41 à 79 min, l'essentiel en échecs (timeouts de test 60–360 s × retry), exécution strictement en série (workers 1, base partagée), shards WebKit enchaînés séquentiellement et interrompus au premier échec, aucun CI vert depuis le 4 novembre, runs annulés après 2 h. Objectifs : signal d'échec rapide, temps mur borné pour une PR verte, couverture de la matrice 5 projets complète et visible, conserver la politique fail-on-flaky, rapport fusionné, pas de baisse de couverture silencieuse ; option de hiérarchisation PR/main/nightly à décider."

## Context and Evidence

Measured on pull-request run 43266767307 (PR #196, full journey corpus selected
because the change touched more than 500 files):

| Browser project | Journey step | Spent in failed attempts | Passing journeys (median) |
| --- | --- | --- | --- |
| webkit-mobile | 79 min | 68 min | 97 (4.4 s) |
| chromium-mobile | 60 min | 39 min | 305 (2.9 s) |
| firefox-desktop | 57 min | 17 min | 311 (5.4 s) |
| chromium-desktop | 41 min | 12 min | 320 (3.9 s) |
| webkit-desktop | 18 min | 6 min | 104 (4.0 s) |

Observations that this feature responds to:

1. A failing interaction waits for the whole journey budget (60 s, 180 s for
   journeys declared slow, 360 s on the WebKit engine) and is then retried once,
   although the gate already rejects any journey that only passes on retry. One
   broken journey costs up to 12 minutes.
2. Every browser project runs its journeys strictly one after another on one
   runner because all journeys share one database. A fully green project still
   takes 25–35 minutes (green run of 2026-11-04).
3. The WebKit projects run their three recycled browser slices consecutively in
   one job and stop at the first failing slice: the failing run executed 122 of
   344 journeys while the job looked short. Coverage loss was not visible in the
   check name or the summary.
4. Setup (dependencies, browsers, database, build) is about two minutes per job
   and is not the bottleneck. Runner size is not the bottleneck while execution
   stays single-lane.
5. No pull-request gate has been green since 2026-11-04; one run lasted 2 h 11
   before being superseded.

Canvas sections: §42 "Stratégie de tests" and §42.3 "Tests Playwright" (journeys
across responsive viewports and browsers remain mandatory); §47 Phase 0
"Fondations de livraison". Constitution: III (every changed interactive flow has
a journey covering relevant viewport and browser behavior), VII (CI on every
pull request and every push to `main`), Development Workflow and Quality Gates.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A broken journey fails fast (Priority: P1)

As the maintainer pushing a pull request, when a journey is broken I learn which
one and why within minutes, instead of waiting for every broken interaction to
exhaust a multi-minute budget twice.

**Why this priority**: Failed attempts account for 29–87 % of journey time in the
measured run. This is the single largest cost and the cheapest to remove.

**Independent Test**: Introduce a deliberately unreachable control in one journey
and confirm the browser project reports that journey as failed, with its
evidence, in well under one minute of journey time, and that the gate is red.

**Acceptance Scenarios**:

1. **Given** a journey whose interaction targets a control that never appears,
   **When** the gate runs, **Then** that attempt fails after the bounded
   interaction wait, not after the full journey budget.
2. **Given** a journey that fails on its first attempt, **When** the gate runs,
   **Then** the gate is red and no time is spent on an attempt whose success
   could not turn the gate green.
3. **Given** a project in which many journeys fail, **When** the failure count
   reaches the configured cap, **Then** the project stops early, reports the
   failures found and the journeys not executed, and the gate is red.
4. **Given** a journey that legitimately needs a long budget (large data
   volumes, restart, multi-device convergence), **When** it runs, **Then** its
   longer total budget still applies while each individual interaction stays
   bounded.

---

### User Story 2 - A green pull request finishes in bounded time (Priority: P1)

As the maintainer, a pull request that selects the full journey corpus and
passes completes its browser checks in a bounded wall-clock time, so the gate is
usable several times a day.

**Why this priority**: Even with zero failures, today's serial execution costs
25–35 minutes per project and up to ~40 minutes for WebKit when all slices run.

**Independent Test**: Run the gate on a pull request that forces the full corpus
on an unchanged application; measure the time from the first journey job start
to the last journey job completion.

**Acceptance Scenarios**:

1. **Given** the full corpus selected and all journeys passing, **When** the
   gate runs, **Then** the browser checks finish within the target in SC-002.
2. **Given** the corpus is split across several isolated lanes per browser
   project, **When** the lanes run, **Then** no journey runs twice, none is
   omitted, and each lane uses its own isolated application data.
3. **Given** the impact plan selects only a few journeys, **When** the gate runs,
   **Then** it does not start more lanes than useful for that selection.

---

### User Story 3 - Coverage is complete and visible (Priority: P1)

As the maintainer or reviewer, I can see for each of the five browser projects
how many journeys passed, failed, were skipped, or were not executed, and a
failure in one slice never hides the journeys of another slice.

**Why this priority**: The current WebKit runner silently executed a third of
the corpus. A faster gate that hides coverage would be a regression.

**Independent Test**: Make one journey fail in the first WebKit slice and
confirm the other slices still run and report, and that the run summary shows
the executed and not-executed counts per project.

**Acceptance Scenarios**:

1. **Given** a failure in one slice of a project, **When** the gate runs,
   **Then** every other slice of every project still runs to completion.
2. **Given** a finished run, **When** the maintainer opens it, **Then** one
   merged report per run lists every journey attempt across all lanes and
   projects, with failure evidence attached.
3. **Given** a finished run, **When** the aggregate gate evaluates, **Then** it
   is red if any lane is missing, cancelled, skipped unexpectedly, or reports
   fewer executed journeys than were selected without an explicit skip reason.

---

### User Story 4 - Selective scope per event (Priority: P2)

As the maintainer, the depth of the browser matrix on a pull request, on `main`
and on a scheduled run follows an explicit, documented policy rather than an
accident of runtime.

**Why this priority**: Industry practice runs the dominant engine fully on every
pull request and the full cross-engine matrix on trunk or nightly. Adopting that
here changes a constitutional guarantee, so it is a decision, not a default.

**Independent Test**: Trigger each event type and confirm the selected projects
and journeys match the documented policy and are shown in the run summary.

**Acceptance Scenarios**:

1. **Given** the policy of FR-012, **When** a pull request, a push to
   `main`, or a scheduled run starts, **Then** the selected projects and journeys
   match that policy and the summary states it.

---

### User Story 5 - Long-running degradation is visible (Priority: P3)

As the maintainer, I can see which journeys are slowest and which consume the
most failure time across recent runs, so suite growth is noticed before it
becomes the next bottleneck.

**Why this priority**: Useful, but only after the gate is fast and green.

**Independent Test**: After a run, read a per-run summary listing the slowest
journeys and the total time spent per project and lane.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the maintainer opens its summary, **Then**
   the ten slowest journeys and per-lane durations are listed.

### Edge Cases

- A lane's runner dies or is cancelled mid-run: the aggregate gate is red, never
  green from the remaining lanes.
- The impact plan selects fewer journeys than lanes: unused lanes report an
  explicit no-op and still count as present for the aggregate gate.
- A journey is skipped by design on one project (engine-specific capability):
  it is reported as skipped with its reason and does not count as missing.
- A journey depends on order or on data left by a previous journey: splitting
  must expose this as a failure rather than hide it; journeys must stay
  independent.
- The WebKit engine degrades after a long sequence in one browser process:
  lanes keep each browser process bounded at least as tightly as today.
- Visual snapshot journeys: their baselines remain valid whatever lane runs them.
- The fail-on-flaky policy remains: a journey that would only pass on a second
  attempt is still a failure.
- Local `checks:local` and CI keep selecting the same corpus for a full run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each individual browser interaction and assertion in a journey
  MUST have a bounded wait, distinct from and much shorter than the journey's
  total budget, so a missing control fails within that bound.
- **FR-002**: Journeys declared as needing a longer total budget MUST keep it;
  a longer total budget MUST NOT extend the per-interaction bound unless the
  journey states so explicitly at that interaction.
- **FR-003**: The pull-request and `main` gates MUST NOT spend a second attempt
  on a journey when a pass on that attempt cannot make the gate green. If a
  second attempt is kept for diagnostic evidence, its cost MUST be bounded and
  reported.
- **FR-004**: A browser project MUST stop early after a configured number of
  failed journeys and MUST report how many selected journeys were not executed.
- **FR-005**: The selected journeys of each browser project MUST be distributed
  across several isolated lanes running concurrently; each lane MUST have its
  own application data, server processes and browser process.
- **FR-006**: The distribution MUST be deterministic for a given selection: the
  union of lanes equals the selection, with no duplicate and no omission.
- **FR-007**: The number of lanes per project MUST be derived automatically
  from the selection (and from measured durations when available), MUST grow
  with the corpus without any manual edit, and MUST NOT start lanes that would
  receive no journey, except the explicit no-op required for the aggregate
  gate.
- **FR-008**: A failure in one lane MUST NOT prevent any other lane of any
  project from running to completion.
- **FR-009**: The aggregate gate MUST fail when any expected lane is missing,
  cancelled or skipped, or when executed plus explicitly skipped journeys are
  fewer than the selection.
- **FR-010**: Each run MUST publish one merged report covering all lanes and
  projects, and keep per-failure evidence (trace, screenshot, logs).
- **FR-011**: The run summary MUST show, per project, the selected, passed,
  failed, skipped and not-executed counts, and the per-lane durations.
- **FR-012**: Pull requests MUST keep the five-project matrix for the selected
  journeys (the Principle III guarantee is unchanged). `main` and release runs
  keep the full corpus on the full matrix. A scheduled full-matrix run MUST
  exist so regressions unrelated to a pull request (engine, runner image,
  time-dependent data) are detected. A reduced pull-request matrix is NOT
  adopted in this feature; the measurements of FR-018 are the input of any
  later proposal, which would require a constitution amendment.
- **FR-013**: The fail-on-flaky policy MUST remain in force at every stage.
- **FR-014**: The WebKit engine MUST keep a bound on the number of journeys run
  in one browser process at least as strict as today.
- **FR-015**: The local complete gate MUST be able to reproduce any single CI
  lane with the same selection and isolation.
- **FR-016**: Contract tests MUST verify the lane distribution properties
  (FR-006, FR-007), the aggregate-gate rules (FR-009) and the bounded waits
  (FR-001), so they cannot regress silently.
- **FR-017**: The development guide MUST document the new lane model, the
  timing budgets, the event-scope policy and how to reproduce a lane locally.
- **FR-018**: Each run MUST list the slowest journeys and the total failed-attempt
  time per project.

### Key Entities

- **Browser project**: one of the five engine/viewport combinations.
- **Journey selection**: the journeys chosen for a run by the impact plan.
- **Lane**: an isolated execution unit receiving a deterministic subset of a
  project's selection, with its own data and processes.
- **Merged run report**: one report aggregating every lane and project.
- **Gate verdict**: the aggregate pass/fail derived from all expected lanes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A journey whose control never appears fails in at most 20 seconds
  of journey time (today: 60–360 s, doubled by retry).
- **SC-002**: A green pull request that selects the full corpus completes all
  browser checks within 20 minutes of wall-clock time from the first journey job
  start (today: 25–40 minutes per project when green).
- **SC-003**: A run with ten broken journeys completes all browser checks within
  25 minutes (today: 41–79 minutes for a comparable run, or cancelled at 2 h).
- **SC-004**: 100 % of selected journeys of every project are either executed or
  reported as explicitly not executed with a reason, in every run, including
  runs with failures (today: two thirds of WebKit journeys silently not run).
- **SC-005**: Total runner-minutes for a green full-corpus run increase by no
  more than 50 % compared with the 2026-11-04 green baseline.
- **SC-006**: One merged report per run is available, and finding a failed
  journey's evidence takes no more than two navigations from the run page.

## Clarifications

### Session 2026-11-12

- Q: Which browser projects run on each pull request? → A: Option A by default
  (maintainer asked to proceed with the broadest improvement plan without
  choosing a reduced matrix): keep all five projects on pull requests, gain
  time through fast failure and parallel lanes, add a scheduled full run, and
  defer any reduced matrix to a later, measured, constitution-amending change.

### Session 2026-11-13

- Q: May lane counts be a hand-maintained number per browser project? → A: No.
  The number of lanes and their content MUST follow the selected journeys
  automatically; adding journeys MUST NOT require editing a lane or shard
  count. A single sizing target and a safety cap are acceptable.

## Assumptions

- The repository is public, so hosted runners are not billed per minute; extra
  parallel jobs mainly cost concurrency slots. SC-005 still bounds waste.
- The concurrent-job limit of the hosted plan accommodates the target lane count
  alongside the other gate jobs; the plan verifies this.
- Journeys are already independent: each starts from reset content through the
  shared fixture. Order-dependent journeys found while splitting are bugs to fix.
- Fixing the currently failing database journeys of PR #196 is out of scope; it
  belongs to that feature. This feature makes their failure cheap and visible.
- Several workers sharing one runner and one application stack is out of scope
  for this iteration; lanes isolate at the job level. It may follow later.
- The impact plan (`ci/test-impact.json`) remains the source of the selection.
- Desktop Electron journeys and their workflow are out of scope.
