# Implementation Plan: E2E Gate Throughput and Fast Failure

**Branch**: `ci/058-e2e-gate-throughput` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/058-e2e-gate-throughput/spec.md`

## Summary

The browser gate is slow for three independent reasons, each with its own lever:

1. **Failures are expensive** — no per-interaction bound, `test.slow()` triples
   the budget, CI retries once although `--fail-on-flaky-tests` makes a retry
   pass worthless. Lever: bounded action/navigation waits, `retries: 0` in the
   gate, `--max-failures`, job `timeout-minutes`.
2. **Execution is single-lane** — one worker, one shared database per project.
   Lever: self-sizing lanes in the CI matrix; each lane is a full isolated
   stack (own runner, PostgreSQL, API, preview, browser). The planner computes
   the number of lanes and their file lists from the selection, so growth of
   the corpus never requires editing a shard count.
3. **Coverage loss is invisible** — sequential WebKit slices stop at the first
   failure. Lever: lanes as independent jobs, blob reports merged into one
   report, and an executable coverage guard that compares expected journeys with
   reported ones and feeds `quality-gate`.

Secondary levers land after the three above: single-engine browser install,
scheduled full run, slow-journey summary, artifact size, documentation. Per-worker
stacks inside one job and a reduced pull-request matrix are designed for but
deliberately deferred (see research R8, R9).

Expected wall clock for a green full-corpus pull request: about 14–17 min
(today 47 min on `main` run 43417465029); for a run with broken journeys: about 15–20 min (today
41–79 min or cancelled at 2 h).

## Technical Context

**Language/Version**: TypeScript (strict) on Bun 1.4.2; Bash for the runner; GitHub Actions YAML

**Primary Dependencies**: `@playwright/test` ^1.58 (blob reporter, `merge-reports`, `--shard`, `--max-failures`), existing `scripts/ci/test-impact.ts` and `ci/test-impact.json`

**Storage**: N/A (each lane uses its disposable PostgreSQL, unchanged)

**Testing**: Vitest contract tests (`tests/contract/test-impact.spec.ts`, `e2e-project-runner.spec.ts`, `bun-production-artifacts.spec.ts`, `release-gates.spec.ts`) plus a new `e2e-gate-coverage.spec.ts`; the pull request's own CI run is the end-to-end proof

**Target Platform**: GitHub-hosted `ubuntu-24.04` runners (public repository, 4 vCPU / 16 GB); local macOS through `test:e2e:local`

**Project Type**: Delivery tooling for an existing web application monorepo

**Performance Goals**: SC-001 ≤ 20 s for an unreachable control; SC-002 ≤ 20 min green full corpus; SC-003 ≤ 25 min with ten broken journeys

**Constraints**: five-project matrix kept on pull requests (FR-012); fail-on-flaky kept (FR-013); WebKit process bound kept (FR-014); runner-minutes ≤ +50 % (SC-005); hosted concurrency limit of 20 Linux jobs on the free plan (R6); pinned action SHAs and pinned runner image; no new third-party action without a pinned SHA

**Scale/Scope**: 344 journeys in 60 spec files × 5 projects = 1,720 executions per full run; 17–20 computed lanes; about 36 jobs per run

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
| --- | --- |
| I. User Ownership and Local Resilience | Not affected: no product data or runtime change. |
| II. One Spec, Any Agent | Pass: all decisions live in this feature directory and `docs/development.md`; no agent-specific copy. |
| III. Incremental, Verifiable Delivery | Pass, strengthened: every changed flow still runs on all five projects on pull requests; the coverage guard turns silent omission into a red gate. Five independently mergeable lots. |
| IV. Privacy and Security by Default | Pass: no new permission; merge job needs only `contents: read`; reports contain test fixtures only, same as today. |
| V. Simple, Modular Architecture | Pass: static, reviewable shard map; no runtime heuristic; one new small script. Per-worker stacks rejected for now as higher complexity (R8). |
| VI. Practical and Predictable Experience | Not affected (no UI). UI quality skill not applicable. |
| VII. Reproducible Toolchains and Enforced Quality | Pass: CI still runs on every pull request and push to `main`; `quality-gate` gains a required job; a scheduled trigger is additive. Retry removal does not weaken the gate because retry-only passes were already failures. |
| VIII. Canonical Product Direction | Pass: canvas §42.3 and §47 Phase 0 unchanged; no canvas edit required. |

Post-design re-check: no violation; Complexity Tracking empty.

## Design

### Lot 1 — Fast failure (US1; FR-001..004, FR-013)

- `playwright.config.ts`
  - `use.actionTimeout: 15_000`, `use.navigationTimeout: 30_000`
    (`expect.timeout` stays 10 s). A journey that needs longer at one
    interaction passes an explicit `{ timeout }` at that call.
  - `retries: 0` everywhere. Rationale recorded in the config comment: with
    `--fail-on-flaky-tests` a retry can never turn the gate green; it only
    doubled the bill. Flaky-versus-broken classification moves to the scheduled
    run (Lot 4), which may use `--retries=1` for diagnosis only.
  - `maxFailures: isCI ? 10 : undefined` per lane.
  - Per-project total budgets unchanged (60 s; WebKit 120 s).
- Audit of the 13 `test.slow()` and 17 `test.setTimeout()` call sites: replace
  `test.slow()` with an explicit `test.setTimeout(150_000)` (the slowest such
  journey passes in 49 s on Firefox in green run 43417465029, so three times
  headroom) and cap every explicit budget at 180 s. Explicit budgets no longer scale
  with the WebKit project default.
- The job-level `timeout-minutes: 30` ships with Lot 2 (same workflow lines).
- Contract tests: `bun-production-artifacts.spec.ts` assertions updated for the
  new config lines; a new assertion forbids `test.slow(` in `tests/e2e`.

### Lot 2 — Self-sizing isolated lanes (US2, US3; FR-005..008, FR-014, FR-015)

The maintainer rejected hand-maintained shard counts (clarification
2026-11-13): the lane count must follow the corpus without anyone editing a
number when journeys are added. The planner therefore *computes* lanes.

- `ci/test-impact.json` gains one small block, the only knobs:

  ```json
  "e2eLanes": { "targetSeconds": 720, "maxPerProject": 6, "maxTotal": 15, "defaultSecondsPerTest": 7 }
  ```

  `maxTotal` was added after measurement: the account starts at most 20 jobs
  at once, 13 other jobs of the workflow start with the lanes, and a 20-lane
  run saw its last lane start 9 minutes late. When the projects ask for more
  than `maxTotal`, lanes are taken back from the project that stays shortest.

- `scripts/ci/test-impact.ts` builds, per project, explicit lanes:
  1. weight of a selected spec file = its measured duration for that project
     when a timings file is supplied (`--timings`, Lot 3), otherwise
     `declared tests in the file × defaultSecondsPerTest` (static count of
     `test(` declarations — no install, no browser);
  2. `lanes = clamp(ceil(Σ weights / targetSeconds), 1, min(maxPerProject, files))`;
  3. files are assigned by deterministic longest-processing-time bin packing
     (weight descending, then path; lightest lane, lowest index on ties);
     each lane lists its files in path order.
- The plan carries `e2e.lanes[] = { id, project, index, total, testFiles[],
  estimatedSeconds }` and `e2e.matrix[] = { project, lane: "i/n", laneId }`.
  The CI job reads its file list from the plan by `laneId`; Playwright's
  `--shard` is not used to split, so balance does not depend on Playwright's
  shard algorithm. The job passes `--shard=1/1` to
  `scripts/e2e/run-container-project.sh`, which keeps one browser process per
  lane; a WebKit lane is at most ~12 min of journeys, tighter than today's
  third of the corpus (FR-014).
- Expected first sizing (no timings yet, 344 tests × 7 s): 4 lanes per project,
  20 lanes; with measured timings (green `main` run 43417465029: 27, 31, 34,
  37, 43 min) 3+3+3+4+4 = 17 lanes, each ≤ ~12 min of journeys plus ~2 min
  setup. A narrow pull request gets one lane per project automatically. Adding
  journeys adds lanes automatically up to the cap; the cap is the only number
  that could ever need a human, and the summary warns when a lane's measured
  time exceeds 1.5 × `targetSeconds` at the cap.
- Job name `Playwright journeys (<project> <i/n>)`; `fail-fast: false` stays;
  `timeout-minutes: 30`.
- `scripts/e2e/run-container-project.sh`: the internal WebKit loop (used when
  no explicit shard is given, i.e. locally) changes from stop-at-first-failure
  to run-all-then-fail, so local runs no longer truncate coverage either.
- Local reproduction of a lane needs no new script: compute the plan with
  `bun run ci:test-impact`, select the lane's files with `jq`, pass them to
  `bun run test:e2e:local` (documented in `docs/development.md`).

### Lot 3 — Merged report and coverage guard (US3; FR-009..011, FR-016)

- Reporter in CI: `[["list"], ["blob"]]`; each lane uploads
  `blob-report-<laneId>` (retention 3 days) and its
  `test-results/` failure evidence (retention 14 days).
- New job `e2e-report` (`needs: [impact, e2e]`, `if: always()`):
  1. download all blob artifacts (`merge-multiple`);
  2. `playwright merge-reports --reporter html,json` → one
     `playwright-report` artifact and `e2e-results.json`;
  3. `bun scripts/ci/e2e-gate-summary.ts` also writes `e2e-timings.json`
     (project → file → seconds, passing attempts only). On `main` and scheduled
     runs it is saved with `actions/cache` under a `main`-scoped key; the
     `impact` job restores the latest one and passes `--timings`. Pull requests
     can read but never write that cache. A missing or stale file only means
     the static estimate is used: sizing self-tunes with zero upkeep.
  4. `bun scripts/ci/e2e-gate-summary.ts` reads `test-impact.json`,
     `e2e-results.json` and the output of `playwright test --list --reporter=json`
     for the selected files, then
     - writes the per-project table (selected, passed, failed, skipped,
       not-run), per-lane durations, ten slowest journeys and failed-attempt
       time to `$GITHUB_STEP_SUMMARY` and `e2e-gate-summary.json`;
     - exits non-zero when a lane artifact is missing, when a lane reported
       nothing for one of its files, when a declared journey has no attempt, or
       when any journey failed or was flaky. The expected set comes from the
       plan's lanes and from the merged report itself (a declared but
       unattempted test appears there with no result), so no separate
       `--list` pass is needed.
- `quality-gate.needs` gains `e2e-report`; `release-gates.spec.ts` asserts it.
- `e2e_mode == none` keeps the explicit no-op lane; `e2e-report` then records
  "no journeys selected" and succeeds.

### Lot 4 — Scheduled full run and trend visibility (US4, US5; FR-012, FR-018)

- `on.schedule` (nightly, 03:00 UTC) in `ci.yml`. The impact planner already
  treats every non-pull-request event as full corpus; add `schedule` to its
  accepted events and to the concurrency group expression.
- The scheduled run passes `--retries=1` without `--fail-on-flaky-tests` being
  relaxed: a flaky journey still fails, and the merged report then labels it
  flaky rather than broken — the diagnostic the pull-request gate gave up.
- Publication jobs stay guarded to `push` on `main`; a contract test asserts a
  scheduled run cannot publish.
- `e2e-gate-summary.json` is uploaded on every run (90 days) as the trend source.

### Lot 5 — Secondary levers

- Install only the lane's engine: `playwright install --with-deps <engine>`
  derived from the project name (install step is 43–126 s today for three
  engines); cache key gains the engine.
- Skip the redundant web build check, keep one build per lane (2 s measured;
  no artifact sharing needed).
- Trace policy stays `retain-on-failure`; with `retries: 0` and `maxFailures`
  the 270 MB artifact shrinks proportionally. No further change.
- `docs/development.md`: "The browser matrix locally", "Pull-request test
  impact policy", "CI cache boundaries", "Delivery gate inventory" and "What
  blocks a merge" updated; `docs/audits/2026-11-ci-speed.md` gains the measured
  before/after table.

### Deferred, recorded so the next iteration does not rediscover them

- Several workers per job with one database/API/preview per worker
  (`parallelIndex`-keyed stack). Needed only if lane count hits the concurrency
  ceiling. See R8.
- Reduced pull-request matrix (Chromium full, tagged cross-engine subset,
  full matrix on `main`/nightly/merge queue). Requires a MINOR constitution
  amendment to Principle III and canvas §42.3. See R9.

## Delivery Order

Originally one pull request per lot. On 2026-11-13 the maintainer asked for a
single branch carrying the whole result, so every lot ships in one pull
request; the order below is the order of work. Lots 1 and 2 are independent of each other;
Lot 3 needs Lot 2; Lots 4 and 5 need Lot 3. Lot 1 alone removes most of the
failure cost; Lot 2 alone removes most of the green cost.

## Project Structure

### Documentation (this feature)

```text
specs/058-e2e-gate-throughput/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── impact-plan-e2e.schema.json
│   ├── e2e-gate-summary.schema.json
│   └── gate-rules.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code (repository root)

```text
.github/workflows/ci.yml                 # e2e matrix, timeout, blob upload, e2e-report job, schedule, quality-gate needs
playwright.config.ts                     # action/navigation timeouts, retries, maxFailures, reporter
ci/test-impact.json                      # e2eLanes sizing block
scripts/ci/test-impact.ts                # computed lanes, --timings, schedule event
scripts/ci/e2e-gate-summary.ts           # NEW: summary + coverage guard
scripts/ci/check-toolchain.ts            # register the new entry point
scripts/e2e/run-container-project.sh     # run-all-then-fail local WebKit loop
tests/e2e/*.spec.ts                      # test.slow() → explicit budgets (13 sites)
tests/contract/test-impact.spec.ts
tests/contract/e2e-project-runner.spec.ts
tests/contract/bun-production-artifacts.spec.ts
tests/contract/release-gates.spec.ts
tests/contract/e2e-gate-coverage.spec.ts # NEW
docs/development.md
docs/audits/2026-11-ci-speed.md
```

**Structure Decision**: No new package. The feature edits the existing CI
workflow, Playwright configuration, impact planner and runner script, and adds
one script under `scripts/ci/` with its contract test.

## Risks

| Risk | Mitigation |
| --- | --- |
| A 15 s action bound breaks a journey that legitimately waits longer at one step | Lot 1 runs the full matrix on its own pull request; offenders get an explicit per-call timeout, never a global raise. |
| Hidden order dependence between spec files appears when sharded | Fixture already resets per test; any failure is a real defect to fix in the journey (spec edge case). |
| 17–20 lanes + 18 other jobs exceed 20 concurrent jobs | Short jobs free slots within 1–3 min; measured queue delay is recorded; lane counts are the tuning knob (R6). |
| Uneven lane durations before timings exist | Static estimate is conservative (7 s/test); measured timings replace it automatically from the first `main` run after Lot 3 (R3). |
| Coverage guard false positive on engine-specific skips | Skips are counted as accounted-for; only unreported journeys fail the guard. |
| PR #196 still red after this lands | Out of scope by spec; this feature makes its failures cost seconds and visible. |

## Complexity Tracking

No constitution violation to justify.
