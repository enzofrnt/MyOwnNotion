# Wait-contract scan — unit / integration tests

Scope: `apps/web/tests/` (excluding `tests/e2e/`), `packages/*/tests/`, `tests/contract/`,
`tests/performance/`, `tests/fixtures/`.
Code read from worktree `/Users/enzofournet/Git/MyOwnNotion-059` at `f73b449c` (git tree `5f71be02`).
Read-only: nothing in the worktree was modified, no test was run.

Method: an exhaustive grep of every in-scope file for the timer/poll pattern set
(`setTimeout`, `setInterval`, `Date.now()`, `useFakeTimers`, `advanceTimersByTime`,
`vi.advanceTimersByTimeAsync`, `runAllTimers`, `expect.poll`, `await new Promise`,
`vi.waitFor`) — 46 files matched — then the surrounding test body was read for each match
before judging it. CI evidence was cross-checked against
`evidence/logs/*.txt` (the "Unit, property & coverage" job failures) so that a flake I claim
to be structural is not an invention.

Severity key: `P1` can lose data or make a wrong result pass; `P2` can produce a false red (or a
vacuously-passing guard); `P3` style/maintainability.

---

## apps/web/tests/synchronize-serialization.spec.ts:249 — synchronize serialization > "runs one pass when several callers arrive at once"

1. `apps/web/tests/synchronize-serialization.spec.ts:249` (assertion at `:250`), test
   `runs one pass when several callers arrive at once`.
2. ```ts
   await new Promise((resolve) => setTimeout(resolve, 50));
   expect(recorder.peakConcurrency, "a second pass entered the transport").toBe(1);
   ```
3. In flight: the *second and third* `LocalContentService.synchronize()` calls
   (`:243`–`:245`), which must join the pass already held open by `gate.promise` inside the
   `listChanges` recorder (`:47`–`:66`). The pass itself is deliberately parked.
4. Signal waited on: 50 ms of wall-clock time. A sleep proves nothing about the coalescing
   flag: it only proves that "nothing bad happened within 50 ms". If the second caller is
   serialised *late* (a queued microtask, a `db.open()` await, a slower runner), the
   unserialised pass never reaches `listChanges` before `gate.resolve()` at `:252`, so
   `peakConcurrency` stays 1 and the guard passes while the property is broken.
5. Real precondition: proof that the two late callers have been *observed* by the service and
   are waiting on the owner's pass — i.e. an observable "joined/queued pass" count, not elapsed
   time.
6. Existing real signal: none — the recorder counts `listChanges` entries only. Must be exposed
   by `LocalContentService`: a `passInProgress` / `joinedPasses` observable (or the resolved
   coalesced promise handed back to the caller). `vi.waitFor` on `recorder.passes === 1` is
   already used correctly elsewhere in this file (`:92`, `:118`, `:300`) and would still not
   prove the negative.
7. `P1` — this is the regression guard for the stranded-row bug described in the file header
   (`:1`–`:19`): an unserialised pass calls `outbox.recoverInterrupted()` and can reset a row
   the owning pass already drained, leaving a mutation `pending` with nobody to resubmit it.
   A vacuous pass here silently re-admits the data-loss regression.
8. `static-only` — no occurrence of this test in `evidence/logs/`.

## apps/web/tests/database-page-interaction.spec.tsx:355 — database page interaction durability > "sets a property icon from the schema panel without changing its type or views"

1. `apps/web/tests/database-page-interaction.spec.tsx:355` (loop body `:355`–`:365`), test
   `sets a property icon from the schema panel without changing its type or views`.
2. ```ts
   const deadline = Date.now() + 15_000;
   while (Date.now() < deadline) {
     ...
     if (!pickerOpen()) trigger.click();
     await new Promise((resolve) => setTimeout(resolve, 100));
   ```
3. In flight: the schema panel mount, the icon-picker popover open/close toggle, and the
   catalogue `[role="option"]` render, all of them async relative to the synchronous
   `trigger.click()` at `:327`.
4. Signal waited on: a hand-rolled `expect.poll`-equivalent that **retries the action** — it
   re-clicks the trigger on every 100 ms iteration until the option appears. The comment at
   `:345`–`:349` states it outright ("Reopen it until the filtered grid exists"). A popover
   that spuriously closes (the very race that produced the CI failures below) is therefore
   invisible: the loop simply reopens it, `picked` becomes `true`, and the test passes. The
   15 000 ms budget also makes a genuine regression cost 15 s before it fails.
5. Real precondition: one `trigger.click()` must be enough to make the popover stay open and
   render the filtered grid; the assertion needs to observe *that* render, not perform extra
   clicks.
6. Existing real signal: `vi.waitFor` on
   `document.querySelector('[role="listbox"][aria-label="Icônes"]')` (used just above at `:335`
   with `{ timeout: 10_000 }`), followed by a single click and an assertion that the listbox is
   still open with `iconOption() !== null`. A production-side `data-icon-picker-state` attribute
   would be the durable fix.
7. `P1` — this makes a wrong result pass: the spurious-close race is the defect the test is
   named after, and retrying the click removes the ability to detect it. The loop also cannot
   distinguish "the option rendered" from "my own retry rendered it".
8. `observed-in-CI` for the flakiness of this exact test — run `43421853764` (job
   `131873853372`), run `43510287732` (job `132178569332`), run `43521962935` (job
   `132218312688`): `FAIL … sets a property icon from the schema panel … AssertionError:
   expected null not to be null` on the earlier revision of this body. `static-only` for the
   exact current lines (the retry loop is the accumulated workaround for that failure).

