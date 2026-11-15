# Scan — sync / devices / offline journeys (wait contracts)

Read-only audit of the 20 in-scope specs in worktree
`/Users/enzofournet/Git/MyOwnNotion-059` at `f73b449c` (tree `5f71be02`), plus
`tests/e2e/helpers.ts`, `fixtures.ts`, `global-setup.ts`, `canonical-storage.ts`
and the production code each wait depends on (read only, never modified).

Files scanned: `page-multi-device-convergence`, `page-multi-tab-convergence`,
`realtime-page-sync`, `live-sync`, `conflict-resolution`,
`offline-reconciliation`, `offline-availability`, `page-autosave-recovery`,
`save-state`, `databases-offline-sync`, `legacy-sync-self-healing`,
`interrupted-mutations`, `page-protocol-migration`, `protocol-compatibility`,
`revision-restore`, `progressive-startup`,
`realtime-sync-security-and-restore`, `devices`, `search-offline`,
`page-ambiguity`.

Totals: **3 × P1, 6 × P2, 6 × P3.**

| # | Severity | Site | Confidence |
|---|----------|------|-----------|
| 1 | P1 | `page-multi-device-convergence.spec.ts:385` | observed-in-CI (run `43722479700`) |
| 2 | P1 | `conflict-resolution.spec.ts:96` | static-only |
| 3 | P1 | `offline-availability.spec.ts:158` | static-only |
| 4 | P2 | `page-ambiguity.spec.ts:125` | static-only |
| 5 | P2 | `revision-restore.spec.ts:30` | static-only |
| 6 | P2 | `databases-offline-sync.spec.ts:347` | static-only |
| 7 | P2 | `offline-availability.spec.ts:89` | static-only |
| 8 | P2 | `save-state.spec.ts:142` | static-only |
| 9 | P2 | `legacy-sync-self-healing.spec.ts:52` | static-only |
| 10 | P3 | `offline-reconciliation.spec.ts:68` | suspect |
| 11 | P3 | `page-autosave-recovery.spec.ts:74` | static-only |
| 12 | P3 | `save-state.spec.ts:75` | static-only |
| 13 | P3 | `save-state.spec.ts:219` | static-only |
| 14 | P3 | `interrupted-mutations.spec.ts:86` | static-only |
| 15 | P3 | `live-sync.spec.ts:54` | static-only |

Relevant runtime facts used throughout (verified in this worktree, not assumed):

- `playwright.config.ts` sets `expect.timeout: 10_000`, `retries: 0`; a bare
  `expect(locator)…` therefore polls for 10 s and a *negative* assertion passes
  on the first observation.
- `window.__MYOWNNOTION_E2E_LOCAL_CONTENT__()` exposes `synchronize()`,
  `getSnapshot().syncState`, `getItem()`, `mutate()`, `outbox.*`,
  `db.revisionHeaders`, `db.legacySyncRecoveries`,
  `pageOperationLog.getState/getLegacyBranch` — but **no** presentation-state
  reader (`tests/e2e/helpers.ts:308-368`).
- `[data-testid="editor-sync-status"]` is derived from the page session's
  durable state and is additionally gated on `data-editor-settled`
  (`apps/web/src/features/editor/editor-sync-status.tsx:89-117`).
- The "last visited item" is written by a fire-and-forget effect
  (`apps/web/src/features/hierarchy/hierarchy-explorer.tsx:879-887`, calling
  `updateWorkspacePresentationState`, `packages/client-core/src/navigation/presentation-state.ts:204`)
  into `db.meta` key `navigation-state`; nothing awaits it.
- `runEviction` (`packages/client-core/src/local-store/budget.ts:151`) has **no
  production caller** — only `packages/client-core/tests/budget.spec.ts` calls
  it. `measure()` (`budget.ts:43`) only reports.

## Confidence and limits

- `observed-in-CI` is only claimed for finding 1; the CI evidence file
  (`evidence/errors/43722479700-1-132837341439.txt`) is the same worktree's
  suite and shows the exact failure this brief describes.
- No other in-scope spec appears in `evidence/errors/*` with a failure that this
  audit attributes to a wait contract; the `databases-offline-sync` failures in
  those files are WebKit `goto` internal errors, and the `realtime-page-sync`
  failures predate the keyboard-shortcut fix at line 176.
- I did not run anything. Where a claim depends on render timing (whether the
  `data-sync`/`data-durable` DOM attributes can lag the durable state by one
  React commit) I say so instead of asserting it.

---

## page-multi-device-convergence.spec.ts:385 — a restarted device drains a closed page without reopening it

