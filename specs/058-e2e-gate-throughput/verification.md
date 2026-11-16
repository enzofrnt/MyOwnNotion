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

## Measured runs (2026-11-13)

| Run | Configuration | Browser jobs wall clock | Last lane start | Longest lane | Runner-minutes | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 43417465029 (`main`) | 5 jobs, one per project | 46 min | 0 | 46 min | 184 | green |
| 43497246937 (#201) | 20 lanes, concurrent with another run | 22.7 min | +12 min | 14 min | — | one flaky journey |
| 43510287732 (dispatch, alone) | 20 lanes | 19.1 min | +9 min | 13.3 min | 205 | one intermittent journey, one unit flake |
| 43513463573 (#201) | 15 lanes (`maxTotal`) | 18.4 min | +2.8 min | 16.4 min | 187 | lanes green |
| **43516042267 (#200, final)** | 15 lanes, merged report, guard, engine-only install | **18.1 min** | +3.9 min | 15.9 min | 192 | **green on the first attempt** |

Run 43510287732 established the account limit: never more than 20 jobs at
once. Thirteen other jobs of the workflow start with the lanes, so about seven
lanes start immediately and the rest as slots free up.

### Final run 43516042267

- Whole workflow: 19.0 min from first job start to `quality-gate` (46+ min before).
- `Browser gate report`: verdict pass; per project 77 files and 344 journeys
  accounted for, 0 failed, 0 flaky, 0 not run (passed/skipped: chromium-desktop
  331/13, firefox-desktop 317/27, webkit-desktop 317/27, chromium-mobile
  319/25, webkit-mobile 312/32 — identical to green `main` run 43417465029).
- One merged `playwright-report` artifact; `e2e-timings.json` holds measured
  durations for 75 files per project.
- Lane journey time, measured against a uniform 763–770 s static estimate:
  Chromium lanes 408–621 s, Firefox 680–775 s, WebKit 615–853 s. Replanning
  the complete corpus with these timings gives 15 lanes of 530–758 s
  (chromium-desktop 3, firefox-desktop 3, webkit-desktop 3, chromium-mobile 2,
  webkit-mobile 4), against 408–853 s measured now. This is what `main` uses
  after its first complete run; the effect on wall clock is a projection.
- Small jobs (`Biome format & lint`, `Strict TypeScript`) still started about
  9 min after the run began: the 20-job limit is saturated at start.

### Success criteria

| Criterion | Result |
| --- | --- |
| SC-001 failure ≤ 20 s for an unreachable control | Met by configuration (15 s action bound; observed `click: Timeout 15000ms exceeded` in run 43497237616) |
| SC-002 green full corpus ≤ 20 min | Met: 18.1 min browser jobs, 19.0 min whole workflow |
| SC-003 run with ten broken journeys ≤ 25 min | Not measured on a real broken run; bounded by the 15 s action limit, no retry and the ten-failure cap |
| SC-004 every selected journey accounted for | Met: guard verdict pass with 0 not run; missing-lane and unattempted-journey cases covered by contract tests and one local run |
| SC-005 runner-minutes ≤ +50 % | Met: 192 vs 184 (+4 %) |
| SC-006 one merged report | Met: single `playwright-report` artifact |

### Stabilised tests (T046)

Each browser journey passed 8 of 8 local repetitions after the change
(`--repeat-each=8`): `editor-math-contents` and `accessibility` (axe, five
views) on firefox-desktop, `database-relations-rollups` (empty source) on
webkit-mobile. The web unit test passes; it was not repeated under load.

### Second complete run 43519009785 (documentation commit)

Browser jobs 17.9 min. Red: `page-protocol-migration.spec.ts:181` failed on
webkit-desktop and webkit-mobile with a page error
`…/v1/changes?after=0&limit=200 due to access control checks.` — WebKit's
diagnostic for a request aborted by the journey's own `setOffline(true)`,
which the application already handles as "offline". The journey now ignores
that one engine diagnostic (6 of 6 local repetitions on webkit-desktop; the
race is rare, so the repetitions do not prove its absence). The
`Browser gate report` job failed with the lanes, which is the first real CI
exercise of the guard on a failing run.

### Later complete runs

| Run | Browser jobs | Result | Cause |
| --- | ---: | --- | --- |
| 43521962935 | 19.9 min | red | web unit test `database-page-interaction.spec.tsx` (browser lanes and gate report green); the option is now clicked in the tick that finds it |
| 43524911626 | 19.8 min | red, green after rerun of two lanes | `database-relations-rollups` "isolate a second source" (webkit-desktop) and `realtime-sync-security-and-restore.spec.ts:68` (chromium-desktop) |
| 43573131882 | 19.2 min | **green on the first attempt** | after the three stabilisations below |

Stabilisations made from the failure traces of run 43524911626 and a local run:

- `waitForEntryAutosave` (33 call sites) waited for the transient `saved`
  mark, which the autosave hook resets to `idle` when the entry panel is
  remounted. The same journey failed the same way in run 43470032368, an
  unrelated pull request on `main`'s code. The helper accepts `saved` or an
  `idle` that outlasted the draft debounce. Local evidence: the 39 journeys
  that use it pass on webkit-desktop and chromium-desktop; the failing journey
  passes 6 of 6 repetitions on webkit-desktop.
- Device revocation: the second device now waits for the first device's page
  before creating its own (6 of 6 repetitions on chromium-desktop).
- `databases-views`: the settings sheet is measured only once it has a box on
  screen after a resize (failed 1 of 5 locally before, 8 of 8 after).

Two application behaviours were observed and not investigated: a "new page"
click can be swallowed while live sync re-renders the tree, and keys typed
right after applying an inline equation can be lost on Firefox.

Overall on this pull request: six complete runs, browser jobs 17.9–19.9 min;
two green on the first attempt, one green after rerun, three red — each red on
a different rare intermittent test, seven of which are now stabilised.

### Final complete run with the application fixes (43583883186)

Green on the first attempt. 15 lanes, browser jobs 19.1 min wall clock, 184
runner-minutes, whole workflow 20.3 min. `Browser gate report`: verdict pass,
346 journeys accounted for on each project (the two new regression journeys
included), 0 failed, 0 flaky, 0 not run. Pull request `mergeable`, state
`clean`.

### Not exercised yet

- The timings cache save/restore: it only runs on `main`.
- The nightly schedule.
- The per-engine install saving was not measured separately (T042).

## Application defects found while stabilising the gate

Two defects were reported as test flakiness and are fixed in the application,
not worked around in the tests.

### The creation menu swallowed a click made while it opened

`navigation-inline-create` animated width, padding and transform for 200 ms
inside an `overflow: hidden` container, so for that window the choice buttons
were clipped into a surface that ignored the pointer. A click made right after
opening the menu created nothing and left the menu open. The opening is now
paint-only (opacity, colour, icon slide); the hit areas are final from the
first frame. Closing keeps its geometric transition, and the cluster still
ignores the pointer while it closes.

Evidence: `tests/e2e/hierarchy.spec.ts` "a creation choice answers a click from
the first frame its menu is open" uses raw pointer input at the rest positions,
with no waiting. Before the fix it failed 3 times out of 3 (no page created,
title never focused); after the fix it passes 3/3 on Chromium, 1/1 on Firefox
and 8/8 in an earlier run, and the geometry journey still passes.

### Keys typed right after applying an inline equation could be dropped

`updateInlineContent` replaces the ProseMirror node with `replaceWith`, which
destroys the node view holding the caret and mounts a new one. When that
leaves the document selection on a removed node, the browser keeps the editor
focused but discards every keystroke until something moves the caret. The
inline equation node view now repairs only a dead selection (no range, or an
anchor no longer in the document) and only while the editor holds focus; a
live caret is never moved, so an owner's own click still decides where they
continue writing.

Evidence: `tests/e2e/editor-math-contents.spec.ts` "keeps typing in the
document right after applying an inline equation" applies three times and
types straight away with no click and no waiting; it passes on Firefox,
Chromium and WebKit. The defect itself was reproduced once, in CI on Firefox
(run 43497237616), and never locally in about 60 apply/type cycles across
several delay sweeps, so the repair is defensive and the journey is a contract
test rather than a deterministic reproducer.
