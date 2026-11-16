# Scan — UI, editor, menus, workspace, databases, files, security, desktop

Read-only scan of the worktree `/Users/enzofournet/Git/MyOwnNotion-059` at `f73b449c`
(tree `5f71be02`). No file in that worktree was modified; no test was run.

## Scope actually read

Full reads: `block-editor`, `rich-page`, `code-block-ui`, `editor-caret`, `editor-math-contents`,
`editor-offline-media`, `editor-performance`, `editor-suggestion-menu`, `hierarchy`,
`item-conversion`, `keyboard-navigation`, `workspace-shell`, `workspace-tabs-folder`,
`workspace-settings-boundary`, `narrow-viewport`, `routing`, `page-links`,
`page-scroll-restoration`, `touch-and-motion`, `database-entry-properties`,
`database-form-lifecycle`, `database-multi-select-board`, `database-relations-rollups`,
`database-page-flow`, `databases-pages-views` (all), `databases-visual-views`, `v1-surface-visuals`,
`workspace-shell-visual`, `file-preview`, `desktop-onboarding`, `desktop-device-revocation`,
`desktop-offline-restart`, `desktop-native-journey`, `helpers.ts`, `fixtures.ts`,
`desktop-workspace.ts`.
Targeted reads of the reload/offline/durability sites in `files`, `accessibility`, `mcp-access`,
`protected-files`, `security-content-regression`, `databases-views`, `authentication`, `bootstrap`,
`backup`, `search`, `knowledge-graph`, `linked-databases`, `relationships`, `databases-schema`,
`databases-tasks`, `security-*` (grep-driven, only where a page-local write precedes a boundary).

## The mechanism I verified before judging any wait

This is what decides whether a DOM assertion is already a durability witness. It is the single most
useful thing in this report; every severity below follows from it.

1. **Mutation-path writes are atomic.** `packages/client-core/src/outbox/apply-local-mutation.ts`
   (header): "The optimistic projection update and the durable outbox entry commit in ONE IndexedDB
   transaction: success is reported only after both are durable." So for creations, moves,
   conversions, trash, presentation/definition mutations and item renames committed through
   `service.mutate`, *the projection cannot change before the outbox row exists*. `waitForSynchronized`
   is therefore a real correlate for those paths (the queue cannot read `synced` while the row is
   queued), and `waitForSynchronized` → `reload` is legitimate. I list many such sites as OK.

