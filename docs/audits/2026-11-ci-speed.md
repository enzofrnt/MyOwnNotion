# CI speed — parallel WebKit shards (Phase 1)

Measured on the green remediation run `2530bfd` (2026-11-04). The wall-clock
bottleneck is the browser matrix, not unit, contract, desktop or image jobs:

| E2E job | Duration | Behaviour before this change |
| --- | ---: | --- |
| `webkit-desktop` | **41 min** | 3 shards run **sequentially** in one job |
| `webkit-mobile` | 34 min | 3 shards run sequentially in one job |
| `firefox-desktop` | 27 min | one job |
| `chromium-desktop` | 23 min | one job |
| `chromium-mobile` | 20 min | one job |

The other long jobs (API/contracts 9 min, unit/coverage 8 min) run in parallel
and are not the wall-clock critical path today.

## What changed

- `ci/test-impact.json` gains `e2eShards`, currently only
  `webkit-desktop: 3` and `webkit-mobile: 3`.
- The impact plan expands each configured project into matrix entries
  `{ project, shard: "1/3" }`, `{ project, shard: "2/3" }`, `{ project, shard:
  "3/3" }`. Other projects emit `{ project, shard: "1/1" }`.
- The shard count is capped by the number of **selected journey files**, so a
  narrow PR (one selected journey) schedules one shard, never an empty one.
- `scripts/e2e/run-container-project.sh` already accepted an explicit
  `--shard` and disabled its internal WebKit recycling. CI now passes
  `--shard="$PLAYWRIGHT_SHARD"` to that runner.
- Each shard is a full isolated stack: its own PostgreSQL, API server, web
  build and fresh WebKit process. The existing sequential recycling remains
  unchanged for local Linux runs without an explicit shard.
- Reports are uploaded as `playwright-report-<project>-<shard>`.

This is deliberately **not** the discarded auto-sharder: there is no
file-count/`journeysPerShard` heuristic and no cap derived at runtime. The
mapping is static, reviewable, and limited to the two engines that provably
need process recycling.

## Expected effect

| Job | Before | After (estimate) |
| --- | ---: | ---: |
| `webkit-desktop` | 41 min | ~14–16 min |
| `webkit-mobile` | 34 min | ~11–13 min |
| `firefox-desktop` | 27 min | 27 min |
| Wall clock | ~41–43 min | **~27–29 min** |

Phase 2 (static shards for Firefox/Chromium by measured duration, blob reports
and a merge job) can bring the wall clock to roughly 15–18 min. Phase 3
(critical-journey tier on PRs, full suite on main/nightly) targets under
12 min. Neither is included here.

## Why not more Playwright workers?

`workers: 1` and `fullyParallel: false` are intentional: every journey begins
with a global `TRUNCATE` of canonical content, so two workers would reset each
other's data. Separate shard jobs are the isolation boundary that makes safe
parallelism possible without reworking the fixture into per-worker databases
and servers.

## Validation

- `tests/contract/test-impact.spec.ts` — 47 tests, including shard expansion,
  narrow-selection capping and invalid shard counts.
- `tests/contract/e2e-project-runner.spec.ts` — 11 tests, including the explicit
  shard pass-through and the CI wiring.
- Generated plan for a full trigger:
  `webkit-desktop 1/3, 2/3, 3/3`; `webkit-mobile 1/3, 2/3, 3/3`; the other
  projects at `1/1`.
- Generated plan for a one-journey selection:
  `tests/e2e/authentication.spec.ts` → every project at `1/1`.

The PR's own CI run exercises the new 9-job matrix end to end.
