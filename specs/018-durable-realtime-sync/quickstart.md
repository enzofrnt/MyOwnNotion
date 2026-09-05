# Quickstart: Validate durable realtime synchronization


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

This guide is the acceptance walkthrough for feature 018. It is intentionally
failure-first: a pleasant two-browser demo is not sufficient evidence for a
local-first synchronization protocol.

## Preconditions

- Node.js and pnpm versions match the root `package.json`.
- PostgreSQL test services are isolated from any owner data.
- Two browser contexts use distinct profiles and therefore distinct IndexedDB
  databases and authorized device identities.
- The test stack uses the production Web build and same-origin proxy path.
- No Draw.io or external collaboration service is running.
- Artificial network control can cut one context without cutting the other.

Never validate migration against the owner's only browser profile. Use copied
fixtures or a disposable profile.

## Focused implementation loop

Run the smallest relevant families while implementing:

~~~sh
pnpm vitest run --project contracts realtime-page-sync
pnpm vitest run --project client-core realtime
pnpm vitest run --project api-contract websocket
pnpm vitest run --project database-integration page-operation
pnpm playwright test tests/e2e/realtime-page-sync.spec.ts --project=chromium-desktop
~~~

Independent families may run in parallel on a developer machine with enough
memory. Do not run several full Playwright stacks against the same ports or
database. The final pre-push gate remains the single documented command in
`docs/development.md`: `pnpm checks:local`.

## Scenario A — Connected propagation

1. Sign in as device A and device B in isolated profiles.
2. Open the same page in both.
3. Type a unique phrase on A.
4. Without reloading B, observe the phrase and record elapsed time.
5. Format text and move its block on B.
6. Observe the same block identity, content, formatting and location on A.
7. Inspect network traffic.

Expected:

- p95 visibility below two seconds;
- one persistent socket per instance, not per page or keystroke;
- incremental `sync` messages only, no normal `page.document.replace`;
- no conflict or durable-storage warning in the content status;
- both local frontiers and canonical digests agree after settling.

## Scenario B — Same paragraph offline on two devices

1. Start from `Hello world` on both devices and wait for `Synced`.
2. Cut network on both contexts.
3. On A, insert `brave ` before `world`.
4. On B, append `!` and make `world` bold.
5. Confirm each device reports the work saved locally.
6. Close A brutally; keep B open.
7. Reconnect B and wait for server confirmation.
8. Relaunch and reconnect A.
9. Repeat with the reconnection order reversed.

Expected:

- every locally confirmed character and mark survives;
- all replicas converge to the same canonical digest;
- A's restart drains its unopened queued page automatically;
- no whole-document decision is requested.

## Scenario C — Stable moves and delete/edit recovery

Use blocks `p1`, `p2`, `p3` with known UUIDs.

### Move plus edit

1. Offline A moves `p1` after `p3`.
2. Offline B edits the text of `p1`.
3. Reconnect in every tested order.

Expected: one `p1`, after `p3`, carrying B's edit.

### Concurrent moves

1. Offline A moves `p2` first.
2. Offline B moves `p2` last.
3. Deliver updates in normal, reverse and duplicated order.

Expected: exactly one `p2` and one deterministic final order on every replica.

### Delete plus edit

1. Offline A deletes `p2`.
2. Offline B edits `p2`.
3. Reconnect both.

Expected: the visible document remains coherent; if deletion wins visibility,
B's content appears in one scoped owner decision and remains recoverable until
resolved.

## Scenario D — Commit and reply failure matrix

Inject one failure at a time:

| Boundary | Injection | Expected result after restart/retry |
| --- | --- | --- |
| Before IndexedDB commit | Local write rejection | UI says not saved; no phantom pending row |
| After IndexedDB commit, before socket send | Kill browser | Row returns pending and is sent on boot |
| During socket send | Close connection | Same update ID retries |
| Before PostgreSQL commit | Throw in repository | No result or announcement; row remains local |
| After PostgreSQL commit, before result send | Terminate socket | Retry returns `repeated`; one server row |
| After result receive, before local response commit | Kill browser | Retry/recovery reconstructs exact frontier |
| After local response commit, before editor refresh | Throw UI callback | Durable state remains correct; editor repairs on reopen |
| After commit, before announcement | Restart API | Other device catches up on reconnect/safety sweep |

At every row, compare update IDs, page sequences, version vectors, canonical
digests, pending counts and visible labels. No case may show `Synced` before the
required durable stores agree.

## Scenario E — Long absence and large catch-up

1. Snapshot device A's local database and mark it absent for a simulated ninety
   days without revoking it.