## apps/web/tests/synchronize-serialization.spec.ts:273 — synchronize serialization > "still drains work enqueued while a pass was running"

1. `apps/web/tests/synchronize-serialization.spec.ts:273` (assertion at `:274`), test
   `still drains work enqueued while a pass was running`; the same shape recurs at `:249`
   (section above) and `:268`.
2. ```ts
   await new Promise((resolve) => setTimeout(resolve, 50));
   expect(recorder.peakConcurrency, "the late caller started its own pass").toBe(1);
   ```
3. In flight: the `late = service.synchronize()` call issued at `:271` while `held` is parked
   inside `listChanges`.
4. Signal waited on: a second 50 ms sleep. Same argument as `:249`: a sleep cannot prove that
   the late caller has been seen and has not started its own pass. A caller that begins its
   pass after 60 ms would be caught only by luck of scheduling; the *positive* half of the
   property is then asserted at `:279` (`recorder.passes === 2`), which does fail when the late
   work is swallowed — but the "never two at once" half is unproven.
5. Real precondition: the late caller must be known to have joined, and the recorder's
   `active`/`peakConcurrency` must be read after that join, not after a delay.
6. Existing real signal: `vi.waitFor(() => expect(recorder.passes).toBe(1))` proves the first
   pass entered; nothing proves the join. Must be exposed by `LocalContentService` (see `:249`).
7. `P2`.
8. `static-only`.

## apps/web/tests/entry-property-interaction.spec.tsx:15 — entry property configuration menus (the `delay()` helper)

1. `apps/web/tests/entry-property-interaction.spec.tsx:15` (helper `:15`–`:18`), used 24 times
   across the `describe("entry property configuration menus")` block.
2. ```ts
   const delay = async (ms = 60) =>
     act(async () => {
       await new Promise((r) => setTimeout(r, ms));
     });
   ```
3. In flight, depending on the call site: the property-settings dialog mount, the icon
   catalogue filter, `previewDefinitionImpact()` (a real async domain call awaited inside
   `onEditDefinition`, `:55`), the value-picker option creation, and the auto-commit that
   follows a rename (`:151`–`:153`).
4. Signal waited on: a fixed real-time budget (60 ms default, 400 ms at `:152`). Nothing in the
   helper is correlated with any of those operations; it is a bet that the machine is fast
   enough. The same file already contains the correct primitive for the identical condition —
   `vi.waitFor(..., { timeout: 5_000 })` at `:104` and `:137` — so the 60 ms sleeps are
   demonstrably the weak version of a wait that was already available.
5. Real precondition: the specific async result each call site depends on — the dialog input
   existing, the filtered icon option existing, the `edits` spy having been called.
6. Existing real signal: `vi.waitFor` (two examples in the same file, `:104`, `:137`); for the
   debounce at `:152`, `vi.useFakeTimers({ toFake: ["setTimeout","clearTimeout"] })` +
   `vi.advanceTimersByTimeAsync(350)` exactly as `entry-panel-interaction.spec.tsx:65`/`:79`
   already does for the same hook (`use-entry-autosave.ts:268`).
7. `P2` — the file is flaky in CI and every wait is a fixed sleep.
8. `observed-in-CI` — run `43225166453` (attempt 2, job `131236451749`):
   `FAIL … uses the view icon catalog and automatically sets and removes a property icon →
   Test timed out in 5000ms`; run `43376534470` (job `131724461433`):
   `FAIL … opens the property editor directly from click, right click and keyboard →
   AssertionError: expected <input …(4)></input> to be null` (the 5 s `vi.waitFor` at `:104`
   could not be satisfied).

## apps/web/tests/entry-property-interaction.spec.tsx:152 — entry property configuration menus > "opens the property editor without crashing and renames automatically"

1. `apps/web/tests/entry-property-interaction.spec.tsx:152` (assertion at `:153`).
2. ```ts
   await delay(400);
   expect(edits).toHaveBeenCalledOnce();
   ```
3. In flight: the debounced definition write started by `typeInto(input, "Brief")` at `:151`.
   The debounce is `350 ms` — `setTimeout(commit, 350)` at
   `apps/web/src/features/databases/property-configuration.tsx:151`; the same 350 ms constant is
   used by `use-entry-autosave.ts:239`/`:268` and is advanced deterministically in
   `entry-panel-interaction.spec.tsx:79`.
4. Signal waited on: 400 ms of real time — a 50 ms margin over the 350 ms debounce on the same
   event loop that must also run the timer callback, the async `onEditDefinition`, and the
   `setDefinition` re-render. Under coverage instrumentation that margin is not a margin.
   The wait also cannot distinguish "wrote after the debounce" from "wrote immediately", so it
   does not test the debounce at all, only "a write happened".
5. Real precondition: the 350 ms debounce has fired *and* the awaiting `onEditDefinition`
   promise has settled and its `setDefinition` render is committed.
6. Existing real signal: `vi.advanceTimersByTimeAsync(350)` under
   `vi.useFakeTimers({ toFake: ["setTimeout","clearTimeout"] })` inside `act`
   (`entry-panel-interaction.spec.tsx:65`,`:77`–`:81`), which is deterministic and also lets the
   test assert the negative (`edits` not called before 350 ms).
7. `P2`.
8. `observed-in-CI` for the file (see the section above); `static-only` for this line.

## packages/client-core/tests/legacy-page-editing-session.spec.ts:408 — "stops retrying and blocks new edits after an orphaned branch is retained"

