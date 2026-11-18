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
- No force-push has been made during reconciliation. The complete post-rebase
  gate was run on executable commit `e0d03df6` with PG18 client tools and
  sequential browser projects (`MYOWNNOTION_E2E_JOBS=1`). Toolchain, shell,
  formatting, lint, monorepo types, coverage, performance, database integration,
  migration and contract stages have completed successfully. Exact totals:
  coverage 573 passed files / 5,826 passed tests (2 skipped); database integration
  42 files / 407 tests; migration suite 12 tests; API/workspace contracts
  165 files / 1,935 tests. Performance ran its nine isolated cases successfully.
  The initial sequential Chromium desktop result was red: 337 passed, 2 failed, 13 skipped.
  `editor-math-contents.spec.ts:82` expected the typed `/latex` but the paragraph
  was empty; `workspace-tabs-folder.spec.ts:264` did not observe the expected DnD
  live-region state. Read-only trace investigation found both specs and their
  editor/folder implementations byte-identical to main. The DnD live region
  targets the dragged item itself, never the expected second item; main's wait
  contracts already document this measurement-readiness gap (CI 43706222653).
  For math, the editor stays focused but the text never reaches the target empty
  paragraph after applying an inline equation; the precise selection/input cause
  remains unknown. These are not classified as infrastructure or dismissed
  because a rerun might pass.
- Controlled baseline comparison: a fresh detached checkout of main `a27f700d`
  with its own dependencies, database, ports 6301/6473 and temporary web artifact
  ran the math, canonical-entry visual, and folder-tab specs. Result: 5 passed,
  2 failed, reproducing both the math `/latex` loss and folder DnD assertion on
  pristine main (68 s). This positively establishes that those two signatures
  predate this batch; it does not repair them. The canonical-entry visual
  failure did not reproduce on main desktop in that comparison; the separate
  main-mobile comparison below subsequently reproduced it.
- The sequential matrix was explicitly cancelled at the owner's request to run
  browser suites in parallel. Its logs are retained separately. A fresh matrix
  uses two concurrent projects, each with its own database, ports and storage.
  It does not retroactively erase the two failures recorded above.
  Final parallel result: Firefox desktop, WebKit desktop and WebKit mobile pass;
  Chromium desktop has 337 passed / 2 failed / 13 skipped (math again, plus the
  canonical-entry visual journey). Chromium mobile reports 293 passed / 34
  failed / 25 skipped, but its late portion is contaminated: an independently
  launched desktop build replaced the same web distribution while it was being
  served. Many late tests read `null` rather than the E2E synchronization state.
  This is an orchestration error, not proof of a product defect. Revalidation
  uses a distinct `myownnotion-e2e-web-reconciled-*` output/serve directory under
  the system temporary root (the build validates this prefix);
  no other build may replace that artifact while the browser run is active.
- Independent supplemental checks: web and desktop builds and desktop packaging
  pass. Installed macOS arm64 smoke passes after removing the host harness's
  `ELECTRON_RUN_AS_NODE=1` for that invocation (the first launch treated Electron
  as Node and rejected its browser flags). No product workaround was added.
- Dependency audit (386 packages), secret scan (2,489 files), static security
  (1,481 source files), production license policy (391 packages), and Compose
  contract pass with no high-severity/secret/static/license findings. The audit
  reports 16 dependency findings below its configured high-severity threshold.
- Image build gate passes for both images on linux/amd64 and linux/arm64,
  including packaged API runtime smoke and full backup/restore rehearsal and
  activation. The complete browser gate remains red as detailed below; no
  complete-gate success is claimed.
- Earlier claims that the complete gate had passed were too broad: the recorded
  run stopped at the browser stage; later build/image/security stages were not
  proven by that run. Do not reuse that claim for this PR.


## Final browser result and reconciliation verdict

The isolated Chromium mobile rerun (no concurrent artifact replacement) completed:
324 passed, 3 failed, 25 skipped. Its failures are math, folder keyboard DnD, and
the canonical-entry board/gallery/calendar journey. The third signature is also
reproduced on a pristine-main mobile checkout: `databases-visual-views.spec.ts:149`
never finds the moved Beta card in Done (1 passed, 1 failed, 32 s).

Thus all three distinct remaining browser failure signatures are reproduced on
unmodified main. They remain real unresolved problems, not infrastructure labels
or "fixed by a green rerun". No assertions, retries, or skips were changed to hide
them. Evidence is retained in [evidence/reconciliation/](evidence/reconciliation/):
main comparison logs and post-rebase browser logs.

**Reconciliation is complete at source and SpecKit level**: main is an ancestor,
its intersecting changes have been audited, no lost main change was identified,
and SpecKit prefixes are unique. Validation is complete with an explicit red
browser result inherited from main, not a complete gate pass. This is not an
unconditional merge/publication recommendation. The branch has not been
force-pushed; PR #213 still points at its pre-rebase history. Fix or explicitly
decide the disposition of the inherited failures before publication.

The untracked boot-refusal audit and the 063 worktree are preserved separately;
they are not silently committed into the reconciliation.