1. **Location** — `tests/e2e/page-multi-device-convergence.spec.ts:385`, test
   `a restarted device drains a closed page without reopening it` (header line 344).
2. **Code at that point**
   ```ts
       await selectItem(second.page, landingName);
       await expect(second.page.getByTestId("active-item-title")).toHaveValue(landingName);
       await second.page.close();
   ```
3. **Operation still in flight** — `updateWorkspacePresentationState`
   (`packages/client-core/src/navigation/presentation-state.ts:204`) committing
   the `navigation-state` row (`lastVisitedItemId: selectedId`) into IndexedDB,
   issued from `apps/web/src/features/hierarchy/hierarchy-explorer.tsx:879-887`
   inside `void (async () => …)()`. Nothing awaits that promise; the next
   selection effect re-reads and rewrites the same row transactionally.
   `selectItem` additionally only waits for `aria-selected="true"`
   (`tests/e2e/helpers.ts:914-916`), which is React state.
4. **Signal waited on** — `aria-selected` on the row plus the
   `active-item-title` textarea value. Both are the rendered projection of the
   selection; neither is written by, ordered with, or blocked on the IndexedDB
   transaction. `close()` then destroys the only client that could still commit
   the row.
5. **Real precondition** — the `navigation-state` row in `db.meta` must contain
   `lastVisitedItemId === <landing item id>` *before* the tab goes away, because
   the reopened tab boots `selectedId` from that row
   (`hierarchy-explorer.tsx:182-191, 816`).
6. **Existing real signal** — none through the E2E hook (it exposes no
   presentation reader). Two available proofs: (a) poll a raw IndexedDB read of
   store `meta`, key `navigation-state`, value `.lastVisitedItemId` (the pattern
   `page-multi-tab-convergence.spec.ts:149-168` already uses for
   `pageOperationUpdates`), using the id from the row's `data-item-id`
   (as `legacy-sync-self-healing.spec.ts:53` does); or (b) expose
   `readPresentationState()` on `window.__MYOWNNOTION_E2E_LOCAL_CONTENT__`.
   Either must be added — **the producer is `updateWorkspacePresentationState`;
   it currently offers no awaitable ack.**
7. **Severity** — `P1`: the close discards the write and the follow-up
   assertion proves a *different* page was restored, so a correct application
   goes red and the durability claim for device-local navigation is untested.
8. **Confidence** — `observed-in-CI`: run `43722479700`, job `132837341439`,
   project `webkit-mobile`, failing at `:390` with
   `Expected: "DifferentLandingPage-…" / Received: "ClosedPageQueue-…"`
   (`evidence/errors/43722479700-1-132837341439.txt`). This is the reference case
   named in the brief.

---

## conflict-resolution.spec.ts:96 — produces no conflict when it catches up

1. **Location** — `tests/e2e/conflict-resolution.spec.ts:96`, test
   `a device that is merely behind (FR-011)` › `produces no conflict when it catches up`.
2. **Code at that point**
   ```ts
       await selectItem(second.page, name);
       await expect(second.page.getByTestId("sync-status")).not.toHaveAttribute(
   ```
3. **Operation still in flight** — the second device's catch-up: the change
   feed/stream reconnection after `setOffline(false)` (line 86), the pull of the
   first device's acknowledged page document (published at line 83-84), and the
   resulting revision/conflict classification. `selectItem` only proves the row
   became `aria-selected`.
4. **Signal waited on** — `sync-status[data-state] != "conflict"`. It is a
   negative assertion over a global status: it is satisfied the instant it is
   first evaluated (10 s budget, but the condition is already true on
   observation), including the case where the device has not yet imported
   anything at all. It cannot distinguish "reconciled with no conflict" from "no
   reconciliation has happened yet".
5. **Real precondition** — the second device has imported the first device's
   edit and classified it (frontier equal to the server head), so the absence of
   a conflict is a statement about a *completed* catch-up.
6. **Existing real signal** — `waitForSynchronized(second.page)` (the durable
   outbox drained) plus `[data-testid="editor-sync-status"][data-sync="synced"]`
   after `selectItem`, and/or asserting the document now contains
   `"written only on the first device"` before checking
   `sync-status`; `window.__MYOWNNOTION_E2E_LOCAL_CONTENT__.outbox.activeConflicts()`
   gives the durable conflict list directly.
7. **Severity** — `P1`: the only assertion of the journey — the one the comment
   calls "the assertion that matters" — can pass without the reconciliation it
   exists to verify. A wrong result passes.
8. **Confidence** — `static-only`.

