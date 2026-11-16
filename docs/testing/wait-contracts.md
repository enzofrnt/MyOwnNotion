# Wait contracts: tests wait for states, never for time

Normative for every test in the repository: browser journeys, web and package
unit tests, API and database integration tests, contracts and performance
budgets (feature 060). The audit that motivated it, with the CI evidence, is in
[`docs/audits/2026-11-wait-contracts/`](../audits/2026-11-wait-contracts/README.md).

## The rule

A step may start only on proof, **produced by the code that completes the
operation**, that the precondition it depends on is true.

1. **The proof is the system's state**, not a consequence of it on screen. A
   visible title, `aria-pressed`, a closed menu, a toast or a screenshot shows
   an intent or a rendering; it is not a commit.
2. **The proof is about this operation**: the same item, revision, mutation,
   command type and device. "The queue is empty" proves something only once
   this operation has been seen in it, or was written in the same IndexedDB
   transaction as the state that was observed.
3. **The proof cannot be missed or stale.** Read persistent state (IndexedDB
   through the application's service, an API read, an attribute derived from
   committed state) or compare a monotonic value captured *before* the gesture.
   An event must be listened to before the gesture that produces it.
4. **Time is never proof.** No delay authorizes a next step. Neither does a
   received network response that is not this operation's acknowledgment, nor
   an `idle` state that a gesture which never reached its writer also leaves.
5. **Timeouts are maximum bounds with a diagnostic** naming the missing
   precondition (`expect.poll(..., { message })`, `vi.waitFor`, an `Error`
   text). Raising a bound is not a fix.
6. **When time is the subject** (debounce, backoff, expiry, retention, a
   product latency budget), the test owns the clock: `vi.useFakeTimers` with
   `advanceTimersByTimeAsync`, an injected `now()`, or Playwright's
   `page.clock`. A latency budget asserted with `Date.now()` is allowed only as
   the product requirement itself, never as the wait.

Negative claims ("X never happens") are observed over a window that **starts
before the gesture and ends on a positive proof** that the risky moment is
over, with every intermediate value recorded — not with one look after a delay.

Deliberate races — an abrupt close, a cut network, a concurrent write — stay in
the suite. They are made deterministic with a barrier the test controls (a held
route, a deferred promise in a fake, a transaction aborted by an init script),
never by hoping a few milliseconds fall the right way.

## Signals and their producers

| Sequence | Precondition for the next step | Witness | Producer and moment it becomes true |
| --- | --- | --- | --- |
| Create, rename, move, convert, trash an item | The change is durable and queued | `createRootItem` / `createChildItem` / `createRootDatabase` wait for one more committed item with the name; `expectCommittedItemField`, `expectItemKind` | `apply-local-mutation.ts` commits the projection and the outbox row in one transaction; the read returns after that commit |
| Then reload, close or read on another device | The server accepted it | `waitForSynchronized` **after** one of the witnesses above | the service's aggregate queue state; correlated because the row was proved queued first |
| Device navigation (selection, tabs) before a close, reload or restart | The next boot will read this choice | `expectNavigationPersisted(page, { lastVisited, openTabs, openTabsInclude })` | `hierarchy-explorer.tsx` writes `navigation-state` in `db.meta`; the reader opens a later IndexedDB transaction, so it sees the value only once committed |
| Database schema or view edit | Its definition/presentation revision is committed | `beginDefinitionChange(page, database)` before the gesture, `.committed()` after | `service.mutate("database.*")` advances `definitionVersion` / `presentationVersion` with the outbox row |
| Entry value edit | Its values are committed | `beginEntryChange(page, entry)` before the gesture, `.committed()` after | `valueVersion` of the entry row, written in the mutation transaction |
| Entry panel autosave | This panel's save resolved | `waitForEntryAutosave` (requires `"saved"`, never `"idle"`) | `use-entry-autosave.ts` sets `saved` after `onSave` resolves; prefer `beginEntryChange` where a stale `saved` is possible |
| Editor gesture | The editor committed this burst, locally then remotely | `waitForEditorSettled({ afterSequence \| afterApplyCount })`, `saveDocument(page, { until })` | `page-editor.tsx` marks the editor unsettled synchronously on input; `data-durable` follows the session's committed frontier |
| A refused page send | The server refused this page's sync request | `nextPageSyncProblem(page)` installed before the page opens | a `sync-problem` frame on the `page-sync` WebSocket |
| A value never shown | No intermediate state showed it | `recordAttribute(page, selector, attribute)` from before the gesture, read after a positive end anchor | a `MutationObserver` over the whole document, including remounted elements |
| Menu, popover, dialog | Open and owning focus; closed before the next opener | assert the opened surface (and focus inside a parent popover before opening a nested one); assert the menu item count is 0 after `Escape` | the component's own rendered state |
| Script inside a sandboxed preview | It ran and finished its attempt | a message the file posts after its attempt | the frame's own `postMessage` |
| PostgreSQL lock ordering | The second transaction is waiting | `pg_locks where not granted` | PostgreSQL's lock table |
| React unit tests | The state the next step needs is committed | `until(read)` from `apps/web/tests/support/until.ts` | each attempt runs `act` first, so polls see what React scheduled |
| Promise-only fakes | Every continuation ran | `drainPromiseWork()` | a zero-delay task runs after the microtask queue is empty; only valid when the code under test schedules no timers, frames or IndexedDB requests |

