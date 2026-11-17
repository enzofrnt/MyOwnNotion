# Reconciliation with main — 2026-11-17

## Sources and priority

- Canonical main: `a27f700dfe538aae4827fbd2784dbd020abdefa4`.
- Original batch: `0cb56e2b`, based on `b0aa58a4`.
- Rebased batch before reconciliation: `9070d1ce`.
- `main` is authoritative for previously delivered changes; the account, auth,
  settings and live-graph additions must remain, without undoing those changes.
- Boot-diagnosis work is isolated in the `fix-workspace-boot-diagnosis` worktree;
  it is not silently included in this batch.

## Audit

The rebased branch contains main as an ancestor (0 commits behind, 1 ahead).
Fourteen paths were independently changed by both main and the original batch.
A read-only review of their executable diffs found no concrete lost main change:
main's state-based waits remain, while the account fixtures and workspace scope
are adapted. This is source review, not proof that integration tests pass.

- Constitution: keep main's verifiable-test-evidence rule and its 4.1.0 report,
  followed by the explicit 5.0.0 multi-account amendment.
- Export contract: keep main's `vi.waitFor` on export state; use the account-scoped
  `harness.context.db` from the multi-user harness.
- Page-operation integration: keep both `eq` (account fixture) and `sql` (main's
  lock/state witness).
- Graph-label fix from main: painting source and its unit test remain identical
  to main. Main's wait helpers, animation witnesses and graph journeys also remain.
- Main did not change API source, database schema or migrations between the old
  base and its current tip. The baseline reset is an explicit multi-user decision,
  not a conflict resolution that removed a main migration.

## Spec Kit identity

Main already owns numbers 058, 061 and 062. Preserve its feature directories and
renumber only this batch's colliding additions:

| Original batch directory | Canonical reconciled directory |
| --- | --- |
| `058-multi-user-accounts` | `064-multi-user-accounts` |
| `061-settings-visual-refresh` | `065-settings-visual-refresh` |
| `062-knowledge-graph-live` | `066-knowledge-graph-live` |

Feature 059 stays unchanged. Number 063 is reserved by the separate boot-diagnosis
work. The Git branch remains `058-multi-user-accounts` to preserve PR #213.
Update maintained path references, but do not rewrite immutable historical logs,
old test names, environment-variable names or commit messages as if the old
identities had never existed.

## Validation status

- Monorepo typecheck passed after installing the frozen lockfile from main.
- The pre-rebase gate is historical evidence only, not validation of this tree.
- Reconciled tree: format and monorepo typecheck pass; web + graph + workspace
  contracts: 220 files, 1,584 tests pass. Graph-live and MCP journeys pass on
  Chromium desktop and mobile (6 tests per project). The two code-conflict
  suites (export API contract and database page operations) pass: 15 tests.
- Main's contracts exposed three graph-test violations (`test.slow` and fixed
  delays), plus a 30 ms MCP modal sleep. Removed them: graph filtering now waits
  for the canvas's applied-layout revision (captured before the action), with
  reduced motion for deterministic geometry; modal tests await the hidden state
  while allowing React commits. No assertion is weakened and no retry is added.
- No force-push has been made during reconciliation. Full post-rebase gate and
  Firefox/WebKit validation remain necessary before publication; these bounded
  checks are not presented as a complete security/runtime certification.
- Earlier claims that the complete gate had passed were too broad: the recorded
  run stopped at the browser stage; later build/image/security stages were not
  proven by that run. Do not reuse that claim for this PR.