---

## offline-availability.spec.ts:158 — an unsent change is still there after the limit is lowered

1. **Location** — `tests/e2e/offline-availability.spec.ts:158`, test
   `an unsent change is still there after the limit is lowered`.
2. **Code at that point**
   ```ts
       await page.getByTestId("storage-limit").selectOption(String(1024 * 1024 * 1024));
       await page.waitForTimeout(500);
   ```
3. **Operation still in flight** — the eviction pass the comment promises
   ("the eviction pass runs against whatever it measures"). `StoragePanel.setLimit`
   awaits `writeLimit` and then `measure()` but never calls `runEviction`
   (`apps/web/src/features/files/storage-panel.tsx:44-52`), and `runEviction`
   has no production caller anywhere in `apps/` or `packages/` outside unit
   tests (`grep runEviction` → `packages/client-core/tests/budget.spec.ts` only).
   So the operation being waited for is not merely in flight: it never starts.
4. **Signal waited on** — a 500 ms sleep. It is not a signal at all; it neither
   proves the limit was persisted (the `NativeSelect` `disabled={busy}` state
   does) nor that any eviction ran (nothing runs).
5. **Real precondition** — the limit row is committed **and** the eviction pass
   has run against it, deciding that the offline item is not releaseable
   (`candidatesFrom` marks anything queued as `recoverable: false`,
   `budget.ts:236-291`), leaving `localAvailability === "present"` and
   `sealedPageBody` non-null.
6. **Existing real signal** — for the limit write: `await expect(select).toBeEnabled()`
   (busy clears only after `writeLimit` + `measure`). For the guarantee: **none —
   must be exposed by the storage budget owner**, e.g. a boot-time/on-demand
   `runEviction` invocation plus an E2E-readable eviction report, or a direct
   IndexedDB read of the item row's `localAvailability`/`sealedPageBody` after a
   real eviction run.
7. **Severity** — `P1`: the file states this is "the guarantee, not the feature
   … the only path where an owner could lose work", yet the test is green
   unconditionally because nothing is ever released. A wrong result passes
   forever, including a regression that makes eviction delete unsent work.
8. **Confidence** — `static-only` (verified by reading the producers; the test
   cannot fail for the reason it claims to test).

---

## page-ambiguity.spec.ts:125 — delete/edit ambiguity survives restart and restores the edited block

1. **Location** — `tests/e2e/page-ambiguity.spec.ts:125`, test
   `delete/edit ambiguity survives restart and restores the edited block`.
2. **Code at that point**
   ```ts
       await setOffline(context, page, false);
       await expect(page.getByTestId("editor-sync-status")).not.toHaveAttribute(
   ```
3. **Operation still in flight** — the deleting device's queued page operations
   (the block deletion made at lines 103-107) being submitted over the page
   socket and accepted by the server, *before* the editing device reconnects at
   line 135.
4. **Signal waited on** — `data-sync != "offline"` (20 s). The attribute leaves
   `offline` when the transport reconnects, i.e. as soon as the device is online
   again, and passes through `pending`/`syncing` before the server has accepted
   anything (`editorSyncLabel`, `apps/web/src/features/editor/editor-sync-status.tsx:33-55`).
5. **Real precondition** — the comment on lines 122-123 states the intent
   ("Deletion reaches the server first; editing arrives later"); the guarantee
   required is that the deletion is committed server-side before the second
   device's edit is published, so the merge sees delete-after-edit rather than
   the reverse.
6. **Existing real signal** — `data-sync="synced"` on
   `[data-testid="editor-sync-status"]` (or `waitForSynchronized(page)`, which
   polls the durable queue to `"synced"`), optionally with
   `data-pending-count="0"`, before `setOffline(second.context, …, false)`.
7. **Severity** — `P2`: the intended ordering is unproven; the reverse
   interleaving is possible and would most often surface as a false red at the
   ambiguity assertions (and, less often, as a pass that exercises a different
   merge than the one described).
8. **Confidence** — `static-only`.

---

## revision-restore.spec.ts:30 — restores retained content as a new descendant revision

1. **Location** — `tests/e2e/revision-restore.spec.ts:30`, test
   `revision-restore.spec.ts` › `revision history (US5)` ›
   `restores retained content as a new descendant revision`.
2. **Code at that point**
   ```ts
       const originalHead = await page.getByTestId("current-head").textContent();
   ```
   (preceded by `await waitForSynchronized(page);` at line 24)
