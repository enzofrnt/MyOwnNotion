# Verification: E2E Gate Throughput and Fast Failure

Evidence for [tasks.md](./tasks.md). Durations are wall clock unless stated.

## Method

- **Wall clock of the browser gate**: start of the first `Playwright journeys`
  job to completion of the last one, from `gh run view <id> --json jobs`.
- **Runner-minutes**: sum of the durations of every `Playwright journeys` job.
- **Journey time / failed-attempt time**: sum of the durations printed by the
  list reporter, split by ✓ and ✘ lines.

## Baselines

### Failing pull-request run 43266767307 (2026-11-12, PR #196, before)

| Project | Journey step | Failed attempts | Passing journeys (median) |
| --- | --- | --- | --- |
| webkit-mobile | 79 min | 68 min | 97 (4.4 s) — 1 of 3 slices executed |
| chromium-mobile | 60 min | 39 min | 305 (2.9 s) |
| firefox-desktop | 57 min | 17 min | 311 (5.4 s) |
| chromium-desktop | 41 min | 12 min | 320 (3.9 s) |
| webkit-desktop | 18 min | 6 min | 104 (4.0 s) — 1 of 3 slices executed |

### Green `main` run 43417465029 (2026-11-13, before)

| Project | Job | Journey time | Executed | s/journey |
| --- | --- | --- | --- | --- |
| firefox-desktop | 46 min | 43.1 min | 317 | 8.2 |
| webkit-mobile | 39 min | 37.1 min | 312 | 7.1 |
| webkit-desktop | 37 min | 34.4 min | 317 | 6.5 |
| chromium-mobile | 33 min | 31.0 min | 319 | 5.8 |
| chromium-desktop | 29 min | 26.6 min | 331 | 4.8 |

Wall clock 46 min; runner-minutes 184.

### Explicit budgets (T003)

Slowest passing journey that carried `test.slow()`: `databases-views.spec.ts:22`,
49 s on firefox-desktop. Slowest journey overall:
`progressive-startup.spec.ts:234`, 78 s on firefox-desktop (explicit
`test.setTimeout`). All 13 `test.slow()` sites became `test.setTimeout(150_000)`;
`linked-databases.spec.ts:123` (45 s measured, was 300 s) and
`legacy-sync-self-healing.spec.ts:23` (< 18 s measured, was 210 s) were lowered
to the 180 s cap.

## Lot 1 — fast failure

### Local complete matrix (2026-11-13, `bun run test:e2e:gate`, macOS host, 2 projects at a time, 4,012 s)

| Project | Passed | Failed | Skipped | Journey time | Cause of failures |
| --- | ---: | ---: | ---: | --- | --- |
| chromium-desktop (host) | 323 | 8 | 13 | 19.4 min | 6 visual baselines are Linux renders compared on macOS; 2 backup journeys need `pg_dump` 18, absent on this host |
| chromium-mobile (host) | 316 | 3 | 25 | 19.3 min | 1 Linux visual baseline; the same 2 `pg_dump` journeys |
| firefox-desktop (container) | 316 | 1 | 27 | 24.0 min | `accessibility.spec.ts:408`, axe "No elements found for include" |
| webkit-desktop (container) | all | 0 | — | — | — |
| webkit-mobile (container) | all | 0 | — | — | — |

No failure is an action, navigation or journey timeout: the 15 s / 30 s bounds
and the explicit 150 s / 180 s budgets broke no journey on any engine, so no
per-call `{ timeout }` override was needed (T009).

The host-only failures are environmental (macOS Chromium against Linux
snapshots, no PostgreSQL 18 client) and do not occur on the Linux CI runner.
The Firefox accessibility failure is not a timeout; the same file then passed
on two consecutive targeted container reruns
(`bun run test:e2e:local -- --project=firefox-desktop tests/e2e/accessibility.spec.ts`),
so it is recorded as a pre-existing intermittent race in that journey, to be
confirmed by the pull-request run.

Static evidence: `tests/contract/e2e-gate-coverage.spec.ts` and
`tests/contract/bun-production-artifacts.spec.ts` pass; Biome clean on the
changed files.

_SC-001 measurement and pull-request durations: filled from the pull-request run._

## Lot 2 — self-sizing lanes

Plan for the complete corpus without timings: 4 lanes per project, 20 lanes,
574 estimated seconds each. With the timings of run 43417465029: 3 + 4 + 4 + 3
+ 4 = 18 lanes, 543–676 estimated seconds each (9–11 min of journeys).
A one-journey pull request: one lane per project.

_Lane durations, queue delay and runner-minutes: filled from the pull-request run._