2. Produce 10 000 accepted page updates from B across open and closed pages.
3. Restore A's profile and reconnect.
4. Observe bounded batches and memory use.
5. Interrupt midway, restart A, and resume.

Expected:

- no expiry caused only by time;
- bounded request/response sizes and concurrency;
- progress resumes from A's committed local frontier;
- no duplicate operations or full snapshot replacement on the normal catch-up
  path;
- final digests and latest sequences match.

## Scenario F — Historical browser self-repair

Prepare fixtures for local schema versions 1 through 8, emphasizing version 8
with five `page.document.replace` conflicts and a denied persistent-storage
hint.

For each fixture:

1. Open with the new application.
2. Verify schema v9 opens before key unlock without touching ciphertext.
3. Unlock and run recovery.
4. Observe each row transition and interrupt once in `converting`.
5. Restart and finish.

Expected:

- convertible drafts become semantic branches and are synchronized;
- already represented drafts archive without duplicate content;
- unprovable drafts remain encrypted and exportable in quarantine;
- active conflict count reaches zero when no real owner decision exists;
- `storagePersisted === false` is absent from the conflict banner;
- no source conflict disappears before operational proof is durable.

## Scenario G — Security and protocol

Before the transport refusals, validate device attribution:

1. Bootstrap profile A with its passkey and inspect its `deviceId`.
2. Sign profile B in through a complete passkey ceremony or the configured
   password alternative.
3. Confirm A and B have distinct authorized-device rows and session `deviceId`
   values.
4. Sign B out and in again; confirm B reuses its own row.
5. Revoke B and confirm its existing socket closes while A stays connected.

Expected:

- no login is attributed to the first arbitrary device;
- a successful passkey login includes `navigator.credentials.get` and a
  server-verified assertion;
- a revoked binding is never silently activated;
- tabs in one profile share an identity, profiles do not.

Exercise each refusal independently:

- missing/wrong `Origin`;
- missing/expired session cookie;
- missing/wrong CSRF in `hello`;
- unsupported realtime version;
- unsupported page-operation version;
- malformed/oversized message;
- ninth concurrent request;
- second request for the same page while one is in flight;
- revoked device before connect and during an active connection;
- idle client that never answers heartbeat.

Expected:

- documented safe close code/problem;
- no page service invocation before authorization;
- durable local work remains queued;
- revocation prevents reconnect;
- logs contain correlation and safe code but none of the submitted secrets or
  payloads.

## Scenario H — Proxy and local HTTPS

1. Run the official Compose Web/API/PostgreSQL stack.
2. Place the documented HTTPS proxy in front of the published Web port without
   adding it to the committed production stack.
3. Sign in with a passkey at the configured public origin.
4. Keep a page idle beyond the proxy's default timeout, then edit on B.
5. Restart Web nginx and then the API independently.

Expected:

- WebSocket upgrade reaches the API through both proxy layers;
- heartbeat prevents silent idle expiry under the documented configuration;
- if either layer restarts, clients return to local mode, reconnect and drain;
- passkeys and cookies remain pinned to the HTTPS origin;
- no Draw.io container is present.

## Scenario I — Files and restore

1. Add a file block offline.
2. Reconnect with document transport available but pause byte upload.
3. Verify the page operation may converge while global status remains pending.
4. Complete upload and verify `Synced`.
5. Restore a server backup from before the edit while A retains the newer local
   operation.
6. Reconnect A and B.

Expected:

- status waits for document and bytes;
- restoration never lets an old full document silently overwrite A;
- newer local intention is integrated or preserved as a scoped decision;
- backup fixtures still restore operational checkpoints, updates and
  projections consistently.

## Automated acceptance gates

- 1 000 generated delivery/reconnect permutations.
- 100 same-paragraph offline cases.
- 100 move+edit cases and 100 concurrent-move cases.
- 100 delete+edit recoverability cases.
- 100 commit-with-lost-reply retries.
- Every failure boundary in Scenario D.
- Every historical fixture in Scenario F.
- Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile.
- Existing reference backup, migration, security, performance, Compose, image
  and production-build gates.

## Completion evidence

Record in `validation.md` during implementation:

- exact commands and commit;
- generated-test seeds or replay artifacts;
- p50/p95 propagation and reconnect timings;
- browser/profile matrix;
- device/session identity counts for both profiles and same-profile reuse;
- migration fixture outcomes and quarantine inventory;
- fault-injection boundary results;
- final `pnpm checks:local` result;
- pull-request and `main` CI URLs.
