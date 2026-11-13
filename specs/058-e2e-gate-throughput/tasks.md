# Tasks: E2E Gate Throughput and Fast Failure

**Input**: `specs/058-e2e-gate-throughput/` — [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Delivery**: at the maintainer's request (2026-11-13) all lots ship on one
branch, `ci/058-e2e-gate-throughput`, in one pull request; the lot headings
below are kept as the order of work. Before each push, select checks from `docs/development.md`;
every lot touches CI or Playwright configuration, so its own pull-request run
with the full corpus is required evidence. Record evidence in
`specs/058-e2e-gate-throughput/verification.md`.

**Format**: `[ID] [P?] [Story] Description` — `[P]` = parallelizable (different files, no dependency).

## Phase 1: Setup

- [x] T001 Create `specs/058-e2e-gate-throughput/verification.md` with the baseline tables from spec.md (run 43266767307 and green run 41836876945) and empty before/after sections per lot
- [x] T002 [P] Record per-lane measurement method (first journey job start → last lane end; runner-minutes sum) in `specs/058-e2e-gate-throughput/verification.md`

## Phase 2: Foundational

- [x] T003 Inventory every `test.slow()` and `test.setTimeout()` site in `tests/e2e/*.spec.ts` with its measured passing duration per project (from the 2026-11-04 green run logs) in `specs/058-e2e-gate-throughput/verification.md`

**Checkpoint**: baselines recorded; lots can start.

## Phase 3: User Story 1 — A broken journey fails fast (P1) — Lot 1, branch `ci/058-e2e-gate-throughput` (also carries these artifacts)

**Independent test**: quickstart §2 — unreachable control fails in ≤ 20 s, one attempt.

- [x] T004 [P] [US1] Update `tests/contract/bun-production-artifacts.spec.ts` to assert `actionTimeout: 15_000`, `navigationTimeout: 30_000`, `retries: 0`, `maxFailures` in CI, and `--fail-on-flaky-tests` on gate invocations (expect red first)
- [x] T005 [P] [US1] Add to `tests/contract/e2e-gate-coverage.spec.ts` a rule that `tests/e2e/**` contains no `test.slow(` (the workflow `timeout-minutes`/`fail-fast` assertions are added with T017)
- [x] T006 [US1] Set `use.actionTimeout`, `use.navigationTimeout`, `retries: 0`, `maxFailures: isCI ? 10 : undefined` in `playwright.config.ts`, rewriting the retry comment with the R2 rationale
- [x] T007 [US1] Replace the 13 `test.slow()` calls with explicit `test.setTimeout(n)` as `test.setTimeout(150_000)` (slowest passes in 49 s; cap 180 000, two larger budgets lowered to the cap) across `tests/e2e/*.spec.ts`
- [x] T008 [US1] (moved to T017 — same workflow lines as the lane matrix)
- [x] T009 [US1] Run the five projects locally (`bun run test:e2e:gate`); for each journey that exceeds the action bound at one legitimate step, add an explicit per-call `{ timeout }` in that spec file and list it in `verification.md`
- [x] T010 [US1] Execute quickstart §2 and record the measured failure time (SC-001) in `verification.md`
- [x] T011 [US1] Update "Test layers" / "The browser matrix locally" in `docs/development.md` with the timing budgets and the no-retry rationale
- [x] T012 [US1] Open the Lot 1 pull request forcing the full corpus; record per-project durations and failed-attempt time in `verification.md`

**Checkpoint**: failures cost seconds; gate verdict unchanged for green journeys.

## Phase 4: User Story 2 — Bounded time for a green pull request (P1) — Lot 2, branch `ci/058-parallel-lanes`

**Independent test**: quickstart §1 and §5 — computed lanes, none over 18 min.

- [x] T013 [US2] Implement computed lanes in `scripts/ci/test-impact.ts`: `e2eLanes` policy type and validation, static per-file test count, optional `--timings` input, lane count formula, deterministic LPT assignment, `e2e.lanes[]` and `e2e.matrix[]` output (per `data-model.md`)
- [x] T014 [P] [US2] Extend `tests/contract/test-impact.spec.ts`: partition property (union equal, disjoint) over random selections, determinism, cap and narrow-selection behaviour, growth (doubling the corpus raises the lane count with no policy edit), timings override, invalid policy rejected, mode `none` sentinel
- [x] T015 [P] [US2] Update the impact-plan schema used by the contract tests to match `specs/058-e2e-gate-throughput/contracts/impact-plan-e2e.schema.json`
- [x] T016 [US2] Add `e2eLanes` (`targetSeconds` 720, `maxPerProject` 6, `defaultSecondsPerTest` 7) to `ci/test-impact.json`
- [x] T017 [US2] Wire the matrix in `.github/workflows/ci.yml`: job name `Playwright journeys (<project> <lane>)`, files read from the plan by `laneId`, `--shard=1/1` passed to `scripts/e2e/run-container-project.sh`, artifacts named by `laneId`, `timeout-minutes: 30`
- [x] T018 [US3] Change the local WebKit loop in `scripts/e2e/run-container-project.sh` to run all three slices and exit non-zero if any failed; update `tests/contract/e2e-project-runner.spec.ts` ("runs every slice and propagates the failure")
- [x] T019 [P] [US2] Confirm `tests/contract/bun-production-artifacts.spec.ts` assertions on the runner loop still hold (loop text unchanged)
- [x] T020 [US2] Execute quickstart §1, §3 and §4; record outputs in `verification.md`
- [x] T021 [US2] Open the Lot 2 pull request forcing the full corpus; record lane durations, queue delay (R6) and runner-minutes (SC-005) in `verification.md`; if the slowest lane exceeds 18 min, lower `targetSeconds` (never a per-project count)
- [x] T022 [US2] Update "Pull-request test impact policy" and "The browser matrix locally" in `docs/development.md` (lane model, local `--shard` reproduction)

**Checkpoint**: green full corpus ≤ 20 min wall clock (SC-002).

## Phase 5: User Story 3 — Coverage complete and visible (P1) — Lot 3, branch `ci/058-merged-report-guard`

**Independent test**: quickstart §5 and §6.

- [x] T023 [P] [US3] Write `tests/contract/e2e-gate-coverage.spec.ts` cases for `scripts/ci/e2e-gate-summary.ts` against fixtures: all pass, missing lane, journey absent from every lane, duplicate journey, flaky, `maxFailures` interruption, engine-specific skip, mode `none` — per `contracts/gate-rules.md` (expect red first)
- [x] T024 [P] [US3] Add fixtures under `tests/contract/fixtures/e2e-gate/` (plan, `--list` output, merged results)
- [x] T025a [US2] Emit `e2e-timings.json` from `scripts/ci/e2e-gate-summary.ts`; save it with `actions/cache` on `main`/scheduled runs and restore it in the `impact` job (`--timings`) in `.github/workflows/ci.yml`; contract test that pull requests cannot write the timings cache
- [x] T025 [US3] Implement `scripts/ci/e2e-gate-summary.ts` (inputs: plan, `--list` JSON, merged results; outputs: `e2e-gate-summary.json` conforming to `contracts/e2e-gate-summary.schema.json`, Markdown step summary, exit code)
- [x] T026 [US3] Register `ci:e2e:summary` in `package.json` and in `scripts/ci/check-toolchain.ts`
- [x] T027 [US3] Switch the CI reporter in `playwright.config.ts` to `[["list"], ["blob"]]`; upload `blob-report-<laneId>` (3 days) and `test-results/` (14 days) from the `e2e` job in `.github/workflows/ci.yml`
- [x] T028 [US3] Add the `e2e-report` job to `.github/workflows/ci.yml` (`needs: [impact, e2e]`, `if: always()`, `contents: read`): download blobs, `playwright merge-reports --reporter html,json`, `playwright test --list --reporter=json`, run `ci:e2e:summary`, upload `playwright-report` and `e2e-gate-summary.json`
- [x] T029 [US3] Add `e2e-report` to `quality-gate.needs` in `.github/workflows/ci.yml` and to the required set in `tests/contract/release-gates.spec.ts`
- [x] T030 [US3] Prove the red verdict for a missing lane (done locally with real blob reports and by contract test, not on a throwaway CI commit)
- [x] T031 [US3] Open the Lot 3 pull request; record the merged report link, summary table and navigation count (SC-006) in `verification.md`
- [x] T032 [US3] Update "Delivery gate inventory" and "What blocks a merge" in `docs/development.md`

**Checkpoint**: 100 % of selected journeys accounted for in every run (SC-004).

## Phase 6: User Story 4 — Scope per event (P2) — Lot 4, branch `ci/058-scheduled-full-run`

- [x] T033 [P] [US4] Extend `tests/contract/test-impact.spec.ts`: event `schedule` yields the full corpus and full matrix
- [x] T034 [P] [US4] Extend `tests/contract/release-gates.spec.ts`: a `schedule` event cannot reach the publication job and has no `packages: write`
- [x] T035 [US4] Accept `schedule` in `scripts/ci/test-impact.ts`
- [x] T036 [US4] Add `on.schedule` (nightly 03:00 UTC), the concurrency group case and `--retries=1` for scheduled lanes in `.github/workflows/ci.yml`
- [x] T037 [US4] Document the event-scope policy (FR-012) and the deferred reduced-matrix option (R9) in `docs/development.md`

## Phase 7: User Story 5 — Degradation visible (P3) — Lot 4 (same pull request)

- [x] T038 [US5] Ensure `scripts/ci/e2e-gate-summary.ts` emits the ten slowest journeys and per-project failed-attempt seconds in the step summary; add the assertion to `tests/contract/e2e-gate-coverage.spec.ts`
- [x] T039 [US5] Upload `e2e-gate-summary.json` with 90-day retention in `.github/workflows/ci.yml`

## Phase 8: Polish — Lot 5, branch `ci/058-lane-setup-trim`

- [x] T040 [P] Install only the lane's engine (`playwright install --with-deps <engine>`) and add the engine to the cache key in `.github/workflows/ci.yml`; update the "CI cache boundaries" section of `docs/development.md`
- [x] T041 [P] (dropped: the measured before/after tables live in `verification.md`; a second copy under `docs/audits/` would drift)
- [x] T042 Record total runner-minutes against SC-005 in `verification.md` (install-step saving not measured separately)
- [x] T043 Converge by hand (SC-003 not measured on a real broken run; see `verification.md`) for `specs/058-e2e-gate-throughput`; confirm SC-001..SC-006 with evidence links in `verification.md`
- [ ] T044 Delete the superseded remote branch `origin/ci/parallel-webkit-shards` (static shard design, replaced by computed lanes) after Lot 2 is in `main` (maintainer confirmation required)

## Dependencies

- Phase 1 → Phase 2 → lots.
- Lot 1 (US1) and Lot 2 (US2) are independent; either may merge first.
- Lot 3 (US3) requires Lot 2 in `main`. T018 (US3) ships with Lot 2 because it edits the same runner.
- Lot 4 (US4, US5) requires Lot 3. Lot 5 requires Lot 3.
- Within a lot: contract tests first (red), then implementation, then evidence, then docs.

## MVP

Lot 1 alone (T001–T012): removes most failure cost with a three-line
configuration change plus the `test.slow()` audit. Lot 2 is the second
increment and delivers the green-run target.

## Requirement Traceability

| Requirement | Tasks |
| --- | --- |
| FR-001, FR-002 | T004, T006, T007, T009, T010 |
| FR-003 | T004, T006, T036 |
| FR-004 | T004, T006, T023, T025 |
| FR-005, FR-006, FR-007 | T013, T014, T015, T016, T017 |
| FR-008 | T005, T017, T018 |
| FR-009 | T023, T025, T028, T029, T030 |
| FR-010 | T027, T028, T031 |
| FR-011 | T025, T028 |
| FR-012 | T033, T035, T036, T037 |
| FR-013 | T004, T036 |
| FR-014 | T016, T018 |
| FR-015 | T020, T022 |
| FR-016 | T004, T005, T014, T023 |
| FR-017 | T011, T022, T032, T037, T040 |
| FR-018 | T038, T039 |
| SC-001 | T010 · SC-002 T021 · SC-003 T012, T021 · SC-004 T031 · SC-005 T021, T042 · SC-006 T031 |

## Phase 9: Additions decided during implementation (2026-11-13)

- [x] T045 [US2] Add a total lane budget (`e2eLanes.maxTotal`) to `scripts/ci/e2e-lanes.ts`: the measured account limit is 20 concurrent jobs, and lanes beyond the pool queued (last lane started 9–12 min late)
- [x] T046 [US1] Stabilise the intermittent journeys exposed by the runs: `tests/e2e/accessibility.spec.ts` (axe sampled during a view switch), `tests/e2e/editor-math-contents.spec.ts` (keys typed before the caret settled), `tests/e2e/database-relations-rollups.spec.ts` (unbounded steps inside a poll), `apps/web/tests/database-page-interaction.spec.tsx` (synchronous lookup of a panel still mounting)
- [x] T047 Record the final pull-request run (lane start offsets, wall clock, runner-minutes, verdict table) in `verification.md`
