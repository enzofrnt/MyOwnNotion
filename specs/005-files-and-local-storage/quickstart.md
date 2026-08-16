# Quickstart: Files and Local Storage

How to run and validate this feature locally. Each scenario maps to
requirements, and each is runnable rather than described.

## Prerequisites

```bash
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev
```

> **Reset the local database when the schema changes.** This feature adds
> tables and a column; a projection left on the previous schema fails every
> query and the client reports itself offline, which looks like a networking
> problem and is not. Feature 004 lost an hour to exactly this.

## Running the journeys

Firefox does not start on the macOS workstation, so it runs in the container —
and the two must not run at once, because they share one database and every
journey resets the content:

```bash
pnpm exec playwright test --project=chromium-desktop --project=webkit-desktop \
  --project=chromium-mobile --project=webkit-mobile
pnpm test:e2e:firefox-container -- --project=firefox-desktop
```

## Scenario 1 — A file's identity survives being moved (FR-003, FR-005)

1. Create a page, attach a file to it.
2. Embed the same file in a second page.
3. Rename the file, then move it to another folder.
4. Open both pages.

**Expected**: both still resolve the file. The attachment list shows two
usages, each reachable.

## Scenario 2 — Deletion is refused until the usages are seen (FR-004)

1. With the file from scenario 1 still used twice, delete it.

**Expected**: the confirmation names both usages. Declining leaves everything
untouched. Confirming sends the file to the trash under the ordinary 30-day
recovery window.

## Scenario 3 — An interrupted transfer resumes (FR-006)

1. Begin uploading a large file.
2. Stop the API mid-transfer (`docker compose stop api`), then start it again.
3. Retry from the client.

**Expected**: the transfer continues from the server's offset rather than
restarting. At no point does a partial upload appear in the tree.

Check the offset directly:

```bash
curl -I http://127.0.0.1:3001/v1/uploads/<id>   # Upload-Offset
```

## Scenario 4 — An oversized file is refused without losing the draft (FR-008, FR-009)

1. Set the maximum low: `MYOWNNOTION_MAX_FILE_BYTES=1048576`.
2. Write some text on a page, then attach a file larger than that.

**Expected**: refusal states the limit and the reason before any byte is sent.
The text written on the page is still there.

## Scenario 5 — Previews cannot reach the workspace (FR-010, FR-013)

1. Upload a PDF, a PNG, an SVG, and a Draw.io file; open each.
2. Upload an SVG containing a script that tries to read the page around it.

**Expected**: the first four preview in the application. The script cannot
reach the workspace. Confirm the headers:

```bash
curl -sI http://127.0.0.1:3001/v1/files/<itemId>/content | \
  grep -iE "content-disposition|x-content-type-options|content-security-policy"
```

## Scenario 6 — Draw.io is served by this installation (research decision 2)

1. Open a Draw.io file, edit it, save.
2. Watch the network panel.

**Expected**: no request leaves this origin. A request to `diagrams.net` is a
defect, not a detail: it would mean the owner's diagram was sent to a third
party.

## Scenario 7 — A marked branch works with no network (FR-015, FR-016)

1. Mark a folder "always available offline"; wait for it to settle.
2. Go offline (DevTools, or `context.setOffline(true)` in a journey).
3. Open every page and file in the branch.

**Expected**: everything opens. Anything outside the branch that was never
fetched says so, and never says it is missing.

## Scenario 8 — The limit never costs unsaved work (FR-017, FR-018)

1. Set the device limit low enough to force eviction.
2. Make a change while offline, so it is unsynchronized.
3. Add content until the limit is exceeded.

**Expected**: the unsynchronized change is still there. What was evicted is
recoverable from the server, keeps its title and metadata, and is marked as not
held locally. The storage panel shows what was released and why.

## Verifying the whole gate

```bash
pnpm checks:local
```
