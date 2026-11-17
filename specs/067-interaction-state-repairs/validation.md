# Validation — interaction state repairs (067)

Executable commit: see `git log` for the commit carrying this file. Branch
`058-multi-user-accounts` (PR #213). All runs used an immutable web artifact in a
dedicated `myownnotion-e2e-web-*` temporary directory, its own database, ports and
blob/backup roots. No build ran concurrently with a browser run.

## What was proven, and how

### 1. Inline equation: typing after applying (editor-math-contents)

Diagnosis first, with a temporary probe (removed) that read, at each step,
`document.activeElement`, `window.getSelection()` and the block owning the caret:

| Step | Caret block |
| --- | --- |
| after apply | the equation's paragraph (focus already back in the editor) |
| after clicking the blank paragraph | the blank paragraph |
| after typing | **the equation paragraph again** |

So the caret was stolen *after* the click. The thief was the legacy
frame-deferred "dead selection repair": it ran on every render of the node view
and treated the transient moment between the click and ProseMirror's own
selection write (`rangeCount === 0`) as a dead caret, moving the caret to the
equation's block.

A second measurement established the honest witness: the blank block only gets
`data-is-empty-and-focused="true"` two frames after the click — the editor's own
marker that it adopted the pointer selection. Typing before that lands in the
previous paragraph.

Repairs:

1. `equation-inline-content.tsx` updates the expression **in place**
   (`setNodeMarkup`, validated `getPos`/node type) instead of replacing the atom,
   and returns focus to the editor with the caret immediately after the atom.
2. The frame-deferred repair was removed: the probe showed it moved a caret the
   owner had placed.
3. `EquationEditor` gains an optional `onApplied` callback, invoked after
   `close()` (which focuses the preview button inside a `contenteditable=false`
   boundary), so the inline owner can put the caret back in the document.
   Cancelling keeps the existing preview-focus behaviour.
4. The journey waits for the editor's own caret marker before typing. The
   `/latex` assertion itself is unchanged.

### 2. Folder keyboard drag (workspace-tabs-folder)

The defect was reproduced deterministically, without a browser, by driving the
installed `KeyboardSensor` with the activation timer held: the first direction
after lift was never read (getter calls 0, no replay), and only a *second*
direction worked. `@dnd-kit/core` 6.3.1 attaches its document keydown listener in
an untracked `setTimeout` after `handleStart`, so a fast next key falls into that
gap.

Repair: an application-level sensor, `apps/web/src/features/workspace/ready-keyboard-sensor.ts`
(subclass of the library's `KeyboardSensor`), registers the document keydown
listener synchronously and keeps two guards: it ignores the activation event by
identity (the lifting Space is still bubbling and would otherwise drop the item)
and it handles each event at most once (the library's deferred registration still
adds the same handler a moment later). A maintained dependency patch was written
first and **rejected**: the repository's toolchain contract forbids
`patchedDependencies` in the lockfile (`tests/contract/bun-toolchain.spec.ts`), so
no patch file, lockfile entry or Dockerfile change remains.

Evidence of the red/green pair: `apps/web/tests/keyboard-sensor-readiness.spec.ts`
fails before the patch ("the keyboard sensor must accept the first direction
after lift: expected 1 call, got 0") and passes after it, while also proving the
lifting Space does not drop, that Space later drops exactly once, that Escape
cancels, and that further arrows after the end move nothing.

### 3. Kanban keyboard move (databases-visual-views)

Diagnosis with temporary instrumentation (removed) on the destination menu item
and on the move callback:

- pointer path: `onClick` ran with `event.detail === 1`, then the move ran;
- **keyboard path: `onClick` never ran** for the destination item.

Opening "Déplacer dans un groupe" by keyboard replaces the focused menu item, so
the destination list appeared without owning focus; Enter activated nothing. A
keyboard user could not move a card at all.

Repair: the first selectable destination receives `autoFocus` when the step
opens, and the focus return to the card is deferred to the next frame for
keyboard activation so the same Enter cannot land on the trigger that just
received focus. After the repair the same instrumentation shows `detail === 0`
and the move running, and the journey passes.

## Checks run

| Check | Result |
| --- | --- |
| `bun run format:check` | pass |
| `bun run lint:ci` | pass (220 warnings, 0 errors) |
| `bun run typecheck` (monorepo) | pass |
| `bun run --bun vitest run --project web --project workspace-contract` | 212 files / 1,554 tests pass, including the sensor readiness proof and the wait-contract/impact contracts |
| chromium-desktop: math, board/gallery/calendar, folder keyboard | 7 tests pass |
| chromium-mobile, firefox-desktop, webkit-desktop, webkit-mobile: same three journeys, isolated artifact | 4/4 projects pass (196 s) |
| `bun run images:build` (unchanged Dockerfiles) | pass, 2 images amd64/arm64, packaged API and backup/restore rehearsal |
| `bun run compose:check` | pass |

## Limits

- The inherited math failure had two separable causes (atom replacement, caret
  thief). The probe established the caret thief; the in-place update is kept
  because replacement demonstrably re-maps the selection, but the batch does not
  claim to have isolated its individual contribution.
- The folder and board journeys are the same journeys that failed on pristine
  main; their assertions are unchanged. Only the preconditions (focus, caret
  marker, sensor listener) changed.
- The four-engine run covers these three journeys, not the whole matrix. The
  complete gate was not re-run for this repair batch; earlier reconciliation
  evidence covers the rest of the tree.
- Firefox and WebKit ran in the pinned Linux image, as the local matrix requires.

## CI follow-up (run 44178086203, commit 0f5f14b0)

The first CI run after the repairs was red. Diagnosed per job:

| Failure | Attribution | Action |
| --- | --- | --- |
| `database-multi-select-board.spec.ts:42` on chromium-desktop, chromium-mobile, Firefox and WebKit: `toBeFocused()` on the moved card | **introduced by the board repair**: deferring focus to the next frame removed the origin that `move()` reads from `document.activeElement`, so focus was never restored to the card in its new column | `move()` now takes the origin explicitly and the destination passes its card trigger; verified locally (multi-select board + visual views: 5 tests pass) |
| `v1-surface-visuals` dark mobile security surface (chromium-mobile, linux) | stale linux baseline from the 061 settings work: an earlier copy had taken the file from a run where the mobile test was skipped | regenerated inside the pinned Linux runtime from a run where the test actually executes; the file now differs from the committed baseline |
| `full-backup.integration` (2 timeouts, `57P01` admin shutdown) | not reproduced: 20/20 pass locally with the PG18 client | recorded as CI-environment evidence |
| `realtime-sync-security-and-restore.spec.ts:138` (`backup run` command failed) | not reproduced: 3/3 pass locally | recorded as CI-environment evidence |
| `desktop-offline-restart.spec.ts:80` on every desktop platform: workspace content never appears | pre-existing boot-refusal signature (the separate 063 handoff documents it on main); the pre-repair run 44171452099 already failed desktop jobs the same way | outside this batch; tracked by the 063 worktree |

Assertions were not weakened; the board journey keeps its focus contract and now passes.
