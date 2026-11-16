# Research: E2E Gate Throughput and Fast Failure

Evidence base: CI run 43266767307 (2026-11-12, PR #196), green runs
41836876945 and 2530bfd (2026-11-04), `docs/audits/2026-11-ci-speed.md` on
`origin/ci/parallel-webkit-shards`, Playwright documentation on sharding and
parallelism.

## R1 — Per-interaction bound

- **Decision**: `actionTimeout: 15_000`, `navigationTimeout: 30_000`, keep
  `expect.timeout: 10_000`.
- **Rationale**: Without `actionTimeout`, a click on a missing control waits for
  the whole test budget (observed 60/180/360 s). Passing journeys have a median
  of 3–5 s and a p90 under 15 s for the *whole test*, so 15 s per action is
  generous. Navigation includes cold preview load on WebKit, hence 30 s.
- **Alternatives**: Lower the test timeout (rejected: legitimate long journeys
  exist); 10 s action bound (rejected until measured; WebKit `newPage` stalls).

## R2 — Retries

- **Decision**: `retries: 0` in the pull-request and `main` gates; `--retries=1`
  only on the scheduled diagnostic run.
- **Rationale**: `--fail-on-flaky-tests` already fails a retry-only pass. In the
  measured run, retries account for half of all failed-attempt time
  (10–34 min per project) with zero effect on the verdict.
- **Alternatives**: Keep one retry for classification (rejected for the gate,
  kept nightly); drop fail-on-flaky (rejected by FR-013 and by the stranded
  outbox precedent recorded in `playwright.config.ts`).

## R3 — Lane sizing and distribution

- **Decision**: The impact planner computes lanes: count from estimated total
  duration ÷ a target lane duration, files assigned by deterministic
  longest-processing-time bin packing, explicit file list per lane. Weights
  come from measured per-file timings of the last `main`/scheduled run when
  available, else from a static count of declared tests × a default.
- **Rationale**: The maintainer asked for a solution that needs no edit when
  journeys are added (2026-11-13). A static `e2eShards` map (the design of
  `origin/ci/parallel-webkit-shards`) must be retuned by hand as the corpus
  grows. Published practice for low-maintenance sharding is exactly this: a
  planning job computes the matrix from the test inventory; duration balancing
  needs timing data, which the pipeline can feed back to itself. Playwright has
  no built-in duration-aware sharding, and its `--shard` splits by position, so
  explicit file lists give better balance and make the union/no-duplicate
  property checkable in the planner's own contract tests. The plan remains a
  pure function of its inputs (changed paths, policy, optional timings file),
  which is uploaded with the run.
- **Alternatives**: Static per-project counts (rejected: recurring manual
  tuning); Playwright `--shard=i/n` with a computed `n` (rejected: unbalanced,
  one 40 s file and one 4 min file weigh the same); a committed timings file
  (rejected: a file to refresh by hand); `fullyParallel` test-level split
  (rejected: breaks per-file order and serial blocks); third-party orchestration
  services (rejected: external dependency and data egress).

## R4 — Merged report

- **Decision**: `blob` reporter per lane, `playwright merge-reports
  --reporter html,json` in one `e2e-report` job.
- **Rationale**: Official Playwright pattern for sharded CI; blob names carry
  the shard, so artifacts do not collide; one HTML report meets SC-006.
- **Alternatives**: One HTML report per lane (today's model × 13, rejected);
  third-party dashboards (rejected: external service, user-data policy).

## R5 — Coverage guard

- **Decision**: A repository script compares the journeys expected for the
  selection (`playwright test --list --reporter=json`, per project) with the
  merged JSON results; `quality-gate` requires the job.
- **Rationale**: The existing gate only checks job conclusions; the WebKit
  truncation proved that a job conclusion says nothing about how many journeys
  ran. `--list` is the same resolver Playwright uses, so no second source of
  truth for "what should have run".
- **Alternatives**: Count from `ci/test-impact.json` only (rejected: it lists
  files, not tests); trust lane exit codes (rejected: today's failure mode).

## R6 — Concurrency budget

- **Decision**: Cap of 6 lanes per project (17–20 lanes today). Verify queueing on the first run and record it.
- **Rationale**: The free plan allows 20 concurrent Linux jobs. A run has about
  18 non-E2E jobs, most under 3 min, so lanes may queue briefly at start. The
  critical path is lane duration (~15 min), not queue time (~1–3 min).
- **Alternatives**: no cap (rejected: an estimate bug could request dozens of runners); larger paid runners
  (rejected: single-worker lanes do not use more cores).

## R7 — Browser provisioning

- **Decision**: Keep the cached `playwright install --with-deps`, but install
  only the lane's engine.
- **Rationale**: Install takes 43–126 s for three engines; one engine roughly
  halves it. System dependencies still install on every lane (existing policy).
- **Alternatives**: Official Playwright container image (rejected for now: adds
  a digest to pin and update in `docker/base-images.json` policy, and the
  PostgreSQL 18 client install would move inside it); prebuilt custom image
  (rejected: a registry artifact to maintain for ~1 min per lane).

## R8 — Workers inside a lane (deferred)

- **Decision**: Not in this feature.
- **Rationale**: Requires one database, API port, preview port, blob root and
  deployment key per worker keyed on `parallelIndex`, i.e. porting
  `scripts/e2e/run-local-matrix.ts` isolation into fixtures. `docs/development.md`
  also records that some journeys (keyboard focus) cannot share a machine with
  another browser. Lane-level isolation gives the same wall-clock gain at near
  zero design cost on free public runners.
- **Revisit when**: lane count needed for SC-002 exceeds the concurrency budget.

## R9 — Reduced pull-request matrix (deferred)

- **Decision**: Keep five projects on pull requests (FR-012).
- **Rationale**: Common industry tiering (dominant engine on every pull request,
  full matrix on trunk/nightly) would shorten runs further but changes the
  Principle III guarantee. With lanes, the target is met without it.
- **Revisit when**: nightly data shows cross-engine-only failures are rare and
  the maintainer wants sub-10-minute gates; requires constitution and canvas
  amendments in the same change.

## R10 — `test.slow()`

- **Decision**: Replace with explicit budgets; forbid by contract test.
- **Rationale**: `slow()` multiplies the *project* default, so the same marker
  means 180 s on Chromium and 360 s on WebKit; explicit numbers are reviewable.

## R11 — Other accelerators surveyed (2026-11-13)

- **Auth via stored state / API seeding instead of UI setup**: already in place
  (`tests/e2e/fixtures.ts` seeds owner and session directly; journeys seed
  through the API fixture). No further gain available cheaply.
- **Per-worker database cloned from a template**: the durable way to get
  several workers per runner; deferred with R8.
- **Blocking heavy resources / reusing a browser context across tests**:
  rejected — the app is served locally from a production bundle (no remote
  assets), and context reuse would break the per-test isolation the offline
  and sync journeys rely on.
- **Larger runners**: no effect on single-lane execution.