1. `packages/client-core/tests/legacy-page-editing-session.spec.ts:408` (assertion at `:409`),
   test `stops retrying and blocks new edits after an orphaned branch is retained`.
2. ```ts
   await new Promise((resolve) => setTimeout(resolve, 300));
   expect(requestConversion).toHaveBeenCalledOnce();
   ```
3. In flight: the conversion-retry scheduler. `#scheduleConversionRetry()`
   (`packages/client-core/src/page-sync/legacy-page-editing-session.ts:709`–`:726`) arms a
   `setTimeout` with `delay = Math.min(250 * 2 ** attempt, 5_000)` — 250 ms, then 500 ms, then
   1 000 ms, … The test is asserting that **no** such attempt is ever made after the branch
   becomes `blocked`.
4. Signal waited on: a 300 ms window. It only covers the *first* backoff step (250 ms) and
   nothing else: a regression that retried at 500 ms or 1 000 ms passes the assertion
   vacuously. A fixed sleep is structurally incapable of proving the absence of a scheduled
   timer.
5. Real precondition: no retry timer is pending at all for this session.
6. Existing real signal: none exposed. The deterministic alternative needs no producer change:
   `vi.useFakeTimers()` + `await vi.advanceTimersByTimeAsync(5_000)` (the cap of the backoff)
   then assert `requestConversion` still called once — fake timers make "advance past every
   possible retry" exact. A `session.pendingConversionRetry` accessor would be better still.
7. `P2` — a duplicate/never-ending conversion attempt installs a checkpoint over local edits,
   so the guard matters; the current proof covers only the first 300 ms of a 5 s window.
8. `static-only`.

## packages/client-core/tests/legacy-page-editing-session.spec.ts:329 — "does not convert a page that was only looked at"

1. `packages/client-core/tests/legacy-page-editing-session.spec.ts:329` (assertion at `:330`).
2. ```ts
   // Let every queued drain-point task run its course.
   await new Promise((resolve) => setTimeout(resolve, 0));
   expect(requestConversion).not.toHaveBeenCalled();
   ```
3. In flight: `LegacyPageEditingSession.open()`'s queued drain point
   (`#scheduleConversion` → the serial gesture queue), which must *not* schedule a conversion
   when the page was only opened.
