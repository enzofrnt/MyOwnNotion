# Validation: Tests Wait for States, Not for Time

Status of every audited site (`docs/audits/2026-11-wait-contracts/INVENTAIRE.md`,
ids `W-xx`) on branch `test/060-wait-contracts`, from `main` `0679cdeb`.

Confidence carried over from the audit: **proven** (CI trace or reproduction),
**ci** (a CI failure attributable to the behaviour), **static** (code reading).
Treatment: **fixed** (witness replaced), **covered** (made correct by a shared
witness), **verified** (read again, already sound, no change), **limit** (not
fixed, recorded with the reason).

## P1

| id | Site | Conf. | Treatment |
| --- | --- | --- | --- |
| W-01 | `page-multi-device-convergence.spec.ts` restart after a selection | proven | fixed — `expectNavigationPersisted` before `page.close()`; sensitivity in `wait-witnesses.spec.ts` (aborted write fails with its message; resolution after the transaction's `complete`) |
| W-02 | `conflict-resolution.spec.ts:96` "no conflict when it catches up" | static | fixed — the first device's text is applied on the second and its post-reload pass is synchronized before "no conflict" is read (assertion strengthened) |
| W-03 | `offline-availability.spec.ts` lowered limit | static | fixed — sleep replaced by the re-measured committed limit (`1024.0 MiB`, control re-enabled); the comment no longer claims an eviction pass runs (D-B) |
| W-04 | `file-preview.spec.ts` hostile SVG | static | fixed — the file posts `attempted` after its read attempt; the journey waits for it, then reads `stolen` (a script that never ran now fails) |
| W-05 | `hierarchy.spec.ts:606` right click then Shift+F10 | static | fixed — the pointer menu is proved closed before the keyboard path |
| W-06 | `synchronize-serialization.spec.ts` two 50 ms sleeps | static | fixed — waits for the held pass in the transport; mutation (coalescing disabled) makes test 1 fail (3 passes ≠ 2). Limit: test 2 detects a concurrent late pass only if it overlaps |
| W-07 | `database-page-interaction.spec.tsx` icon picker re-click loop | ci | fixed — root cause found: the nested picker was opened before the settings panel had taken focus; the panel's open-focus then closed it. The test now waits for focus inside the panel and clicks once |

## P2

| id | Site | Conf. | Treatment |
| --- | --- | --- | --- |
| W-08 | `workspace-tabs-folder.spec.ts:92` reload after tab click | static | fixed — `expectNavigationPersisted({ lastVisited, openTabsInclude })` |
| W-09 | `editor-offline-media.spec.ts:76` close after offline drops | static | fixed — `saveDocument` (editor settled, locally durable) before the abrupt close |
| W-10 | `database-entry-properties.spec.ts` property reorder | static | fixed — `beginDefinitionChange` / `.committed()` |
| W-11 | `database-multi-select-board.spec.ts:184` hidden property | static | fixed — `beginDefinitionChange` around the presentation write |
| W-12 | `database-form-lifecycle.spec.ts:69` kind selector | static | fixed — `expectItemKind` (committed kind) before reload |
| W-13 | `block-editor.spec.ts:453` insert after unknown block | static | fixed — block count +1 and editor focus before typing |
| W-14 | `page-ambiguity.spec.ts:125` deletion first | static | fixed — the deleting device's page frontier is `synced` (server confirmed), not merely "not offline" |
| W-15 | `offline-availability.spec.ts:89` marked branch | static | fixed — `expectCommittedItemField(folder, "offlineIntent", true)` before the queue wait |
| W-16 | `databases-offline-sync.spec.ts:347,390` remote cell edits | static | fixed — `beginEntryChange` (entry `valueVersion`) before the queue wait |
| W-17 | `revision-restore.spec.ts:30` current head | static | verified — the head is read after a correlated queue drain of an atomic creation; a non-canonical id would make the server preview fail loudly (false red only) |
| W-18 | `save-state.spec.ts:142` 400 ms before reload | static | fixed — sleep removed; `data-durable` is the committed frontier. WebKit desktop and mobile 10/10 without it |
| W-19 | `legacy-sync-self-healing.spec.ts:52` | static | covered — `createRootItem` now waits for the committed item, which makes the per-page queue wait correlated |
| W-20 | `page-autosave-recovery.spec.ts:41,74` optional durable check | static | fixed — the durable acknowledgment is required unconditionally |
| W-21 | `database-form-lifecycle.spec.ts:143` new property | ci | fixed — `beginDefinitionChange` / `.committed()` before `waitForDatabaseDefinitionSaved` |
| W-22 | `database-relations-rollups.spec.ts:509` dark capture | static | fixed — `testInfo.outputPath` and `data-theme` switched before each capture |
| W-23 | `workspace-tabs-folder.spec.ts:260` keyboard drag announcement | ci | limit — no reliable signal that dnd-kit measured its droppables was found; a candidate (pick-up announcement) did not appear and was withdrawn |
| W-24 | `page-protocol-migration.spec.ts:219` | ci | verified — the CI failure predates the narrow WebKit "access control checks" filter now present; remaining checks are correlated |
| W-25 | `entry-property-interaction.spec.tsx` 24 sleeps | ci | fixed — `until` on the element or call each step needs; focus return awaited explicitly |
| W-26 | `legacy-page-editing-session.spec.ts:408` 300 ms | static | fixed — owned `setTimeout` clock advanced past the 5 s maximum backoff; mutation (always retry) fails the test |
| W-27 | `legacy-page-editing-session.spec.ts:329` | static | fixed — owned clock past every backoff before "not converted" |
| W-28 | `page-operations.integration.spec.ts:352` row lock | static | fixed — the second transaction is proved waiting in `pg_locks` |
| W-29 | `table-scroll-observer.spec.ts:49` | ci | verified — already fixed in `0679cdeb` (touch gesture, fake timers) |
| W-30 | `projection-refresh.spec.ts` microtask `advance()` | static | fixed — `readsStarted(load, n)` |
| W-31 | `client-lifecycle.integration.spec.ts:58` | static | fixed — pool `ended` observed, then a macrotask drains promise-only continuations |
| W-32 | `operational-page-opening.spec.ts:877` `?? Infinity` | static | fixed — `checkpoint` and `getItem` must have been called; order compared on real call indices |
| W-33 | `operational-page-opening.spec.ts:491` | static | limit — "conversion does not overtake activation" still read one microtask after the call; no seam found |
| W-34 | `database-page-interaction.spec.tsx:210,234,242` | static | fixed — `until` on the source title and tab |
| W-35 | `board-card-editor.spec.tsx` 15 ms `pause` | static | fixed — `drainPromiseWork` (code under test schedules no timers) |
| W-36 | `sidebar.spec.ts:59` UUIDv7 across 2 ms sleeps | static | fixed — identifiers minted at explicit instants (`generateUuidV7(now)`) |
| W-37 | `relation-value-menu.spec.tsx:126` 10 s bound | ci | fixed — `until` (flushes React each attempt); bound back to the default |

## P3

| id | Site | Treatment |
| --- | --- | --- |
| W-38 | slash menu choices | fixed for `block-editor` (quote) and `rich-page` (callout, toggle): the inserted block is asserted before typing. `editor-suggestion-menu:78` verified (asserts the table cells) |
| W-39 | `files.spec.ts:216` | fixed — editor removal committed and synchronized; positive "empty list" anchor after reload |
| W-40 | `keyboard-navigation.spec.ts:456` | fixed — menu proved closed before reopening |
| W-41 | `page-scroll-restoration.spec.ts:36` | fixed — `saveDocument({ until: "synced" })` unconditionally |
| W-42 | `page-links.spec.ts:493` | fixed — parent document committed and synchronized before reload |
| W-43 | `offline-reconciliation.spec.ts:68` | covered — offline creation now proved committed by `createRootItem` |
| W-44 | `save-state.spec.ts:75` 2 s window | fixed — full `data-sync` history from the offline state to a positive end anchor |
| W-45 | `save-state.spec.ts:219` | fixed — same history, window closed on the server's `sync-problem` frame. Observation: a rotation-blocked write is refused as `realtime.internal-error`, not as a specific blocked reason |
| W-46 | `interrupted-mutations.spec.ts:86` | verified — trailing wait with no dependent step |
| W-47 | `live-sync.spec.ts:54` | covered — creation committed before the queue wait; the propagation assertion is unchanged |
| W-48 | `local-content-realtime-sync.spec.ts:211` | verified — coalescence is proved by the final pass count and peak concurrency |
| W-49 | `database-view-loading.spec.tsx` `advance()` | fixed — named `drainPromiseWork` over mocked services |
| W-50 | `emoji-picker.spec.tsx:175` 100 ms | fixed — `until` the picker is closed |
| W-51 | `group-editor.spec.tsx:93`, `database-board-interaction.spec.tsx:95` | fixed — `until` on the menu and its item |
| W-52 | `search-index.spec.ts:69` vacuum | fixed — owned clock, `runAllTimersAsync` |
| W-53 | `map-view-states.spec.tsx:85` | fixed — named `drainPromiseWork` (mocked fetch) |
| W-54 | `app-routing.spec.tsx` 12 zero-delay sleeps | fixed — named `drainPromiseWork` (mocked services) |
| W-55 | `database-page-interaction.spec.tsx:909` | fixed — the refusal message is awaited before the row's absence is read |
| W-56 | `realtime-page-sync.performance.spec.ts:135` | verified — coalescence proved by value (`[10000]`); the duration is the product budget |

## Beyond the audit

- `createRootItem`, `createChildItem`, `createRootDatabase`: wait for one more
  committed item with the name (counted, so deliberate duplicates stay valid).
- `apps/api/tests` (not in the audit's scope): `key-rotation-policy` (next
  evaluation logged), `database-security` and `export.contract` (export state
  polled), `realtime-device-revocation` (`pg_locks`), `tests/contract/export`;
  `production-startup` (bounded `pg_locks` poll) and `realtime-page-sync`
  (negative window, limit) are declared timers.
- `navigation-item-menu`, `page-attachment-panel`, `database-card-inline`,
  `recovery-replacement`, `editor-input`: sleeps replaced by `until` or the
  named promise drain.

## Evidence

Recorded in the pull request description and below as runs complete.

## Product defect found by the first CI run

CI run 43751330536 (attempt 1) failed `database-relations-rollups.spec.ts`
« configured relation … 10 + 20 = 30 » on Firefox: `waitForSynchronized`
read `conflict`. The same message had already failed this file on `main`
(runs 43587097289, 43706222653). The CI trace shows the cause: a
`database.presentation.replace` sent with base revision `…73aacfa7` right
after a `database.definition.replace` had moved the server's container head to
`…b781d049`; the server answered `revision.stale-base`.

The server commits every definition change on the container's own source
together with its presentation, at the same revision, with views re-derived
from the definition (`commitDefinitionChange`). The local projection advanced
only the definition, so the next view edit started from a stale presentation
revision. `apply-to-projection.ts` now mirrors the server. The unit test
"advances the container's presentation with a definition change, like the
server" fails without the fix. Acknowledgement already remaps both revisions,
and queued payload bases are rewritten. A definition change on a *secondary*
source does not advance the container locally; that path is unchanged and was
not observed failing.

## Files the audit left to confirm

| File | Use of the clock | Classification |
| --- | --- | --- |
| `packages/database/tests/relation-source-mutation.integration.spec.ts` | `purgeAfter` one day ahead | fixture, ample margin |
| `packages/database/tests/repository-failures.integration.spec.ts` | `purgeAfter` **one second** ahead | fixture depending on runner speed — moved to one day ahead, assertion unchanged |
| `packages/database/tests/restore.integration.spec.ts` | `expiresAt` one minute ahead | fixture, ample margin |
| `packages/database/tests/search-source.integration.spec.ts` | `purgeAfter` one day ahead | fixture |
| `packages/database/tests/uploads.integration.spec.ts` | an upload 48 h old | fixture in the past, the subject is age |
| `apps/web/tests/mcp-access-panel.spec.tsx` | exchange expiry ten minutes ahead | fixture; its expiry cases already use fake timers |
| `packages/domain/tests/lifecycle.spec.ts` | `Date.now()` before `planTrash` with the default clock | the default clock is the subject; asserted with `>=`, not as a wait |
