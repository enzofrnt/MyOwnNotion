# Contract: E2E gate verdict

`e2e-report` computes the verdict; `quality-gate` requires `e2e` and
`e2e-report` to be `success`.

The verdict is `fail` when any of the following holds:

1. A lane listed in `test-impact.json` `e2e.matrix` has no blob report.
2. Any journey result is `failed`, `timedOut`, `interrupted` or `flaky`.
3. A present lane reported no test for one of its journey files, or a declared
   journey has no attempt in the merged report (for example after a lane
   stopped on `maxFailures`).
4. A journey file appears in more than one lane of the same project, or the
   lanes of a project omit a selected file.
5. The merged report cannot be produced.

The verdict is `pass` with mode `none` when the plan selected no journey and the
single no-op lane succeeded.

A skipped journey counts as accounted for only when the report carries it as
`skipped` (engine-specific `test.skip`), never when it is absent.

Timing rules (asserted against `playwright.config.ts` by contract test):

- `use.actionTimeout` ≤ 15 000 ms and `use.navigationTimeout` ≤ 30 000 ms.
- `retries` is 0 in configuration.
- `--fail-on-flaky-tests` is present on every gate invocation.
- `tests/e2e` contains no `test.slow(` call.
- The `e2e` job declares `timeout-minutes` ≤ 30 and `fail-fast: false`.
- Exactly one step saves the timings cache, restricted to complete runs on `main`.