4. Signal waited on: a single macrotask (`setTimeout 0`). It drains the promise queue that
   exists at that instant; a drain point that is itself queued behind another `setTimeout`, or
   behind an `await` on IndexedDB, is not covered. The comment ("every queued drain-point
   task") claims more than one macrotask can prove, and the assertion is a negative — the
   dangerous direction is a vacuous pass.
5. Real precondition: the session's gesture queue is idle and empty.
6. Existing real signal: none. The session already serialises gestures, so an
   `await session.settled()` / `session.gestureQueue.idle` promise would be the honest signal;
   otherwise fake timers + `advanceTimersByTimeAsync` over the drain window. The durable
   companion assertion (`await log.getLegacyBranch(pageId)` still `status: "editing"`) would at
   least catch a conversion that completed, but not one that was merely requested.
7. `P2`.
8. `static-only`.

## packages/database/tests/page-operations.integration.spec.ts:352 — "holds a row lock until the first transaction commits"

1. `packages/database/tests/page-operations.integration.spec.ts:352` (assertion at `:353`).
2. ```ts
   await new Promise((resolve) => setTimeout(resolve, 50));
   expect(secondLock).not.toHaveBeenCalled();
   ```
3. In flight: the second `context.handle.db.transaction(...)` opened at `:345`, which must block
   in `lockPageOperationState` until `release()` at `:354`.
4. Signal waited on: 50 ms of real time. A negative assertion verified by elapsed time passes
   whether the lock works or the second transaction simply has not reached
   `lockPageOperationState` yet — there is no proof the second transaction is queued at all.
5. Real precondition: the second transaction has started and is blocked on the row lock.
6. Existing real signal: none, but none is needed — a one-line barrier makes it exact: resolve
   a `secondReached` deferred *before* `lockPageOperationState` inside the second transaction
   body, `await secondReached`, then `await Promise.resolve()` and assert `secondLock` was not
   called.
7. `P2` (false-pass risk on a concurrency guarantee).
8. `static-only`.

## apps/web/tests/table-scroll-observer.spec.ts:49 — table scroll measurements > "preserves the new bottom when iOS flushes an older deferred measurement"

1. `apps/web/tests/table-scroll-observer.spec.ts:49` (assertion), negative half at `:49`,
   positive half at `:58`.
2. ```ts
   main.dispatchEvent(new Event("touchend"));
   expect(instance.isScrolling).toBe(true);
   ...
   instance.resizeItem(0, 35);
   expect(writes).toEqual([]);
   ```
3. In flight: the virtualizer's deferred iOS correction, which is driven by the
   `touchstart`/`touchend` gesture pair at `:42`/`:45` and by the `isScrollingResetDelay` timer.
   `writes` is the `scrollToFn` sink.
4. Signal waited on: nothing. The test asserts the *absence* of a write between `touchend` and
   `resizeItem`, with fake timers installed and no flush in between; the only evidence that the
   gesture state has settled is `isScrolling === true`, which says the opposite (a flush is
   still owed). CI observed a write (`[491]`) at exactly that point, which means the deferred
   correction had been applied by then on those runners.
5. Real precondition: the touch gesture's deferred correction is still *held* and has not been
   scheduled or applied when `resizeItem` runs.
6. Existing real signal: the test's own later sequence — advance to
   `isScrollingResetDelay`, assert `isScrolling === false`, then assert the write — is the
   reproducible order. For the negative half, an explicit `expect(instance.scrollOffset)` (or
   an explicit "no pending correction" accessor) before `resizeItem` would correlate the
   assertion with the state it depends on.
7. `P2` — observed red three times.
8. `observed-in-CI` — run `43392306416` (job `131779147573`), run `43470717395` (job
   `132042570722`), run `43587630795` (job `132426635406`), all with the identical
   `AssertionError: expected [ 491 ] to deeply equal []`.

## apps/web/tests/projection-refresh.spec.ts:14 — projection refresh drain (the `advance()` helper)

1. `apps/web/tests/projection-refresh.spec.ts:14` (helper `:14`–`:17`), used at `:41`, `:51`,
   `:68`, `:71`, `:74`, `:91`, `:122`, `:127`, `:146`.
2. ```ts
   async function advance() {
     await Promise.resolve();
     await Promise.resolve();
   }
   ```
3. In flight: `createProjectionRefresh`'s queued read/rerun (`load()` → publish), whose promise
   chain length is an implementation detail of `apps/web/src/features/databases/projection-refresh.ts`.
4. Signal waited on: a hard-coded *depth* of two microtask ticks. This is the "passes because a
   microtask happened to run first" shape in its purest form: the moment the implementation
   gains one more `await`, every negative assertion built on it (`:52`, `:76`, `:95`, `:133`,
   `:143`, `:153`) becomes vacuously true while the positive assertions (`:53`, `:75`, `:132`)
   go red. Nothing tells the reader which of the two happened.
5. Real precondition: the second `load()` call has been entered (for the negatives) and the
   final publication has happened (for the positives).
6. Existing real signal: the `load` mock can hand the test a deferred it resolves *inside* the
   mock — `const started = deferred(); load = vi.fn(() => { started.resolve(); return p; })` —
   then `await started.promise` instead of `advance()`. `vi.waitFor` on the mock call count
   (`:53`) is the fallback already available.
7. `P2`.
8. `static-only`.

## packages/database/tests/client-lifecycle.integration.spec.ts:58 — "waits for a socket already removed from pool bookkeeping"

1. `packages/database/tests/client-lifecycle.integration.spec.ts:58` (assertions `:59`, `:66`).
2. ```ts
   await new Promise<void>((resolve) => setImmediate(resolve));
   const resolvedBeforeSocketClosed = closeResolved;
   ```
3. In flight: `handle.close()` (`:53`), which must not resolve until the already-retired client's
   socket has ended (`reportSocketClosed()`, `:63`).
4. Signal waited on: one `setImmediate`. It proves `close()` did not resolve within a single
   event-loop iteration; a regression that resolved after two iterations would leave
   `resolvedBeforeSocketClosed === false` and the test green.
5. Real precondition: an ordering fact — "close resolution" must come strictly after "socket
   end", whatever the latency.
6. Existing real signal: record both events in an order array (`events.push("closed")` in the
   `originalEnd(callback)` path, `events.push("close-resolved")` in `closing.then`), resolve the
   socket, `await closing`, then assert `events` — order, not elapsed time. The first test in the
   same file already asserts a counted durable fact (`closedSockets === expectedSockets`, `:33`).
7. `P2`.
8. `static-only`.

## apps/web/tests/operational-page-opening.spec.ts:877 — "drains a pending %s before checking or activating its canonical server head"

1. `apps/web/tests/operational-page-opening.spec.ts:877` (and `:880`), the `it.each` at `:809`.
2. ```ts
   expect(synchronize.mock.invocationCallOrder[0]).toBeLessThan(
     checkpoint.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
   );
   ```
3. In flight: the ordering between the outbox drain (`synchronize`) and the canonical-head read
   (`checkpoint`, `getItem`) inside `openOperationalPage`.
4. Signal waited on: `invocationCallOrder`. The `?? Number.POSITIVE_INFINITY` fallback makes the
   assertion unfalsifiable when `checkpoint` was never called: `x < Infinity` is always true.
   `getItem` is mocked at `:846`, so it is always called at least once, but `checkpoint` is not
   guaranteed — and "the canonical head was never checked" is precisely a regression this test
   claims to catch ("before checking or activating").
5. Real precondition: `checkpoint` *has* been invoked, and its call index is greater than
   `synchronize`'s.
6. Existing real signal: `expect(checkpoint).toHaveBeenCalledOnce()` before the ordering
   assertion (the pattern already used at `:867` for the pre-drain state), or compare
   `mock.invocationCallOrder` only after asserting both mocks fired.
7. `P2` — an assertion that cannot fail hides a skipped canonical-head check.
8. `static-only`.

## apps/web/tests/operational-page-opening.spec.ts:491 — "settles an in-flight activation before retiring the page authority"

1. `apps/web/tests/operational-page-opening.spec.ts:491` (assertion `:492`).
2. ```ts
   await Promise.resolve();
   expect(await service.getItem(pageId)).toMatchObject({ kind: "page" });
   ```
3. In flight: `service.mutate("item.convert", …)` (`:482`), which must wait for the in-flight
   `activate` call held by `activationBlocked` (`:453`–`:469`).
4. Signal waited on: one microtask, plus the duration of an IndexedDB read
   (`await service.getItem`). The read makes the result depend on how long Dexie takes — if the
   conversion's barrier is broken and the write is slow, the assertion still passes; if the
   write is fast, it fails. Neither outcome is tied to the barrier itself, so the test is
   simultaneously a false-pass and a false-red risk on the ordering guarantee it names.
5. Real precondition: the conversion has *not* committed, proven by the durable row
   (`pageOperationLog.getState` / `outbox.all()` both empty, which the test already checks after
   the release at `:500`–`:501`) while the activation is still blocked.
6. Existing real signal: `await vi.waitFor(() => expect(activate).toHaveBeenCalledOnce())` is
   already used at `:480`; add the mirror — an `activationSettled` deferred resolved after
   `activate` returns — and assert `conversion` is still pending
   (`await Promise.race([conversion.then(() => "settled"), tick])` is not enough; a
   `service.pendingActivations` count would be).
7. `P2`.
8. `static-only`.

## apps/web/tests/database-page-interaction.spec.tsx:210 — "shows the source title inside an integrated database with one source" (and `:234`, `:242`)

1. `apps/web/tests/database-page-interaction.spec.tsx:210`, also `:234` and `:242`; tests
   `shows the source title inside an integrated database with one source` and
   `updates the integrated source title when switching to a linked source`.
2. ```ts
   <DatabaseContainerPage containerItemId={containerId} service={service} onOpenEntry={vi.fn()} />
   ...
   await new Promise((resolve) => setTimeout(resolve, 10));
   ```
3. In flight: the container page's async reads (`getDatabase`, `listDatabaseEntries`, the tab
   list) that populate `[data-testid="current-source-title"]`.
