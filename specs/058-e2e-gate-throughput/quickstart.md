# Quickstart: validating feature 058

Prerequisites: Docker running, `bun ci` done. See
[contracts/gate-rules.md](./contracts/gate-rules.md) for the verdict rules.

## 1. Plan and policy (no browser)

```bash
bun run --bun vitest run tests/contract/test-impact.spec.ts \
  tests/contract/e2e-project-runner.spec.ts \
  tests/contract/bun-production-artifacts.spec.ts \
  tests/contract/release-gates.spec.ts tests/contract/e2e-lanes.spec.ts \
  tests/contract/e2e-gate-coverage.spec.ts
bun run ci:test-impact --event push --ref refs/heads/main --head HEAD --output /tmp/plan.json
jq '.e2e.matrix | length' /tmp/plan.json   # computed lanes (20 without timings)
jq '[.e2e.lanes[] | select(.project=="firefox-desktop") | .testFiles[]] | length' /tmp/plan.json  # every journey file once
bun run ci:test-impact --event pull_request --ref refs/pull/1/merge \
  --base HEAD~1 --head HEAD --pr-number 1 --changed tests/e2e/authentication.spec.ts
# every project gets exactly one lane
```

## 2. Fast failure (SC-001)

Temporarily point one click of `tests/e2e/routing.spec.ts` at a role that does
not exist, then:

```bash
bun run test:e2e:local -- --project=chromium-desktop tests/e2e/routing.spec.ts
```

Expected: the journey fails in ≤ 20 s with an action timeout, one attempt only.
Revert the edit.

## 3. One lane locally (FR-015)

```bash
bun run ci:test-impact --event push --ref refs/heads/main --head HEAD --output /tmp/plan.json
bun run test:e2e:local -- --project=webkit-desktop --shard=1/1 \
  $(jq -r '.e2e.lanes[] | select(.id == "webkit-desktop-2-4") | .testFiles[]' /tmp/plan.json)
```

Expected: exactly that lane's files run, in one browser process.

## 4. No truncation locally (US3)

Run a WebKit project without `--shard` with a failing journey in the first
third: all three slices run, the command exits non-zero.

## 5. Pull-request proof (SC-002..SC-006)

Open the lot's pull request with a change that forces the full corpus. Expected:

- one `Playwright journeys (<project> i/n)` check per computed lane, none longer than 18 min;
- one `playwright-report` artifact for the run;
- the `e2e-report` job summary shows, per project, selected = passed + skipped;
- record first-job-start to last-lane-end in `verification.md`.

## 6. Guard proof (FR-009)

On a throwaway commit, delete one lane's blob upload step condition so the
artifact is missing: `e2e-report` and `quality-gate` are red with reason
"lane missing". Drop the commit.

## 7. Scheduled run

`gh workflow run CI --ref main` (manual diagnostic) shows the same full matrix;
the nightly trigger appears in the Actions schedule and publishes nothing.