The E2E witnesses live in `tests/e2e/waits/` (`local-state.ts`,
`observation.ts`). `tests/e2e/wait-witnesses.spec.ts` proves that the
navigation witness fails, with its diagnostic, when the write is aborted inside
its own transaction, and that it resolves only after that transaction's
`complete` event.

## Writing a new test

Before each step that depends on an asynchronous operation, answer:

1. Which operation must have finished?
2. What state is true only once it has, and who writes it?
3. Is that state about this operation (identity, revision, captured counter)?
4. Could it already be true before the gesture, or be an event already gone?
5. If the journey interrupts the operation on purpose, what barrier makes the
   interruption land at a chosen point?
6. What injection would make this wait fail? (Delay or abort the operation;
   the test must go red with the witness's message.)

If no existing witness answers 2–4, expose a reading of real state through the
application's service (as `listActiveItems`, `listDatabases`,
`getDatabaseEntry` and `db.meta` are read today) rather than an E2E-only flag.

Read [`lessons.md`](lessons.md) first when a journey touches a portalled menu, a
gesture whose meaning depends on where a press lands, or a component that holds
typed text. It records the failures that produced these rules, with their CI
proof, and it is the place to add a new one: an intermittent failure is a
window nobody has proved yet, not noise.

## What is checked automatically

`tests/contract/test-wait-contracts.spec.ts` scans every test root and fails
on `waitForTimeout` and on any awaited `setTimeout` sleep with a non-zero
delay. The few legitimate timers (bounded fixture reconnection backoff, a
journey's deliberately held server response, keystroke pacing of a latency
measurement, a bounded `pg_locks` poll interval) are declared in that file with
their reason; a declaration whose timer disappears fails too. The contract
cannot see every disguised wait — a review still asks what each wait proves.

## Decisions recorded by feature 060

- **D-A — navigation state.** Spec 003 defines navigation state as presentation
  ergonomics, and FR-009 promises survival of *local edits* after an unexpected
  close. No contract promises that a selection made milliseconds before an
  abrupt close survives. The application keeps writing on change; journeys
  that restart a device wait for `expectNavigationPersisted` first.
- **D-B — local storage eviction.** Spec 005 FR-017 and task T040 require an
  eviction pass at the storage limit, but `runEviction` has no production
  caller. This feature does not wire a data-offloading behaviour to make a
  journey pass. The journey now states that no eviction runs on that path and
  proves what it can (a committed lower limit keeps the unsent edit). Wiring
  FR-017 is a separate product change.
- **D-C — `idle` after a gesture.** `waitForEntryAutosave` requires the save's
  acknowledgment; an `idle` panel after a gesture means the gesture never
  reached the writer (CI run 43524911626) and is reported, not waited out.

## Known limits

- The packaged desktop journeys (`desktop-*.spec.ts`) run a production build,
  which does not expose the local service. There the creation helpers keep
  their row check only; those journeys do not use the queue witness either.

- Two negative checks still have no positive anchor:
  `apps/api/tests/realtime-page-sync.contract.spec.ts` (no broadcast to the
  second socket, 20 ms window, declared in the contract) and the late-caller
  case of `apps/web/tests/synchronize-serialization.spec.ts` (its pass-count
  assertion catches a missing coalescence, but a concurrent pass is detected
  only if it overlaps the held one).
- `apps/web/tests/operational-page-opening.spec.ts` still checks "conversion
  does not overtake activation" one microtask after the call.
- A press that lands outside the inline property composer closes it. The draft
  now survives that close (feature 061, `lessons.md` L-002), but the journey
  still restores the composer before asserting, because the press may legitimately
  dismiss it (`lessons.md` L-001).
- The folder keyboard-drag journey (`workspace-tabs-folder.spec.ts`, CI run
  43706222653) still moves after `data-dragging` without a witness that dnd-kit
  measured its droppables; no reliable signal was found.