4. Signal waited on: 10 ms. Ten milliseconds is not a bound on four chained IndexedDB/read
   promises; on a loaded runner (or with coverage) this is a false red, and the assertion is
   the only thing that would tell you.
5. Real precondition: the title element exists and carries the resolved source name.
6. Existing real signal: `vi.waitFor(() => expect(title?.value).toBe("Tâches"))` — the same
   primitive the file already uses at `:335`. Anything else in the file that needs a bounded
   wait already uses `vi.waitFor` with an explicit timeout.
7. `P2`.
8. `static-only`.

## apps/web/tests/board-card-editor.spec.tsx:17 — "creates atomically from the editable title, then clears the next draft without creating an empty entry"

1. `apps/web/tests/board-card-editor.spec.tsx:17` (helper), awaited at `:48`, `:53`, `:64` with
   assertions `:49`, `:54`, `:65`; the same helper exists verbatim at
   `apps/web/tests/database-card-inline.spec.tsx:10`.
2. ```ts
   const pause = () => new Promise((resolve) => setTimeout(resolve, 15));
   ```
3. In flight: the `onSave` acknowledgement (`save = vi.fn().mockResolvedValue(undefined)`,
   `:24`) and the subsequent `close` state transition; also the pointer-down outside handler at
   `:63`.
4. Signal waited on: 15 ms. Fifteen milliseconds is shorter than a single jsdom + coverage
   re-render on a busy runner, and it is not correlated with the save promise resolving — it
   only works because `act` happens to drain the microtask queue in between. The assertion
   `expect(save).toHaveBeenCalledTimes(1)` at `:54` is therefore a coin flip between "not yet"
   and "yes".
5. Real precondition: the `onSave` promise has settled and the derived state (cleared draft /
   closed editor) has been rendered.
6. Existing real signal: `vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))` — already
   imported style used throughout the repo; or make `save` a deferred the test releases
   explicitly (as the second test in the same file already does at `:77`–`:81`).
7. `P2`.
8. `static-only`.

## apps/web/tests/sidebar.spec.ts:59 — recents > "puts the most recently changed item first"

1. `apps/web/tests/sidebar.spec.ts:59` (and `:61`).
2. ```ts
   const first = generateUuidV7();
   await new Promise((resolve) => setTimeout(resolve, 2));
   ```
3. Not an application operation: the *fixture data*. The test relies on the wall clock advancing
   by ≥2 ms so that three UUIDv7 values have strictly increasing embedded timestamps.
4. Signal waited on: elapsed real time as a proxy for "the clock moved". `setTimeout(2)` is a
   *lower bound* on the delay, not on the timestamp resolution: on a coarse-clock platform the
   three UUIDs can share a millisecond, after which ordering falls back to the random tail and
   `recentsOf` returns an arbitrary order. The test then fails for a reason unrelated to
   `recentsOf`.
5. Real precondition: three identifiers whose embedded timestamps are strictly ordered.
6. Existing real signal: none needed — `recentsOf` only needs orderable ids, so the fixture
   should construct explicit ids with known timestamps (the file already builds `ProjectedItem`
   fixtures by hand at `:20`–`:41`) instead of minting them from the real clock.
7. `P2` (flaky red, not a product regression).
8. `static-only`.

## apps/web/tests/relation-value-menu.spec.tsx:126 — relation value menu > "adds to the selection and offers removal for a retained out-of-source link"

1. `apps/web/tests/relation-value-menu.spec.tsx:126` (`{ timeout: 10_000 }` at `:135`).
2. ```ts
   const retained = await vi.waitFor(() => { … throw new Error("Retained link row is not rendered yet"); },
     { timeout: 10_000 },
   ```
3. In flight: the `RelationCatalogProvider`'s per-value asynchronous catalogue lookup
   ("one asynchronous lookup per out-of-source value" — the comment at `:132`), triggered by
   reopening the menu at `:124`.
4. Signal waited on: "the retained row eventually renders", with the timeout raised from
   Vitest's 1 s default to 10 s. It is a bounded wait (it fails), so it is not a false pass —
   but it is not correlated to the lookup it depends on, and the 10 s ceiling is the workaround
   rather than the fix. A genuine regression would now cost 10 s of CI.
