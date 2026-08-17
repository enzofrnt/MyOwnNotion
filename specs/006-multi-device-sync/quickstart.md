# Quickstart: Multi-Device Synchronization

How to run and validate this feature locally. Every scenario is runnable.

## Prerequisites

```bash
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev
```

> **Reset the local database when the schema changes.** This feature adds a
> column; a projection left on the previous schema fails every query and the
> client reports itself offline, which looks like a networking fault and is not.
> Features 004 and 005 each lost time to exactly this.

> **Check the ports before blaming the code.** `lsof -ti:3001,5173`. Another
> checkout holding 3001 or 5173 makes Playwright reuse *its* application, and the
> tests then exercise code this branch never touched. That cost an hour in
> feature 005.

## Running the journeys

Firefox runs in the container; the two must not run at once, because they share
one database and every journey resets the content:

```bash
pnpm exec playwright test --project=chromium-desktop --project=webkit-desktop \
  --project=chromium-mobile --project=webkit-mobile
pnpm test:e2e:firefox-container -- --project=firefox-desktop
```

## Scenario 1 — A change appears on the other device (FR-001, FR-002)

1. Open the workspace in two browser contexts.
2. Edit a page in the first.
3. Watch the second without touching it.

**Expected**: the change appears in under two seconds. Watch the stream
directly:

```bash
curl -N -H "Accept: text/event-stream" http://127.0.0.1:3001/v1/changes/stream
```

Each accepted mutation should produce one `advanced` event carrying the new
cursor — and nothing else. A payload here would be a defect: it would bypass the
sealed-envelope resolution that `/v1/changes` performs.

## Scenario 2 — Reconnection needs no help (FR-003)

1. With the stream open, stop the API: `docker compose stop api`.
2. Start it again.

**Expected**: the client reconnects on its own and resumes. Nothing in the
interface asks the owner to reload.

## Scenario 3 — A device that was away misses nothing (FR-005, FR-008)

1. Open two contexts; note the cursor in the second.
2. Take the second offline (DevTools, or `context.setOffline(true)`).
3. Make twenty changes in the first.
4. Bring the second back.

**Expected**: the second receives all twenty, in order, and ends identical to
the first. Compare directly:

```bash
curl -s "http://127.0.0.1:3001/v1/changes?after=0" | jq '.changes | length'
```

## Scenario 4 — A position too old is rebuilt, not skipped (FR-006)

1. Note a cursor, then generate enough changes to pass the retained window.
2. Reconnect with the old cursor.

**Expected**: a `compacted` event, and the device rebuilds from
`/v1/snapshots/current` while keeping its outbox. Resuming from the oldest
retained change instead would leave it permanently missing the gap.

## Scenario 5 — Being behind is not a conflict (FR-011)

1. Take a device offline; change nothing on it.
2. Edit the page elsewhere.
3. Bring it back.

**Expected**: it catches up with **no conflict**. This already holds today; the
scenario exists so a regression is caught rather than discovered.

## Scenario 6 — A real divergence is resolvable (FR-012 to FR-016)

1. Open a page in two contexts.
2. Take the second offline.
3. Edit the *same block* in both.
4. Bring the second back and save.

**Expected**: one conflict, with three columns — this device, the common state,
the other device. Choosing produces a new version, and **both originals remain**
in the history:

```bash
curl -s "http://127.0.0.1:3001/v1/items/<itemId>/revisions" | jq '.revisions[0].parentRevisionIds'
```

Two parents on the resolution is the assertion: that is what keeps the sources.

## Scenario 7 — Different blocks merge without asking (FR-013)

Same as scenario 6, but edit *different* blocks.

**Expected**: no conflict screen. Both edits are present.

## Scenario 8 — An incompatible client refuses to write (FR-017 to FR-020)

```bash
curl -s -D- -o /dev/null http://127.0.0.1:3001/v1/items | grep -i protocol
```

Then send a write announcing a version below the write minimum.

**Expected**: the write is refused with what to update, and a read still
succeeds — read-only rather than locked out wherever reads are safe.

## Scenario 9 — A revoked device stops (FR-021)

1. Connect a device and open the stream.
2. Revoke it from the security screen.

**Expected**: the stream closes, reconnection is refused with
`device.revoked`, and the device says its access was withdrawn.

## Scenario 10 — History says when, where from, and what (FR-022, FR-023)

Open a page's history after changes from two devices.

**Expected**: each entry names a date, a device, and the nature of the change.
No entry contains a session identifier or key material — grep the response to be
sure rather than trusting the screen.

## Verifying the whole gate

```bash
pnpm checks:local
```
