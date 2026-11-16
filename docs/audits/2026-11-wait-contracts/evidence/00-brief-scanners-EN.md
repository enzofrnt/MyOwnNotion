# Audit brief — wait contracts (shared context for scanners)

Read-only audit. Do NOT modify application code, tests, workflows, or push anything.
Only write your own output file inside `docs/audits/059-wait-contracts-2026-11-15/`.

## Reference code

Read the test suite from the worktree `/Users/enzofournet/Git/MyOwnNotion-059` (read-only for you).
Its checked-out commit `f73b449c` has git tree `5f71be02`, which is byte-identical to the tree of
`origin/main` merge commit `0679cdeb` (PR #202). Do not run git commands that write there, do not
run test suites, do not `git checkout`/`stash`/`add`. Only read files and grep.

## The defect class under audit

A test performs an action that starts an asynchronous operation, then proceeds after observing a
*proxy* of completion instead of proof that the operation it depends on actually finished. Examples:

- asserting a visible/textual state (React state, DOM, focus, toast, optimistic list) and then
  reloading / closing the page / going offline / navigating / revoking a device — while the write to
  IndexedDB or the acknowledgment from the API may still be in flight;
- waiting for a *global* signal (`data-save-state="saved"`, an idle queue, `waitForSynchronized`)
  that is not correlated with the *specific* operation or revision the next step depends on, or that
  was already true before the action (missed event / stale pass);
- treating a network response, a click that closed a menu, an animation end, a screenshot diff, or a
  `waitForTimeout` as proof of durability or application;
- synchronization waits that do not identify which change they are waiting for, so an earlier
  already-synced state satisfies them.

The proven reference case: `tests/e2e/page-multi-device-convergence.spec.ts` (test at line 344)
clicks a navigation row, asserts `active-item-title`, then calls `page.close()` ~20–50 ms later.
The "last visited item" write to IndexedDB had not committed; the restarted device restored the
previous page and the assertion failed. Green on the PR, red post-merge, green on rerun.

## What to report per finding

For every suspicious site, give:

1. `file:line` (line of the statement that proceeds, not the test header) and the test name.
2. Verbatim ≤2-line snippet of the code at that point.
3. The operation that is still in flight (name the writer/transaction/request).
4. The signal the test currently waits on, and why it is not proof of that operation.
5. The real precondition the next step needs.
6. An existing real signal that could prove it (DOM attribute, IndexedDB read, API read, fixture
   hook), or "none — must be exposed by <producer>".
7. Severity: `P1` (can lose data or make a wrong result pass), `P2` (can produce a false red),
   `P3` (style/maintainability).
8. Confidence: `observed-in-CI` (cite the run id if you have one), `static-only`, or `suspect`.

Be precise and conservative: if a wait genuinely proves the operation (for example a poll on the
durable queue snapshot, or a read-back of the persisted value from IndexedDB), say so and list it as
`OK` rather than inventing a problem. Never speculate about line numbers: re-read the file.

## Known-good signals already in the repo (reuse, do not reinvent)

- `window.__MYOWNNOTION_E2E_LOCAL_CONTENT__()` → `getSnapshot().syncState` (durable queue state).
- `[data-testid="block-editor"]` attributes `data-editor-settled`, `data-editor-change-sequence`,
  `data-editor-apply-count`, `data-editor-apply-failures`.
- `[data-testid="editor-sync-status"]` attributes `data-sync`, `data-durable`.
- `.entry-properties__status[data-save-state]`, `.database-page[data-definition-state]`.
- `tests/e2e/helpers.ts` exported helpers (read them first).