5. Real precondition: the catalogue lookup has resolved for `id(32)`.
6. Existing real signal: the provider owns the catalogue map — expose the resolved entry (or a
   `catalogue.ready` promise) so the test awaits the lookup rather than the render. The
   deterministic alternative is already used by every other test in the file: `serviceOf(rows)`
   (`:68`) feeds the catalogue synchronously, so no asynchronous lookup is needed at all.
7. `P2` — the raised timeout is the accumulated workaround for three CI failures.
8. `observed-in-CI` — run `43317240835` (job `131528683544`) and run `43374207601` (job
   `131716886269`) failed on this test (no assertion text captured); `static-only` for the
   current 10 s budget.

## apps/web/tests/local-content-realtime-sync.spec.ts:211 — "coalesces simultaneous operational wake-ups without overlapping recovery passes"

1. `apps/web/tests/local-content-realtime-sync.spec.ts:211` (assertion `:212`).
2. ```ts
   const joined = service.synchronizeOperationalPages();
   await Promise.resolve();
   expect(invocations).toBe(1);
   ```
3. In flight: the joined caller's decision to coalesce instead of starting a second pass.
4. Signal waited on: a single microtask. If the join decision happens one `await` later, the
   assertion passes without the coalescing having occurred.
5. Real precondition: the second caller has been registered as a joiner.
6. Existing real signal: the final assertion `expect(maximumConcurrentPasses).toBe(1)` at `:217`
   *does* catch overlap, and `expect(invocations).toBe(2)` at `:216` catches a swallowed wake-up —
   so this line is redundant rather than load-bearing.
7. `P3` — the property is covered at `:216`–`:217`; `:212` only adds a misleading signal.
8. `static-only`.

## apps/web/tests/database-view-loading.spec.tsx:34 — embedded database view loading (the `advance()` helper)

1. `apps/web/tests/database-view-loading.spec.tsx:34` (helper `:34`–`:36`), used ~30 times
   (`:245`, `:255`, `:349`, …).
2. ```ts
   async function advance() {
     await new Promise((resolve) => setTimeout(resolve, 0));
   }
   ```
3. In flight: `loadView()`'s chained reads (`getDatabase` → `listDatabaseEntries` →
   `getItems` → `getDatabaseEntryRelations`), plus the React re-render each resolution causes.
4. Signal waited on: one macrotask. The negative assertions built on it
   (`expect(f.mocks.getItems).not.toHaveBeenCalled()` at `:255`) hold only if `loadView` reaches
   its awaits within one macrotask; the positive ones fail if it needs two. The tests are
   therefore coupled to the await depth of `loadView`, not to its contract.
5. Real precondition: for negatives, that the loader has entered the stage before the gated
   call; for positives, that the gated read resolved and its render committed.
6. Existing real signal: the file's own `deferred()` gates (`:24`–`:31`, used at `:229`–`:270`)
   are the right primitive — resolve a "stage entered" deferred inside the mock instead of
   advancing a timer; `vi.waitFor` on the mock call is the fallback.
7. `P3` — the negative assertions are the risky half; the positives are loud when they break.
8. `static-only`.

## apps/web/tests/emoji-picker.spec.tsx:175 — "initializes the picker only when opened and accepts a selection after reopening" (and two siblings)

1. `apps/web/tests/emoji-picker.spec.tsx:175`; same shape at
   `apps/web/tests/page-attachment-panel.spec.tsx:92` and
   `apps/web/tests/navigation-item-menu.spec.tsx:51`.
2. ```ts
   await act(async () => {
     await new Promise((resolve) => setTimeout(resolve, 100));
   });
   expect(document.querySelector('[data-testid="lazy-emoji"]')).toBeNull();
   ```
3. In flight: nothing. `EmojiPickerPanel` mounts and removes the picker synchronously
   (`apps/web/src/ui/emoji-picker.tsx:75`–`:115`; the factory returns the element directly and
   `replaceChildren` runs inline); the `requestAnimationFrame` there only fits a shadow-DOM
   style. The attachment panel and the navigation item menu likewise contain no timers (checked
   in source).
4. Signal waited on: 100 ms of dead time. It cannot fail and does not prove anything, but it
   adds 300 ms per file to a suite that runs under a queue-time budget.
5. Real precondition: the `act` around the click already commits the state change.
6. Existing real signal: `act` alone (or `vi.waitFor` if a future change introduces an async
   close).
7. `P3`.
8. `static-only`.

## apps/web/tests/group-editor.spec.tsx:93 — "applies from the selector once, retains a refused choice for retry and excludes unavailable properties" (and `database-board-interaction.spec.tsx:95`)

1. `apps/web/tests/group-editor.spec.tsx:93`; same shape at
   `apps/web/tests/database-board-interaction.spec.tsx:95` with 60 ms.
2. ```ts
   trigger.click();
   await new Promise((resolve) => setTimeout(resolve, 60));
   ```
3. In flight: the popover/menu mount after the click. Both components are jsdom-rendered React;
   the menu state is a `useState` flip, which `act` already flushes.
4. Signal waited on: 60 ms of real time for a synchronous render. It is not load-bearing today,
   so it is either dead time (P3) or, once a menu gains an async step, a silent 60 ms race.
5. Real precondition: the `[role="menu"]` exists.
6. Existing real signal: `act` (already wrapped) or `vi.waitFor` on the menu.
7. `P3`.
8. `static-only`.