3. **Operation still in flight** — the `item.create` mutation for the page is
   still being drained from the outbox (and its local revision mapped to the
   canonical one) when `current-head` is read. `current-head` renders
   `item.currentRevisionId` from the workspace projection
   (`apps/web/src/features/history/revision-restore.tsx:151-152`), not a server
   read.
4. **Signal waited on** — `waitForSynchronized(page)` after `createRootItem`.
   It is a *global* queue-state poll that was already `"synced"` before the
   creation was enqueued, so it can return immediately (the same trap
   `readTreeOrder`'s docstring warns about, `tests/e2e/helpers.ts:1396-1411`).
   The value it guards is then used as a server revision id at line 41.
5. **Real precondition** — `originalHead` must be a revision the server can
   serve, i.e. the creation has been accepted and the local revision has a
   canonical form, before it is typed into `revision-id-input`.
6. **Existing real signal** — `service.db.revisionHeaders.get(id).canonicalRevisionId`
   (`tests/e2e/helpers.ts:343`, already declared for the E2E hook) or a
   `GET /v1/items/<id>` read to obtain `currentRevisionId` (the pattern at
   `databases-offline-sync.spec.ts:431-447`); the in-app preview already does the
   server read (`revision-restore.tsx:96-106`), so binding the *input* to a
   server-read head is the consistent fix.
7. **Severity** — `P2`: a stale head produces `revision.loadFailed`, no
   `revision-preview`, and a false red at line 43 that points at the preview
   rather than at the missing wait.
8. **Confidence** — `static-only` (I did not verify whether the local revision
   id is itself canonical server-side; if it is, the remaining risk is only
   "revision not yet accepted", which is the same finding).

---

## databases-offline-sync.spec.ts:347 — survives restart, merges compatible fields, and resolves a same-field conflict

1. **Location** — `tests/e2e/databases-offline-sync.spec.ts:347`, test
   `structured offline convergence (US5)` ›
   `survives restart, merges compatible fields, and resolves a same-field conflict`.
2. **Code at that point**
   ```ts
       await updateTextCell(page, entryName, "Owner", "remote compatible owner");
       await waitForSynchronized(page);
   ```
3. **Operation still in flight** — the first device's
   `database.entry.values.replace` mutation for the `Owner` cell: enqueue into
   the encrypted outbox, submit as a batch, server acceptance. The very next
   step (line 349-353) reloads the *other* device and asserts it observes
   `"remote compatible owner"`.
4. **Signal waited on** — the global `syncState === "synced"`. The first device
   had been idle since line 288, so the queue was empty and the state was
   already `"synced"`; the poll can pass before this cell edit reaches the
   outbox. `updateTextCell` itself only waits for the grid cell's `aria-label`
   (line 163-165), a projection.
5. **Real precondition** — *this* mutation is durable and accepted by the
   server before the second device's next read.
6. **Existing real signal** — `pendingCommand(page, "database.entry.values.replace")`
   going from `1` to `0` (the helper this very file defines, line 168-170), a
   `page.waitForResponse` on the batch matching the payload (the pattern
   `renameItem`, `tests/e2e/helpers.ts:773-824`), or an API read of the entry.
   The same pattern recurs at line 390.
7. **Severity** — `P2`: false red — the reloaded device still shows
   `"common owner"` and the failure lands on an assertion far from the missing
   wait.
8. **Confidence** — `static-only`.

---

## offline-availability.spec.ts:89 — a marked branch opens with no network

1. **Location** — `tests/e2e/offline-availability.spec.ts:89`, test
   `a marked branch opens with no network`.
2. **Code at that point**
   ```ts
       await clickItemAction(page, folder, `offline-action-${folder}`);
       await waitForSynchronized(page);
   ```
3. **Operation still in flight** — the `item.offline` mutation
   (`packages/domain/src/content/mutations.ts:33`) that sets
   `offlineIntent` on the folder: outbox enqueue, local apply, submission.
4. **Signal waited on** — global `syncState === "synced"`, already true before
   the click (the folder and child were drained at line 87). Nothing in
   `clickItemAction` proves the toggle was applied: it waits for the menu to be
   visible and then clicks the action (`tests/e2e/helpers.ts:758-765`).
5. **Real precondition** — the marking is committed on this device (the item
   row carries `offlineIntent: true`) before the context goes offline at line 91
   and the marked branch is opened at line 97.
6. **Existing real signal** — re-open the row menu and assert
   `aria-checked="true"` on `offline-action-<folder>` (exactly what the sibling
   tests at lines 38-48 and 58-64 do), or read the item's `offlineIntent`
   through a durable read; `pendingCommand(page, "item.offline")` on the
   diagnostics screen would prove the enqueue as well.
7. **Severity** — `P2`: two failure directions. A stale pass makes the
   "marked branch" untested, and the following assertions
   (`block-editor` visible, `editor-unavailable` count 0) do not distinguish a
   marked branch from an unmarked one, so the journey can be green without the
   marking having been applied at all.
8. **Confidence** — `static-only`.

---

## save-state.spec.ts:142 — the last completed edit is there when the application reopens

1. **Location** — `tests/e2e/save-state.spec.ts:142`, test
   `what survives an unexpected close` ›
   `the last completed edit is there when the application reopens`.
2. **Code at that point**
   ```ts
       await page.waitForTimeout(400);
       await page.reload();
   ```
3. **Operation still in flight** — the browser's write-back of the committed
   Dexie transaction from its in-memory cache to disk (outside the application's
   observation). The suite's contract (`data-durable="true"`) is the local
   commit, already awaited at line 138 via `saveDocument(page)`.
4. **Signal waited on** — a fixed 400 ms sleep, which the comment itself
   concedes is an engine-flush guess ("Reloading inside that window tests the
   engine, not the application boundary"). A slow runner flushes later; a fast
   one flushes earlier and the sleep proves nothing about which happened.
5. **Real precondition** — the acknowledged record is readable from a *new*
   browsing context (a real read-back), which is the only externally observable
   form of the durability the test claims.
6. **Existing real signal** — read the record back through a fresh page of the
   same context (`await context.newPage()` as `page-autosave-recovery.spec.ts:75`
   does) instead of sleeping, or make the assertion about the durable ack
   (already available at line 138) and drop the flush claim from the comment.
7. **Severity** — `P2`: the fixed sleep is the only thing standing between a
   correct write and a false red when the engine's flush is slower than 400 ms.
8. **Confidence** — `static-only` (the comment documents the assumption, which
   is why this is a contract problem and not a mystery flake).

---

## legacy-sync-self-healing.spec.ts:52 — five retained page conflicts self-heal while persistent storage remains a separate advisory

1. **Location** — `tests/e2e/legacy-sync-self-healing.spec.ts:52`, test
   `five retained page conflicts self-heal while persistent storage remains a separate advisory`.
2. **Code at that point**
   ```ts
       await createRootItem(page, "page", name);
       await waitForSynchronized(page);
   ```
3. **Operation still in flight** — the created page's `item.create` mutation
   (and its canonical revision) being submitted and accepted, once per loop
   iteration (lines 48-56).
4. **Signal waited on** — global `syncState === "synced"`. Nothing in the
   iteration drains a *specific* creation, and the value read at line 53
   (`data-item-id`) is only the DOM identity of an optimistic row.
5. **Real precondition** — all five pages are known to the server before the
   final `request.get(`${apiOrigin()}/v1/items/${fixture.id}`)` loop
   (lines 190-195) and before the seeded `page.document.replace` mutations bind
   to a server-side base revision (lines 70-94).
6. **Existing real signal** — the API read the test already performs at line 191
   (moved before the offline phase), or the E2E hook's
   `service.getItem(id).currentRevisionId` together with
   `db.revisionHeaders.get(…).canonicalRevisionId`.
7. **Severity** — `P2`: a stale pass leaves an unsubmitted creation behind and
   the failure surfaces at the final server read (or as an unexpected conflict
   during the seeded migration), far from the actual cause.
8. **Confidence** — `static-only`.

---

## offline-reconciliation.spec.ts:68 — loaded content stays readable and editable offline, then reconciles once

1. **Location** — `tests/e2e/offline-reconciliation.spec.ts:68`, test
   `offline continuity (US6)` ›
   `loaded content stays readable and editable offline, then reconciles once`.
2. **Code at that point**
   ```ts
       await createRootItem(page, "folder", offlineItem);
       await expect(page.getByTestId("pending-mutations")).toBeVisible();
   ```
   (then `page.reload()` at line 71)
3. **Operation still in flight** — the offline `item.create` for `offlineItem`.
4. **Signal waited on** — `pending-mutations` visibility. It is a durable read
   (`MutationStatus` renders only when `service.outbox.all()` is non-empty,
   `apps/web/src/features/hierarchy/mutation-status.tsx:76-114`), which is good —
   but it is **not correlated with this mutation**: any queued row satisfies it.
   The previous creation's drain was itself only proven by
   `waitForSynchronized` at line 48, so a leftover row is possible.
5. **Real precondition** — the `item.create` row for `offlineItem` exists in the
   outbox before the restart (the point of step 4).
6. **Existing real signal** — filter by command type as the sibling file does
   (`pendingCommand(page, "item.create")`, `databases-offline-sync.spec.ts:168-170`),
   or read `outbox.all()` through the E2E hook and match `payload.itemId`
   (`tests/e2e/helpers.ts:323-331`). The same uncorrelated check appears at
   `interrupted-mutations.spec.ts:35`.
7. **Severity** — `P3`: the durable source is right; only the correlation is
   missing, so the worst case is a low-probability false red at line 75.
8. **Confidence** — `suspect`.

---

## page-autosave-recovery.spec.ts:74 — edits from a closed tab reappear when the workspace reopens

1. **Location** — `tests/e2e/page-autosave-recovery.spec.ts:74`, test
   `autosave under abrupt exit` ›
   `edits from a closed tab reappear when the workspace reopens`
   (same shape at line 41 of `a hard reload right after typing …`).
2. **Code at that point**
   ```ts
       if (await status.count()) {
         await expect(status).toHaveAttribute("data-durable", "true", { timeout: 15_000 });
   ```
   followed by `await page.close();`
3. **Operation still in flight** — the local IndexedDB commit of the typed
   burst (already covered by `waitForEditorSettled` at line 63) and its
   acknowledgement on `[data-testid="editor-sync-status"]`.
4. **Signal waited on** — `data-durable="true"`, but only *if* the status line
   happens to be mounted when `count()` is evaluated. The check is a single
   non-retrying observation; when it is 0 the test closes the tab with no
   durability evidence at all, and the guard has no diagnostic.
5. **Real precondition** — the acknowledged durability of this burst, always,
   before the tab is closed.
6. **Existing real signal** — `saveDocument(page)` already does exactly this
   and handles both editing paths (`tests/e2e/helpers.ts:1745-1775`; it polls for
   the status *or* the legacy control, then requires `data-durable="true"`).
7. **Severity** — `P3`: in practice `waitForEditorSettled` requires the
   operational editor, so the status should be present and the guard is
   effectively dead code; but it silently weakens the exact boundary the file
   exists to prove, and a future editor change would turn it into a false red.
8. **Confidence** — `static-only`.

---

## save-state.spec.ts:75 — never says synchronized before the server has confirmed

1. **Location** — `tests/e2e/save-state.spec.ts:75`, test
   `the honest states` › `never says synchronized before the server has confirmed`.
2. **Code at that point**
   ```ts
       await page.waitForTimeout(2_000);
       await expect(indicator(page)).not.toHaveAttribute("data-sync", "synced");
   ```
3. **Operation still in flight** — nothing of its own; the claim is an
   *absence* over a window ("must not appear at any point").
4. **Signal waited on** — a 2 s sleep, then two negative assertions. A sleep
   bounds the observation to 2 s; it cannot establish "at no point", and it is
   host-dependent in the other direction too.
5. **Real precondition** — the device provably cannot reach `synced` while
   offline: the durable queue still holds the edit and the transport is offline.
6. **Existing real signal** — assert the positive state that excludes `synced`
   (`data-sync="offline"` and `data-state="offline"`, as the sibling test at
   line 95 does) plus `data-pending-count > 0`; then the negative is implied by
   the state machine rather than sampled.
7. **Severity** — `P3`: the sleep is the weakest available proof and hides a
   real regression that promotes the label later than 2 s.
8. **Confidence** — `static-only`.

---

## save-state.spec.ts:219 — keeps the work durable and readable while sending is refused

1. **Location** — `tests/e2e/save-state.spec.ts:219`, test
   `when the server refuses the write` ›
   `keeps the work durable and readable while sending is refused`.
2. **Code at that point**
   ```ts
       await expect(indicator(page)).toHaveAttribute("data-durable", "true", { timeout: 30_000 });
       await expect(indicator(page)).not.toHaveAttribute("data-sync", "synced");
   ```
3. **Operation still in flight** — the submission attempt of the new edit to
   the server, whose refusal is what this test is about; at the moment of the
   assertion the transport may not have attempted it yet.
4. **Signal waited on** — `data-sync != "synced"`. A negative assertion is
   satisfied on first observation, so it passes just as well because the sync
   has not started as because the server refused it. The refusal itself is never
   observed.
5. **Real precondition** — the write was attempted and refused (or is durably
   pending and blocked), i.e. the "server has not confirmed them" clause is a
   statement about a completed attempt.
6. **Existing real signal** — `data-state` / `data-pending-count` on the same
   element, or the durable outbox row's `lastAttemptAt`/status through
   `outbox.all()`; `[data-testid="editor-sync-blocked-reason"]` exists for the
   blocked case (`editor-sync-status.tsx:127-131`).
7. **Severity** — `P3`: the durable half is sound; only the negative half can be
   satisfied before the refusal is exercised.
8. **Confidence** — `static-only`.

---

## interrupted-mutations.spec.ts:86 — an invalid change reports an explicit rejection without partial state

1. **Location** — `tests/e2e/interrupted-mutations.spec.ts:86`, test
   `an invalid change reports an explicit rejection without partial state`.
2. **Code at that point**
   ```ts
       await ensureNavigationRowVisible(page, child);
       await waitForSynchronized(page);
   ```
3. **Operation still in flight** — the rejected `item.move` attempt and the
   recovery of the retained tree afterwards.
4. **Signal waited on** — the global queue state, with no following step: the
   test ends on it, so it proves nothing about the rejection it just asserted
   and nothing about "without partial state" beyond the two row lookups above.
5. **Real precondition** — the rejected mutation row is retained
   (`data-mutation-state="rejected"` / `outbox.conflicts()`), which is what
   "reports an explicit rejection" means downstream.
6. **Existing real signal** — the durable diagnostics this file already opens in
   its sibling test (`[data-testid="pending-mutations"]`,
   `[data-mutation-state="retrying"]`, lines 45-51) or
   `outbox.activeConflicts()`.
7. **Severity** — `P3`: a trailing global wait gives the impression that the
   rejection path settled when only "nothing is pending right now" was shown.
8. **Confidence** — `static-only`.

---

## live-sync.spec.ts:54 — a change made on one device reaches another without it asking

1. **Location** — `tests/e2e/live-sync.spec.ts:54`, test
   `live synchronization (US1)` ›
   `a change made on one device reaches another without it asking`.
2. **Code at that point**
   ```ts
       await createRootItem(page, "folder", created);
       await waitForSynchronized(page);
   ```
3. **Operation still in flight** — the `item.create` for `created`; the wait is
   meant to establish that the change is available for the other device to
   receive.
4. **Signal waited on** — global `syncState === "synced"`, already true before
   the creation (the device was idle). The real wait for the observed outcome is
   the 15 s `toBeAttached` on the other device at line 57, so the stale pass is
   currently harmless — but the two waits are presented as
   "created → synchronized → observed", and only the last one means anything.
5. **Real precondition** — the creation has reached the server (so the other
   device's live update can be attributed to the channel under test rather than
   to an unrelated later retry).
6. **Existing real signal** — a `waitForResponse` on the batch containing this
   name (`renameItem`, `tests/e2e/helpers.ts:773-824`) or
   `pendingCommand`-style outbox verification; the file already measures
   `startedAt` for its console timing, so the wait should be the one that makes
   that measurement honest.
7. **Severity** — `P3`: style/robustness; no false pass is possible today
   because line 57 has its own budget.
8. **Confidence** — `static-only`.

---

## OK (verified waits)

Waits I checked and consider sound, with the reason. Reading these first is
useful because several of them are the exact shape the findings above are
missing.

- `tests/e2e/helpers.ts:1739-1775` (`saveDocument`) — chooses the editing path
  by polling for it, then requires `data-state != "local-saving"`,
  `data-durable="true"` and (optionally) `data-sync="synced"`. The durable half
  is the acknowledged local commit, which is the contract. Used correctly at
  `conflict-resolution.spec.ts:130` (before the reload at 138),
  `page-protocol-migration.spec.ts:218/233`, `offline-availability.spec.ts:152`,
  `save-state.spec.ts:56/111/138`, `search-offline.spec.ts:117/135`.
- `tests/e2e/helpers.ts:1605-1637` (`waitForEditorSettled`) — requires the
  editor's own monotonic counters (`afterApplyCount` / `afterSequence`),
  `data-editor-settled="true"` and `data-editor-apply-failures="0"`. This is the
  only wait in the suite that names *which* gesture it is waiting for; every
  "settled then reload/close" journey is sound because of it.
- `page-multi-device-convergence.spec.ts:225-235` → close at `:239` — the
  deliberate crash happens only after `waitForPageSynchronized` (editor settled,
  `data-durable="true"`) on both devices, so the "crash boundary" really does
  contain durable operations.
- `page-multi-device-convergence.spec.ts:99-111` (`reconnectOpenDevice` /
  `reopenDevice`) — both wait for `data-durable="true"` and
  `data-sync="synced"` on the specific open document before any cross-device
  comparison.
- `page-multi-tab-convergence.spec.ts:226` — `countSendingPageUpdates` reads
  `pageOperationUpdates` index `status` directly from IndexedDB and requires
  `sending > 0` before the sender tab is closed (`:234`); the close is a
  deliberate, proven crash-after-commit, and the intercepted frame
  (`:114-136`) proves the server transaction happened.
- `page-multi-tab-convergence.spec.ts:245-263` — the API read and the canonical
  storage check both run after `waitForPageSynced`, so they cannot observe an
  uncommitted state.
- `databases-offline-sync.spec.ts:315/326/381` (`pendingCommand` filtered by
  `commandType`) — a durable outbox read naming the mutation family; the reloads
  at `:328`, `:350`, `:382`, `:393` are guarded by it. This is the model the
  `pending-mutations`-only checks (finding 10) should follow.
- `databases-offline-sync.spec.ts:431-448` — reads `/v1/items` and
  `/v1/revisions` to prove a two-parent merge commit, i.e. an authoritative
  read of the server rather than a UI proxy.
- `interrupted-mutations.spec.ts:38-51` — the reload is guarded by a durable
  outbox read and then by `[data-mutation-state="retrying"]` (derived from
  `lastAttemptAt` in the stored row), which is exactly the "interrupted attempt"
  the test claims.
- `legacy-sync-self-healing.spec.ts:96-101` and `:111` — the seeded mutation is
  verified in `outbox.all()` (and the missing recovery rows are deleted and
  re-read) before the reload at line 123; line 128-155 then polls the service's
  own durable state for the converted outcome.
- `page-protocol-migration.spec.ts:122-134` (poll on
  `pageOperationLog.getState(id) === "active"`), `:81-90` (the queued
  replacement is confirmed in `outbox.all()` with its local revision id) and
  `:153` (`saveDocument` until `"synced"` before the server read).
- `progressive-startup.spec.ts:512/518/536/550` — `pendingWorkspaceWrites()`
  reads `outbox.all()` in the page and requires `> 0` across the restart and
  `0` after the drain; `:404-422` verifies the `projectionComplete` marker is
  really absent before the legacy-cache reload.
- `page-ambiguity.spec.ts:136-144` — I checked this one specifically because it
  closes a tab after an action: the notice is rendered from
  `service.pageOperationLog.listOpenAmbiguities(itemId)`
  (`apps/web/src/features/editor/editor-view.tsx:96-122`), a durable store read,
  so the visible notice is the same evidence the restarted tab will re-read.
  `waitForPageSync` (`:49-54`) is also the sound variant: editor settled,
  `data-durable="true"`, then the transport kind.
- `protocol-compatibility.spec.ts:98-102` and
  `realtime-sync-security-and-restore.spec.ts:105-109` — after revocation the
  tests wait for the *server-derived* `live-connection-state[data-state]`
  (`revoked`), which only the server's refusal can produce. (The 5 s budget in
  the second one is tight, but it is not a proxy.)
- `search-offline.spec.ts:139` and `:177` — the offline edit waits for
  `data-sync="offline"` (page-level transport) after `saveDocument`, and the
  reconnect waits for the durable queue to drain before the coverage assertion.
- `offline-availability.spec.ts:38-48` and `:58-64` — the toggle is verified by
  re-opening the row menu and reading `aria-checked="true"` from the item's
  projection (the durable `offlineIntent` applied locally), which is the
  correlated confirmation missing at finding 7.
- `helpers.ts:1371-1386` (`waitForSynchronized`) — sound *as a statement about
  the durable queue being empty now*. It is only unsound when used as the sole
  proof that a just-commanded operation finished, which is what findings 6, 7
  and 9 describe.

### Caveats inside the OK set (not scored as findings)

- `databases-offline-sync.spec.ts:507-509`: `goOffline` aborts `/v1/**` fetches
  but not the page-sync WebSocket, so "offline" here rests on the fetch routes
  only; the released-entry assertions (`:522-534`) could be satisfied or broken
  by whatever the still-open socket does. Out of class for the wait contract,
  but worth knowing before tightening that test.
- `search-offline.spec.ts:127`: the page body is released by a raw IndexedDB
  write while the app keeps its own connection and index; the test never
  reloads, so the "released" premise depends on the app re-reading storage. Also
  out of class for waits, but it makes the negative search assertion weaker than
  it reads.
- `offline-availability.spec.ts:88-89` and `save-state.spec.ts:117` reload
  immediately after a *menu* interaction; they differ from finding 7 only in
  that `save-state` performs a page edit first (`saveDocument`) while
  `offline-availability` relies on the toggle above.