2. **Some writes are shown before they are written.** Those break the correlation and are where the
   real defects are:
   - tree inline rename: `hierarchy-explorer.tsx:1532` sets `pendingTreeNames` and then
     `void renameSelectedItem(...)` (line 1540) — the row shows the new name before any write;
   - entry property values *and* entry property order: `entry-panel.tsx:196`
     `data-save-state={autosave.state}` over `use-entry-autosave`; the drag commit is
     `void edit?.((d) => reorderEntryProperties(...)).catch(() => undefined)`
     (`entry-property-list.tsx:485`);
   - view/presentation edits: `database-container-page.tsx:909` `void save({...})` where
     `save` is async and awaits `service.mutate("database.presentation.replace", …)` (line 438);
   - card kind selector (`Type d’élément`): React state, asserted by `aria-pressed`;
   - open tabs / sidebar width / last-visited: presentation state persisted from a separate
     (debounced) device-ergonomics write — this is the class of the *proven* reference case in the
     brief;
   - editor block content before the editor batcher commits — although here the surface does expose
     a correct witness (see OK #1).

3. **The async-handler gap.** Every `void save(...)` / `void edit?.(...)` / `void rename(...)` returns
   from the click handler *before* the mutation is dispatched. A global queue poll started right after
   the click therefore reads "synced" both because the queue really is empty and because the write has
   not been enqueued yet. The discriminating witness is the *control or row the user just operated*
   flipping to its written state (which only happens after the atomic commit), or the dedicated
   attribute (`data-save-state`, `data-definition-state`, `data-editor-settled`) *after* an observed
   non-idle/unsettled phase.

4. **Editor gestures do have a synchronous witness.** `page-editor.tsx:810` calls `markEditorActivity()`
   from `onBeforeInputCapture`, and `markEditorActivity` writes `data-editor-settled="false"` in the
   same task (`writeEditorSettlementState`). `applyLocalChanges` does the same for non-input
   transactions. So `waitForEditorSettled` / `saveDocument` cannot be fooled by the "gesture not yet
   observed" gap for typing and for block/transaction edits. I verified this specifically because it
   decides a dozen sites; those are OK, not findings.

## Confidence policy used

`static-only` unless stated. The evidence directory contains CI logs, but the only failure whose
`file:line` matches the audited tree is the reference case itself
(`page-multi-device-convergence.spec.ts:344`, run `43722479700` job `132837341439`, `webkit-mobile`,
failed then passed on retry). The other logs come from earlier trees — the line numbers do not match
(`editor-math-contents.spec.ts:98` vs `100`, `database-relations-rollups.spec.ts:196` vs `227`) — so I
do not attribute them to these lines. Where a structurally identical failure exists in those logs I
say so in the finding text and still keep `static-only`.

## Summary

14 findings in scope: **2 × P1, 6 × P2, 6 × P3**, plus the assessment of all four `waitForTimeout`
calls in the repository (one is finding 1 below, three are outside this scan's files and are recorded in
their own section). 15 waits were verified as genuine proofs and are listed under *OK*.

| # | Site | Severity | One line |
|---|------|----------|----------|
| 1 | `file-preview.spec.ts:203` | P1 | security negative assertion gated on `waitForTimeout(1000)`, no positive control that the hostile script ran |
| 2 | `hierarchy.spec.ts:606` | P1 | keyboard menu assertion can be satisfied by the never-closed pointer menu |
| 3 | `workspace-tabs-folder.spec.ts:92` | P2 | reload depends on the tab presentation write; only `aria-current` precedes it |
| 4 | `editor-offline-media.spec.ts:76` | P2 | `page.close()` after optimistic editor DOM, no editor/durable witness |
| 5 | `database-entry-properties.spec.ts:153` | P2 | property-order write is fire-and-forget; `waitForSynchronized` cannot see it |
| 6 | `database-multi-select-board.spec.ts:184` | P2 | hidden-property write confirmed by nothing before the reload |
| 7 | `database-form-lifecycle.spec.ts:69` | P2 | card conversion confirmed by `aria-pressed` React state, then reload |
| 8 | `block-editor.spec.ts:453` | P2 | context "insert after" never confirmed; typing depends on it |
| 9 | `block-editor.spec.ts:204` | P3 | slash-menu pick confirmed only by the menu closing (+`rich-page`, `editor-suggestion-menu`) |
| 10 | `files.spec.ts:216` | P3 | negative assertion across a reload with no positive anchor |
| 11 | `keyboard-navigation.spec.ts:456` | P3 | `Escape` then a menu action with no closed-menu wait |
| 12 | `database-relations-rollups.spec.ts:509` | P3 | fixed `test-results/` screenshot path, no repaint wait |
| 13 | `page-scroll-restoration.spec.ts:36` | P3 | global `data-sync` used where the editor settle is the specific witness |
| 14 | `page-links.spec.ts:493` | P3 | document write waited on through the global queue snapshot |

---

## file-preview.spec.ts:203 — script inside a previewed file cannot read the page around it

2. **Verbatim snippet:**
```
    await page.waitForTimeout(1000);
    expect(stolen).toEqual([]);
```

3. **In flight:** the sandboxed `<iframe srcdoc/blob>` of the SVG has not necessarily parsed and
   executed its inline `<script>` when the `file-preview` *element* is visible. The assertion is about
   an event (`window.parent.postMessage`) produced by that script inside the child document.
4. **Signal used:** elapsed time plus the parent element's visibility (`file-preview.spec.ts:198`).
   Element visibility proves the iframe box exists, not that the child document ran. Nothing in the
   test ever proves the hostile script executed.
5. **Real precondition:** the child document must have finished loading (script executed) *and* any
   resulting message must have been dispatched to the parent listener before "no message" can be read
   as "the sandbox held".
6. **Real signal:** (a) a positive control — `HOSTILE_SVG` should post an unconditional
   `{probe: "started"}` **before** `window.parent.document.body.innerHTML`, and the test should assert
   that marker arrived (cross-origin `parent.postMessage` is allowed, so a blocked read still yields
   the marker); (b) the load barrier — `page.on("framenavigated")` for the blob/`srcdoc` frame followed
   by `frame.waitForLoadState("load")` (or an `onload` handler installed before the click that resolves
   through `exposeFunction`); then `expect.poll(() => stolen.length).toBe(0)` for the settle window
   instead of a sleep.
7. **Severity:** P1 — this is the security proof of feature 005's one dangerous boundary, and it is a
   pure negative assertion with no positive control: any regression that stops the preview frame from
   executing (rendering SVG as `<img>`, refusing `blob:` frames, a load failure) leaves the test green
   while the property it claims to prove was never exercised.
8. **Confidence:** static-only.

## hierarchy.spec.ts:606 — opens the same item actions from right click and the keyboard

2. **Verbatim snippet:**
```
    await page.keyboard.press("Escape");
    await expect(page.getByTestId(`rename-${item}`)).toBeVisible();   // line 606
```

3. **In flight:** nothing durable — this is a UI-state defect. The first context menu (opened by
   `row.click({button:"right"})` at line 600) is dismissed at 602 with `Escape`, and nothing waits for
   it to be gone.
4. **Signal used:** the same `rename-<item>` menu item being visible. A menu that never closed
   satisfies it identically to a menu reopened by `Shift+F10`.
5. **Real precondition:** the pointer menu must be closed (or otherwise unambiguously dismissed)
   before the keyboard gesture starts, and the second assertion must be tied to something only the
   keyboard path produces.
6. **Real signal:** assert the menu is gone first — `await expect(page.getByRole("menu", { name: "Actions pour " + item })).toBeHidden()` (the sibling `mcp`/`block-editor` journeys already do this), or focus
   a known row and assert `getByRole("menuitem").first()` is focused, which only the keyboard-opened
   menu does.
7. **Severity:** P1 — the behaviour under test ("the same actions open from right click *and* the
   keyboard") can regress on the keyboard half while this stays green. Low likelihood (the intervening
   `row.focus()` normally dismisses) but the assertion is non-discriminating by construction.
8. **Confidence:** suspect.

## workspace-tabs-folder.spec.ts:92 — keeps tabs, a deep path and folder ordering coherent at desktop and phone widths

2. **Verbatim snippet:**
```
  await expect(leafTab).toHaveAttribute("aria-current", "page");
  await page.reload();
```

3. **In flight:** the device-ergonomics presentation record (open tab ids / active tab), persisted by a
   separate write outside the atomic mutation transaction — the exact class of the proven reference
   case (`lastVisitedItemId`).
4. **Signal used:** `aria-current="page"` on the tab — i.e. React state. `workspace-shell.spec.ts:271`
   demonstrates the project's own answer to this exact record: it polls
   `storedPresentationState(page)` (an IndexedDB read of the `meta`/`navigation-state` row) before
   reloading. Here nothing of the kind precedes the reload, and there are two history navigations
   (`goBack`/`goForward`, lines 88–91) immediately before it.
5. **Real precondition:** the tab record for this navigation must be committed to IndexedDB.
6. **Real signal:** read the persisted tabs record back before reloading (reuse the
   `storedPresentationState` pattern; it reads `meta` → `navigation-state`, and the same store holds the
   open-tabs fields), or assert a `data-tabs-durable`/`data-presentation-state` attribute the producer
   would have to expose. No such attribute exists today → *must be exposed by* the navigation-state
   writer, or read the store directly as `workspace-shell` already does.
7. **Severity:** P2 — false red on a correct application (the reload restores the previous tab).
8. **Confidence:** static-only.

## editor-offline-media.spec.ts:76 — a file dropped offline becomes a durable reference with an honest transfer state

2. **Verbatim snippet:**
```
    await page.close();
    const restarted = await context.newPage();
```

3. **In flight:** the editor's local commit of the two dropped blocks (image + file) and the
   `pendingFileTransfers`/`pendingFileTransferChunks` queue rows. The drop is dispatched as a synthetic
   `DragEvent` (lines 46–61) and then only the *rendered* blocks are asserted (lines 62–72).
4. **Signal used:** `.editor-image-block` / `.editor-file-block` visible, `.editor-file-state` text.
   Those are BlockNote DOM nodes; the comment in `page-editor.tsx` ("Dropped or pasted bytes are
   encrypted durably before the block commit") is about ordering, not about the DOM already being
   committed. `page.close()` is the harshest boundary in the suite.
5. **Real precondition:** the drop's blocks and their transfer rows must be durable before the only
   page is closed.
6. **Real signal:** `waitForEditorSettled(page, { afterApplyCount })` (or `saveDocument(page)`, which
   waits on `data-durable="true"` and works offline) measured against a pre-drop
   `editorApplyCount(page)` baseline — both already imported-capable from `helpers.ts`; the
   `applyCount` baseline is the specific witness for *this* drop, per `block-editor.spec.ts:246–248`.
7. **Severity:** P2 — false red; the post-restart assertions are genuine durability checks (the API is
   still aborted), so the defect is only the missing wait.
8. **Confidence:** static-only.

## database-entry-properties.spec.ts:153 — configures entry properties directly, shares symbols, and preserves independent property order

2. **Verbatim snippet:**
```
  await waitForSynchronized(page);   // 153
  …
  await page.reload();               // 165
```

3. **In flight:** the entry property *order* write. The drag is applied by
   `entry-property-list.tsx:485`: `void edit?.((d) => reorderEntryProperties(...)).catch(() => undefined)`
   — a fire-and-forget async definition mutation.
4. **Signal used:** `waitForSynchronized` — a global durable-queue snapshot. Because the handler returns
   before `edit` dispatches, the poll can read `synced` while this reorder has not been enqueued at all
   (mechanism 3 above). The test *does* use the specific witness elsewhere — `waitForEntryAutosave` at
   line 109 — and skips it exactly where a reload follows.
5. **Real precondition:** the reorder must be acknowledged before the panel is closed and the page
   reloaded.
6. **Real signal:** `waitForDatabaseDefinitionSaved(page)` (`data-definition-state` leaves `saving`,
   then the queue drains) — this is a definition write, not an entry-value write, so the
   `data-definition-state` attribute (`database-page.tsx:1112`) is the correct one; `waitForEntryAutosave`
   is the fallback for the earlier value edits. Belt and braces: assert the row order flip first (it
   only lands after the atomic commit) and *then* the definition save.
7. **Severity:** P2 — false red at line 165's reload (the order comes back in its old arrangement).
8. **Confidence:** static-only.

## database-multi-select-board.spec.ts:184 — multi-select Kanban preserves other memberships across moves, hidden axis, reload and offline

2. **Verbatim snippet:**
```
  await waitForSynchronized(page);   // 184
  await page.reload();               // 185
```

3. **In flight:** the view's hidden-property presentation write. `Masquer Matières` calls
   `onToggleProperty` → `setColumnVisible` (`database-container-page.tsx:895`) → `void save({...})` →
   `await service.mutate("database.presentation.replace", …)`.
4. **Signal used:** `waitForSynchronized` started right after `settings.getByRole("button",{name:"Fermer"})`
   — i.e. after an async, fire-and-forget write whose dispatch may not have happened yet.
5. **Real precondition:** the visibility change must be acknowledged.
6. **Real signal:** the control flipping to `Afficher Matières` (only after the commit), then
   `waitForDatabaseDefinitionSaved(page)`.
7. **Severity:** P2 — false red when the reload restores the column and the grouping assertion that
   follows changes shape.
8. **Confidence:** static-only.

## database-form-lifecycle.spec.ts:69 — converts a card without editorial history locally while workspace requests are held

2. **Verbatim snippet:**
```
  await waitForSynchronized(page);   // 69
  await page.reload();               // 70
```

3. **In flight:** the conversion back to `Page` (line 63) — a mutation, but the confirmation asserted is
   the segmented control's own React state (`aria-pressed="true"`), which is the optimistic layer, not a
   projection row.
4. **Signal used:** `aria-pressed` then a global queue snapshot. The same file shows the intended
   pattern at lines 46–54: it proves the request was actually attempted (`expect.poll(() => held)
   .toBeGreaterThan(0)`) — a real, specific witness — and then drops it for the second conversion.
5. **Real precondition:** the `item.convert` mutation for this card must be acknowledged.
6. **Real signal:** the card/row kind (`.database-card` grouping or the tree row's
   `data-item-kind`, which is projection-derived) flipping *and* `waitForSynchronized`; or intercept the
   `/v1/mutations/batch` response for this command as `renameItem()` does (`helpers.ts:773–808`).
7. **Severity:** P2 — false red at the reload (`aria-pressed` reads `Page` from the restored record, so a
   lost write shows as a wrong value).
8. **Confidence:** static-only.

## block-editor.spec.ts:453 — is shown as unrenderable and kept unchanged through an edit

2. **Verbatim snippet:**
```
    await page.getByTestId("context-insert-after").click();
    await surface(page).pressSequentially("a paragraph beside it");
```

3. **In flight:** the block insertion requested by the context-menu item; the block count
   (`rootBlocks(editor)`) is never re-read, unlike every other insertion in the file (`appendParagraph`
   asserts `toHaveCount(previousCount + 1)`).
4. **Signal used:** none. The click is confirmed by nothing; the following `pressSequentially` is a
   promise that the editor is now in a new empty block.
5. **Real precondition:** a new block must exist and be focused before text is typed into it.
6. **Real signal:** the same contract `appendParagraph` uses — `toHaveCount(previous + 1)` plus
   `data-content-type="paragraph"` on the new block — followed by `waitForEditorSettled(page,
   { afterSequence })` so the paragraph is durable when `saveDocument(until:"synced")` runs.
7. **Severity:** P2 — two-sided: a false red if the text lands in the unknown block (then the stored
   block no longer equals `unknownBlock`), and a silent false green for the stated intent ("autosave
   makes the edit durable") because the test never asserts the new paragraph reached the server.
8. **Confidence:** static-only.

## block-editor.spec.ts:204 — inserts and transforms five durable block types through distinct paths

2. **Verbatim snippet:**
```
    await expect(slashMenu).toBeHidden();     // 204
    …
    await expect(dividerMenu).toBeHidden();   // 213
    await expect(addMenu).toBeHidden();       // 224
```

3. **In flight:** the transform/insertion the picked option performs in the editor document.
4. **Signal used:** the slash menu closing. A menu closes on selection whether or not the command
   applied.
5. **Real precondition:** the chosen block type must be in the editor before the next gesture.
6. **Real signal:** already present a few lines later in each case — `inlineContent(quoteBlock)
   .toHaveJSProperty("tagName","BLOCKQUOTE")` (207), `editor.locator("hr")` (214),
   `checkBlock.locator('[data-content-type="checkListItem"]')` (227–229). The pattern is right; the
   intermediate `toBeHidden()` is not what proves it. (`rich-page.spec.ts:74` and `:92`,
   `editor-suggestion-menu.spec.ts:78` are the same shape; `editor-suggestion-menu.spec.ts:79` and
   `rich-page.spec.ts:114` do supply the real signal immediately after.)
7. **Severity:** P3 — style; the shape invites a copy where the follow-up real assertion is omitted
   (which is what happened at `block-editor.spec.ts:453`).
8. **Confidence:** static-only. Note: a structurally identical failure ("element(s) not found" for the
   toggle control right after the slash-menu pick in `rich-page.spec.ts:35`) does appear in the evidence
   logs (run `43392306416`, job `131779147516`, `chromium-mobile`), but at an earlier tree.

## files.spec.ts:216 — the attachment disappears from the page when its block is removed

2. **Verbatim snippet:**
```
    await page.reload();                                   // 216
    await openWorkspace(page);
    await openPageAttachments(page, pageName);
    await expect(row).toHaveCount(0);                      // 219
```

3. **In flight:** not a specific write — the problem is the assertion shape. Everything after the reload
   is a *negative* assertion (`toHaveCount(0)`), with no positive anchor on the same surface.
4. **Signal used:** absence. Absence is also what a not-yet-projected attachment panel shows.
5. **Real precondition:** the attachment panel for this page must have finished projecting its rows.
6. **Real signal:** a positive anchor for the same projection — `expect(page.getByTestId(
   "attachments-empty")).toBeVisible()` (which the pre-reload half already uses at line 210) — before or
   together with the count assertion.
7. **Severity:** P3 — a wrong result could pass while a projection late in loading.
8. **Confidence:** static-only.

## keyboard-navigation.spec.ts:456 — unmarking clears the favourite action

2. **Verbatim snippet:**
```
    await page.keyboard.press("Escape");
    await clickItemAction(page, name, `favourite-action-${name}`);
```

3. **In flight:** nothing durable; UI state. `clickItemAction` → `openItemActions` clicks the row's
   trigger, and if the menu never actually closed on `Escape` that click *closes* it, after which
   `expect(menu).toBeVisible()` inside `openItemActions` fails after its budget.
4. **Signal used:** none between the key and the click.
5. **Real precondition:** the first menu must be closed before the trigger is clicked again.
6. **Real signal:** `await expect(page.getByRole("menu", { name: "Actions pour " + name })).toBeHidden()`
   before reopening (the same file does exactly this at 240–243).
7. **Severity:** P3 — produces a confusing false red rather than a wrong pass.
8. **Confidence:** static-only.

## database-relations-rollups.spec.ts:509 — a two-way relation shows on both sides and reads the same link

2. **Verbatim snippet:**
```
    .screenshot({ path: "test-results/057-pair-active.png" });
```

3. **In flight:** the dark-theme repaint triggered two lines above by `page.emulateMedia({colorScheme:
   "dark"})`; the previous screenshot (509) is taken immediately after a settings mutation.
4. **Signal used:** none — no `data-theme` assertion, no animation-settled poll (the file's own
   `closeConfiguration` shows the pattern it should use). The path is also a *fixed* `test-results/`
   path rather than `testInfo.outputPath(...)`, so projects and parallel workers overwrite each other
   and the artifact is never attached to the report.
5. **Real precondition:** the theme change must have repainted, and the file path must be per-test.
6. **Real signal:** `await expect(page.locator("html")).toHaveAttribute("data-theme","dark")` plus a
   poll that no transition is running (`getAnimations().every(a => a.playState !== "running")`), and
   `testInfo.outputPath(...)` + `testInfo.attach(...)`.
7. **Severity:** P3 — evidence quality only; nothing is asserted on the pixels.
8. **Confidence:** static-only.

## page-scroll-restoration.spec.ts:36 — coming back to a long page restores the remembered neighbourhood

2. **Verbatim snippet:**
```
    await expect(status).toHaveAttribute("data-sync", "synced", { timeout: 30_000 });
```

3. **In flight:** the last paragraph's local commit (32 `pressSequentially` rounds); the test then
   navigates away (line 95) and back, and requires the block identity it recorded to survive.
4. **Signal used:** `[data-testid="editor-sync-status"] data-sync="synced"` — a global transport
   frontier, not the last transaction. `data-editor-settled`/`data-editor-change-sequence` is the
   correlated witness and is available on the same page.
5. **Real precondition:** every typed block is durable before leaving the page.
6. **Real signal:** `waitForEditorSettled(page)` (`helpers.ts:1605`) after the final keystroke — the
   file is one call away from it.
7. **Severity:** P3 — the 32 sequential rounds make a stale pass unlikely, and the recovered assertion is
   about geometry rather than the text.
8. **Confidence:** static-only.

## page-links.spec.ts:493 — /page creates one linked subpage under the current page

2. **Verbatim snippet:**
```
  await waitForSynchronized(page);   // 493
  await page.reload();               // 495
  …
  await expect(pageLinks(page)).toHaveCount(1);
```

3. **In flight:** two different writes — the `item.create`-style mutation for the sub-page (atomic, so
   the queue snapshot does correlate) and the *editor block* that carries the `#page=` link, which is a
   page-content write through the editor batcher.
4. **Signal used:** a global queue snapshot for a document write.
5. **Real precondition:** the page document holding the link must be durable.
6. **Real signal:** `saveDocument(page, { until: "synced" })` (or `waitForEditorSettled`) for the
   document, alongside `waitForSynchronized` for the creation.
7. **Severity:** P3 — the creation half is well covered; only the document half is weakly witnessed.
8. **Confidence:** static-only.

---

## The four `waitForTimeout` calls

`grep -rn "waitForTimeout" tests/` returns exactly four. Two are in my file scope.

### 1. `file-preview.spec.ts:203` (in scope) — P1
Assessed as its own finding above. Replacement: frame-load barrier + positive control, then poll the
recorded messages. A fixed second cannot be right for a *negative* security assertion, because it fails
open.

### 2. `save-state.spec.ts:75` (outside my file scope; assessed on request) — P2
```
      await page.waitForTimeout(2_000);
      await expect(indicator(page)).not.toHaveAttribute("data-sync", "synced");
```
The test wants "the interface had every chance to be wrong" before asserting it is not. Elapsed time is
not a state. Real signal: the durable-queue snapshot itself must be non-synced while the server is
unreachable — `expect.poll(() => page.evaluate(() => window.__MYOWNNOTION_E2E_LOCAL_CONTENT__?.()
.getSnapshot().syncState)).not.toBe("synced")` — plus `pendingCount > 0` (proving the write was queued),
plus the already-present `data-durable="true"`. That trio is the honest "would-lie-if-it-could"
precondition, and it is a *state*, not a delay. The negative assertion can be made durable by
observing a failed sync attempt (`page.on("requestfailed")` for `/v1/mutations/batch`) before checking
the label.

### 3. `save-state.spec.ts:142` (outside my file scope; assessed on request) — P2
```
    await page.waitForTimeout(400);
    await page.reload();
```
The comment says the session's Dexie transaction resolved and engines differ in when write-back is
flushed. A sleep after `saveDocument` is a guess about the engine, and it is also *not* the boundary
the comment describes. Real signal: read the committed document back from IndexedDB before reloading —
`window.__MYOWNNOTION_E2E_LOCAL_CONTENT__().getItem(itemId)` returns `pageDocument`, so
`expect.poll(async () => JSON.stringify((await …getItem(id))?.pageDocument)).toContain("typed before the
crash")` proves the durable record exists and lets the reload follow immediately. (This is the same
"read the store back" pattern `workspace-shell.spec.ts:143` already implements.)

### 4. `offline-availability.spec.ts:158` (outside my file scope; assessed on request) — P2
```
      await page.getByTestId("storage-limit").selectOption(String(1024 * 1024 * 1024));
      await page.waitForTimeout(500);
      await returnToWorkspace(page);
```
The `storage-limit` control is a controlled `NativeSelect` (`apps/web/src/features/files/
storage-panel.tsx:109`) disabled while `busy`, and `setLimit` awaits `writeLimit(...)` then
`refresh()`. Real signal: `await expect(page.getByTestId("storage-limit")).toBeEnabled()` (the write
finished and the panel re-measured — `busy` false), plus
`await expect(page.getByTestId("storage-limit")).toHaveValue("1073741824")` and
`await expect(page.getByTestId("storage-usage")).toContainText("1 GB")` to prove the persisted limit was
read back. All three are synchronous consequences of the acknowledged write.

---

## OK (verified waits)

These were inspected and are genuine proofs; they are recorded so the same work is not redone and so the
good patterns are visible.

1. **`saveDocument` / `waitForEditorSettled` are revision-correlated** (`helpers.ts:1605`, `:1745`).
   `page-editor.tsx:810` flips `data-editor-settled="false"` synchronously from `onBeforeInputCapture`,
   and `applyLocalChanges` does the same for non-input transactions, so the "settled" attribute cannot be
   a stale pass for a gesture that already happened. `helpers.ts:1610–1625` even accepts
   `afterApplyCount`/`afterSequence` baselines and `typeIntoEditor` uses them. Sites that use this
   correctly: `block-editor.spec.ts:246–248` (apply-count witness for the duplicate), `:402`,
   `rich-page.spec.ts:128`, `code-block-ui.spec.ts:145`, `page-links.spec.ts:122/150/416`,
   `databases-pages-views.spec.ts:318–320`, `narrow-viewport.spec.ts:105`.
2. **`waitForSynchronized` after a UI mutation** (`helpers.ts:1371`) is a real correlate because
   `apply-local-mutation.ts` commits the projection and the outbox row in one IndexedDB transaction, so
   the projection cannot lead the queue. Verified spots: `hierarchy.spec.ts:133–141` (the DOM order is
   asserted *before* the sync — the file's own comment explains why), `:100`, `:118`, `:151`,
   `item-conversion.spec.ts:44–54` (`convertAndSettle`), `:201`, `workspace-shell.spec.ts:269`,
   `keyboard-navigation.spec.ts:280`, `database-multi-select-board.spec.ts:132`,
   `database-page-flow.spec.ts:236`, `databases-views.spec.ts:264→266`,
   `security-content-regression.spec.ts:41/62/90`, `files.spec.ts:366`, `touch-and-motion.spec.ts:83`.
3. **Creation + rename before a reload is durability-proof** when the tree row carries the new name:
   `titleEditingProps.onCommit` awaits `renameSelectedItem`, and only the *inline tree* rename is
   optimistic (`pendingTreeNames`). `nameNewlyCreatedItem` (`helpers.ts:583`) asserts the tree row, which
   is projection-derived, so `createRootItem`/`createChildItem` returning is a durable creation.
   Consequently `workspace-shell.spec.ts:332`, `hierarchy.spec.ts:359–360`, `routing.spec.ts:45/135`,
   `desktop-onboarding.spec.ts:59–61`, `desktop-offline-restart.spec.ts:55–68` and
   `desktop-device-revocation.spec.ts:35–49` are OK (the last one additionally snapshots the encrypted
   outbox through `desktopOutbox`, which is the model to copy).
4. **`workspace-shell.spec.ts:142–162/271–278`** — reads the durable presentation record from IndexedDB
   and polls it before reloading. This is the reference solution for the class the brief describes, and it
   is the pattern `workspace-tabs-folder.spec.ts:92` should reuse.
5. **`workspace-shell.spec.ts:206–208`** — `expect.poll(storedPresentationState).toMatchObject({sidebarOpen:
   false})` before `reload()`; the CSS transitions in the same test are frozen and sampled with
   `triggerAndSampleCssTransition` (`helpers.ts:223`), never with a sleep. Same for
   `hierarchy.spec.ts:387–409` (transition sampled at a seeked midpoint) and `:54–59` (animations
   settled polled via `getAnimations()`).
6. **`database-relations-rollups.spec.ts`** — `pickRelation`/`unpickRelation`/`chooseSum` poll the
   *outcome* (the pill's text, the trigger's text) while retrying the gesture, which is the right answer
   for a menu that re-renders under the pointer; `openPropertyConfiguration` (`:56–73`) waits the flyout
   out before using the property editor; `:369` uses `waitForEntryAutosave(page, {synchronize:false})`
   before reading derived values offline, and `:332/444` use it before the reloads at `:374` and `:454`.
7. **`v1-surface-visuals.spec.ts:70/106/148` and `workspace-shell-visual.spec.ts:164/180`** —
   `toHaveScreenshot` with `animations: "disabled"` (finite CSS animations are fast-forwarded, infinite
   ones cancelled) plus an explicit `settlePixels` / `document.fonts.ready` / `scrollY === 0` barrier, and
   every preceding write is waited on specifically (`waitForSynchronized` at
   `v1-surface-visuals.spec.ts:53`, `waitForDatabaseDefinitionSaved` at `:90`, `data-theme` assertions,
   `hoverContextualRowWithoutShift`'s opacity poll). No stale or mid-animation frame can pass here that I
   could construct.
8. **`editor-performance.spec.ts`** — the only elapsed-time constructs are inside the measured window
   (`KEYSTROKE_SETTLE_MS`, documented) and are part of the measurement, not a substitute for a signal;
   the seeded document is created through the API and pulled with `page.reload()` +
   `waitForSynchronized` before the clock starts (`:70–72`, `:102–104`).
9. **`editor-math-contents.spec.ts:302–310`** — the caret contract is stated deliberately without a wait
   ("No click, no polling") and asserts the typed text; `:70–71`, `:91–92` reload only after
   `saveDocument(until:"synced")`; the offline branch (`:94–96`) needs no durability.
10. **`desktop-device-revocation.spec.ts:41–52`** — the pending work is proven with `desktopOutbox(page)`
    (a real read of the `outbox` object store) before revocation, and compared afterwards; that is the
    existing signal every desktop finding should use.
11. **`database-multi-select-board.spec.ts:210–222`** and `:127–132` — the offline card moves go through
    `runAction`/`service.mutate` (the card carries `aria-busy` while pending), i.e. below the code is
    atomic, so the queue snapshot before the reload is legitimate.
12. **`code-block-ui.spec.ts:263–274`** — the offline language change is confirmed by an optimistic
    label, but `saveDocument(page)` follows and a language change is a document transaction, which trips
    `markEditorActivity` synchronously; the offline reload assertion is therefore sound. `:104`'s
    `Escape` before the theme loop and `:200`'s status assertions are UI-only.
13. **`editor-offline-media.spec.ts:141–154`** — the upload completion is proven by counting real
    `POST /v1/uploads` requests and by the `PATCH … 201` bodies with their `itemId`s, not by the
    `data-state="synchronized"` label alone. That is the correct shape; the defect in the file is only
    the `page.close()` at `:76`.
14. **`mcp-access.spec.ts:151`**, **`protected-files.spec.ts:101`**, **`authentication.spec.ts:93/269/327`**,
    **`bootstrap.spec.ts:59/150/161`**, **`accessibility.spec.ts:468`** — reloads there depend on server
    state (the API row is re-read) or are preceded by the specific witness
    (`waitForEntryAutosave` at `accessibility.spec.ts:462`, before the reload at `:468`); no page-local
    durability assumption.
15. **`item-conversion.spec.ts:370–385`** — the offline conversion is confirmed by `data-item-kind` on the
    tree row, which is projection-derived and therefore a durability witness (mechanism 1), and the
    post-reload `waitForSynchronized` at `:383` requires the queued conversion to be *accepted* by the
    server before the final assertion runs. `convertAndSettle` (`:44–54`) is the same shape and is used by
    every other conversion journey in the file.