## packages/domain/tests/search-index.spec.ts:69 — WorkspaceSearchIndex > "keeps a large writable index consistent beyond the engine vacuum threshold"

1. `packages/domain/tests/search-index.spec.ts:69`.
2. ```ts
   // MiniSearch's batched vacuum resumes on a timer. Give any background work
   // time to complete before exercising the same index again.
   await new Promise((resolve) => setTimeout(resolve, 25));
   ```
3. In flight: MiniSearch's internal vacuum timer, started by the 21 `upsert`s above.
4. Signal waited on: 25 ms. Worse than a false red: the assertions that follow
   (`:71`–`:75`) pass whether or not the vacuum ran, so the test *claims* coverage of the
   post-maintenance path (`:67` advertises "after enough replacements to trigger maintenance")
   without ever establishing that the maintenance happened.
5. Real precondition: the vacuum completed.
6. Existing real signal: none exposed by the library. `vi.useFakeTimers()` +
   `await vi.advanceTimersByTimeAsync(<vacuum delay>)` is deterministic and would at least pin
   the situation; otherwise the comment should be dropped and the test renamed to what it
   actually asserts.
7. `P3` (false coverage).
8. `static-only`.

## apps/web/tests/map-view-states.spec.tsx:85 — map view states (the `render()` helper)

1. `apps/web/tests/map-view-states.spec.tsx:85` (helper), also `:122`.
2. ```ts
   await act(async () => {
     await new Promise((resolve) => setTimeout(resolve, 0));
   });
   ```
3. In flight: `MapView`'s `fetch("/v1/maps/config")` for the browser key, plus the state
   transition that shows the advisory or the retry.
4. Signal waited on: one macrotask for a fetch → `.then` → `setState` chain. It works because
   the `fetch` stub resolves immediately; a single extra `await` in the component turns this
   into a red suite.
5. Real precondition: the config request has settled and its render committed.
6. Existing real signal: `vi.waitFor` on `[role=alert]` text, or a deferred `fetch` the test
   resolves explicitly (the pattern used in `place-property-field.spec.tsx:36`–`:54`).
7. `P3`.
8. `static-only`.

## apps/web/tests/app-routing.spec.tsx:199 — application routing (the `renderAt()` helper and its inline twins)

1. `apps/web/tests/app-routing.spec.tsx:199`, repeated at `:265`, `:309`, `:319`, `:329`,
   `:339`, `:347`, `:361`, `:369`, `:414`, `:447`, `:471`.
2. ```ts
   await new Promise((resolve) => setTimeout(resolve, 0));
   }));
   ```
3. In flight: the router's canonicalisation redirect and the `App` session bootstrap
   (`api.status` → `api.currentSession`), each an async chain of one or two hops.
4. Signal waited on: one macrotask inside `act(async)`. `act` drains the microtask queue, so in
   practice this is a bounded flush rather than a bet; but it is written as a sleep and the next
   reader has no way to know which async chain it is waiting for.
5. Real precondition: the specific redirect/session step being asserted.
6. Existing real signal: `[data-testid="route-location"]` text and
   `[data-testid="app-checking"]` presence are already the observable signals — `vi.waitFor` on
   those, instead of a sleep before a synchronous assert.
7. `P3`.
8. `static-only`.

## apps/web/tests/database-page-interaction.spec.tsx:909 — "removes the optimistic row when the store rejects the write"

1. `apps/web/tests/database-page-interaction.spec.tsx:909` (assertion `:910`).
2. ```ts
   await act(async () => {
     addButton.click();
     await new Promise((resolve) => setTimeout(resolve, 0));
   });
   expect(container.querySelectorAll("tbody tr:not(.database-table-add-entry)")).toHaveLength(0);
   ```
3. In flight: the rejection of `onCreateEntry` (an `async` throw, `:885`–`:887`) and the
   rollback that removes the optimistic row plus renders the alert.
4. Signal waited on: one macrotask. It happens to suffice for one `await` + `catch`; the rollback
   assertion is therefore tied to the handler's await depth.
5. Real precondition: the rejection has been handled and the rollback rendered.
6. Existing real signal: `vi.waitFor(() => expect(container.textContent).toContain("L'entrée n'a
   pas pu être créée"))` before the row-count assertion.
7. `P3`.
8. `static-only`.

## tests/performance/realtime-page-sync.performance.spec.ts:135 — "coalesces 10,000 announcements to one frontier with bounded time and memory"

1. `tests/performance/realtime-page-sync.performance.spec.ts:135` (assertion `:147`).
2. ```ts
   await Promise.resolve();
   const durationMs = performance.now() - started;
   ```
3. In flight: the transport's announcement coalescer flush.
4. Signal waited on: one microtask before `expect(seen).toEqual([10_000])`. The coalescer is
   expected to flush on a microtask, so this is a correct-by-construction flush — but it is
   indistinguishable from a lucky one, and it also sits inside the measured `durationMs`
   window, so the budget check inherits the ambiguity.
5. Real precondition: the coalescer's flush has been observed.
6. Existing real signal: none needed if the flush stays a microtask; an explicit
   `flushAnnouncements()`/`await transport.idle()` hook would make both the assertion and the
   timing honest.
7. `P3`.
8. `static-only`.

## OK (verified waits)

These were read and are genuinely sound — do not "fix" them:

- `packages/client-core/tests/page-editing-session.spec.ts:58` — the model for this whole class:
  the durable store is gated (`await durable.promise` inside `commitLocalTransaction`), the test
  awaits the gate, asserts the durable tables are still empty (`db.pageOperationStates.count()` /
  `pageOperationUpdates.count()` are 0, no publish), then releases and re-reads the durable
  counts. Also `:103` (`firstCommitEntered` deferred instead of a sleep).
- `packages/client-core/tests/outbox-resume-safety.spec.ts:144` — closes and reopens the Dexie
  database, replays, then `expect(await snapshot()).toEqual(before)` plus a direct `outbox.get`
  read-back. A real restart, not a proxy.
- `apps/web/tests/progressive-startup.spec.ts:234`–`:242` — `entered`/`held` deferreds gate the
  projection publication, the durable marker is read with `repository.getMeta`, `resolved` is
  asserted `false` while held, and the order array is compared after the release.
- `apps/web/tests/realtime-page-sync-transport.spec.ts:175`–`:287` — `vi.useFakeTimers()` with
  `advanceTimersByTimeAsync` (which flushes the promise queue), `vi.useRealTimers()` in
  `afterEach` (`:91`), and no fixed real sleeps. The timeout/backoff assertions at `:180`, `:211`,
  `:239`, `:256`, `:266` are exact to the millisecond.
- `apps/web/tests/storage-manager.spec.ts:11`–`:24` — a never-settling `persisted()` promise plus
  `advanceTimersByTimeAsync(25)`: the timeout is proven, not slept through.
- `apps/web/tests/content-file-retry.spec.ts:34`, `:60` — `vi.runAllTimersAsync()` (drains timers
  and microtasks between them) followed by `await pending`, i.e. the assertion is on the
  operation's own result.
- `apps/web/tests/entry-panel-interaction.spec.tsx:65`/`:77`–`:81` — `vi.useFakeTimers({ toFake:
  ["setTimeout","clearTimeout"] })` (leaving `Date` and promises real) and
  `advanceTimersByTimeAsync(400)` inside `act`; the negative assertions at `:169`, `:227`,
  `:254` are therefore real.
- `apps/web/tests/mcp-access-panel.spec.tsx:159`–`:181` — advance past the one-use-code expiry,
  assert the code is gone, then release the pending clipboard write and assert the late
  completion produced no feedback.
- `apps/web/tests/table-scroll-observer.spec.ts:52`–`:60` and `:86` — the fake-timer advances
  themselves are correct (`isScrollingResetDelay`); only the negative at `:49` (see the finding
  above) is unsynchronised.
- `apps/web/tests/property-name-draft.spec.tsx:51`, `:70`, `:100`; `apps/web/tests/
  tree-row-pointer.spec.ts:70`–`:110`; `apps/web/tests/collapsible-region.spec.tsx:55`, `:70`,
  `:147`; `apps/web/tests/navigation-inline-create.spec.tsx:317`;
  `apps/web/tests/code-block-toolbar.spec.tsx:96`;
  `apps/web/tests/page-scroll-lifecycle.spec.tsx:90`, `:98` — each advances a faked timer over a
  *synchronous* callback chain (verified in the corresponding source), so `advanceTimersByTime`
  without the async variant is correct here.
- `apps/web/tests/synchronize-serialization.spec.ts:92`, `:118`, `:225`, `:300`, `:344` —
  `vi.waitFor` on the mocked call count / outbox status, which fails on timeout. Only the
  fixed-sleep negative guards (`:249`, `:268`, `:273`) are flagged.
- `tests/performance/databases.perf.spec.ts:269`–`:290` — the propagation budget is measured
  around `await Promise.all([...applyCommittedChanges])` and the value is asserted after the
  real operation resolved; `performance.now()` is used for measurement only.
- `tests/contract/export.spec.ts:46`–`:58` — a bounded poll (`50 × 100 ms`) that ends in
  `expect(status).toBe("ready")`, so a timeout is a failure, not a pass. Acceptable; the 100 ms
  sleeps are the only objection (`P3`, not itemised).
- `packages/database/tests/client-lifecycle.integration.spec.ts:33` — `closedSockets` counts real
  `stream.once("end")` events and is compared to `pool.totalCount`; durable, not timed.

## Counts

- Files in scope by my own `find` (worktree `MyOwnNotion-059`): **435** —
  `apps/web/tests/` 182 (179 `*.spec.ts[x]` + 1 helper + 1 fixture + 1 setup),
  `packages/*/tests/` 214 (205 specs + 9 helpers/fixtures),
  `tests/contract/` 26, `tests/performance/` 10, `tests/fixtures/` 3.
  (The task's "87 / 188" figures differ from this tree's actual counts; the numbers above are
  what `find apps/web/tests packages/*/tests -type f` returns at `f73b449c`.)
- Files **opened and read** (whole file or the relevant regions, not just grepped): **50** —
  38 under `apps/web/tests/` (37 spec files + `support/fake-websocket.ts`), 8 under
  `packages/*/tests/`, 2 under `tests/contract/`, 2 under `tests/performance/`. 49 of the 50 are
  spec files.
- Files **grepped exhaustively** for the pattern set: **all 435** (46 matched, 46 triaged).
- Source files read to confirm what a test was waiting for (not counted above):
  `apps/web/src/features/databases/use-entry-autosave.ts`,
  `apps/web/src/ui/emoji-picker.tsx`,
  `apps/web/src/features/editor/use-page-scroll-restoration.ts`,
  `packages/client-core/src/page-sync/legacy-page-editing-session.ts`.
- Epics not covered: `tests/e2e/` (107 files, other auditors); the 385 files not opened were
  judged only from their grep matches, so a defect that uses a *helper* wait with no timer
  literal in the file would not have been seen.
