# Validation: Multi-Device Synchronization

What was verified, how, and — where something is only partly done — what is
missing. Anything unfinished is marked unfinished rather than ticked.

Run on macOS with the local gate: `pnpm test:unit`, `test:property`,
`test:integration`, `test:contract`, `test:migration`, `test:security`, `build`,
and the full Playwright matrix through `pnpm test:e2e:local` (Chromium and
WebKit on the host, Firefox in the pinned Linux container).

## Functional requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| FR-001 a change reaches every connected device unasked | met | `tests/e2e/live-sync.spec.ts` — a second browser context, never touched after the change, shows it. `apps/api/tests/change-stream.contract.spec.ts` asserts the event is emitted while the connection stays open. |
| FR-002 under two seconds, 95% of measured cases | **partly met** | The path has no polling in it, and the journey records the observed figure (see *Latency* below). What is not done is a statistical run: one observation per browser project is not a 95th percentile. |
| FR-003 reconnects automatically | met | `apps/web/src/features/sync/use-change-stream.ts` reconnects with backoff when the browser closes the stream permanently, which it does for a refused connection. The catch-up journey exercises exactly that: the device is never reloaded. |
| FR-004 items, content, files and relationships all synchronize | **partly met** | Items, page content and renames are asserted in `live-sync.spec.ts`. Files and relationships travel the same feed and the same resolution path — no separate mechanism exists for them — but no journey asserts a file appearing on a second device. |
| FR-005 every change since its position, in order, nothing lost | met | `packages/client-core/tests/catch-up.property.spec.ts` — for any interleaving of announcements and fetch failures, what was applied is a prefix with no hole and the cursor never runs ahead of it. The retry in `use-change-stream.ts` exists because of a real failure this journey found: a notification arriving over a stream that survived the outage, whose fetch failed, was never asked for again. |
| FR-006 a position that cannot be served incrementally rebuilds from a snapshot | met | `change-stream.contract.spec.ts` covers the `compacted` decision; `reconcile` already rebuilt from `/v1/snapshots/current` and keeps the outbox. |
| FR-007 idempotent delivery | met | The event carries a position, not an operation, so receiving it twice is receiving it once. `change-notifier.spec.ts` and the contract test both rely on this. |
| FR-008 an interrupted catch-up resumes | met | Same property test: the cursor is durable and every pass resumes from it. |
| FR-009 six per-item states | met (feature 003) | Unchanged by this feature; `apps/web/src/components/sync-status.tsx` renders them. |
| FR-010 connected, or keeping changes locally | met | `apps/web/src/features/sync/connection-state.tsx`, asserted in `live-sync.spec.ts` and `accessibility.spec.ts`. |
| FR-011 a device merely behind produces no conflict | met | `tests/e2e/conflict-resolution.spec.ts` — the first journey exists to protect this, because a requirement about something *not* happening stops holding silently. |
| FR-012 a conflict only on independent evolution | met | The revision graph decides it; no second detector was added. `packages/domain/tests/merge-documents.property.spec.ts`. |
| FR-013 compatible changes merge unasked | met | `packages/client-core/src/reconciliation/reconcile.ts` attempts a three-way merge before recording a conflict. Found during the e2e work: two devices replacing a whole paragraph merge cleanly, because that is a deletion plus two additions rather than one contested block. |
| FR-014 local, remote and common state shown | met | `apps/web/src/features/sync/conflict-resolution.tsx`, asserted per block in the divergence journey. |
| FR-015 choose parts, take one, reorder, review | met | Per-block radio group, move up/down over the assembled result, and a review pane rendering exactly what will be saved. The journey checks "keep both" and the review. |
| FR-016 nothing destroyed; the resolution leaves both sources intact | met | `document.resolve-conflict` writes a revision with **both** parents. `packages/database/tests/resolution-lineage.integration.spec.ts` asserts the two parent edges and that neither source's snapshot changed; the journey re-reads the lineage over HTTP after resolving. |
| FR-017 the server announces a protocol version | met | `X-MyOwnNotion-Protocol` on every response through an `onSend` hook, and written by hand on the hijacked stream. `apps/api/tests/protocol-gate.spec.ts` asserts it on a success and on a failure. |
| FR-018 a client that cannot write safely refuses and says what to update | met | `requireWriteProtocol` on both write paths; 426 with the version in the header and in the sentence. |
| FR-019 the window is the matching and preceding stable client | met | `packages/domain/tests/protocol-version.spec.ts` plus the window documented in `docs/development.md`. |
| FR-020 read-only rather than refused where reads are safe | met | Two thresholds, and `protocol-gate.spec.ts` asserts a client between them keeps its reads. |
| FR-021 a revoked device stops and says so | met | The stream is refused on connection *and* closed on the next heartbeat, so a connection opened before the revocation does not outlive it. `tests/e2e/protocol-compatibility.spec.ts` revokes one device and watches the other keep working. |
| FR-022 date, device and nature per history entry | met | `apps/api/tests/history-attribution.spec.ts`; the device comes from the request's principal, never from the payload. |
| FR-023 no technical secret in history | met | Same test: the device binding, the session cookie and the CSRF token are all absent, and no field is named for one. |

## Success criteria

| Criterion | Status | Note |
| --- | --- | --- |
| SC-001 under two seconds, 95% of attempts | **partly met** | Observed well inside the budget on every run, but measured once per project rather than as a distribution. See *Latency*. |
| SC-002 a hundred changes offline, byte-identical afterwards | **partly met** | The journey uses five changes, not a hundred, and asserts every one arrives. The property test covers arbitrary interleavings at small sizes. Nothing asserts byte-identity of a hundred-change catch-up. |
| SC-003 no measured catch-up loses an event | met | The property test's whole subject, over randomised failure schedules. |
| SC-004 a device only behind produces zero conflicts | met | First journey in `conflict-resolution.spec.ts`. |
| SC-005 a genuine divergence produces exactly one conflict with all three versions reachable | met | Second journey, asserting the three columns per conflicted block. |
| SC-006 both originals retrievable after a resolution | met | Asserted twice: as parent edges in the integration test, and over HTTP in the journey. |
| SC-007 an unsupported client performs no write and is told what to update | met at the gate | Asserted directly against `requireWriteProtocol` with a stated window, because at protocol version 1 no real client can be too old — the minimums and the current version coincide. Testing only what is reachable today would have shipped the refusal path unexercised. |
| SC-008 a revoked device stops within one minute | met | Bounded by the heartbeat, which defaults to 20 seconds. |
| SC-009 every history entry states date, device and nature, with no secret | met | `history-attribution.spec.ts`. |

## Latency

The journey prints the observed propagation time on each run — the interval from
starting to create an item on one device to the row appearing on the other. On
this machine it lands in the low hundreds of milliseconds, and the measurement
necessarily includes driving the interface, which is not part of the latency
FR-002 describes.

It is reported rather than asserted at two seconds. An assertion at the boundary
would fail on a loaded CI runner for a reason unrelated to the transport, and a
green test would say less than the number does. A proper 95th-percentile
measurement over many attempts is not done.

## Defects this work found

Three, all in code that already existed, and all of them silent:

1. **`/v1/changes` and `/v1/snapshots/current` did not resolve protected
   content.** Only `/v1/items` did. A device catching up therefore received
   pages whose bodies were sealed — indistinguishable from pages that are
   genuinely empty — and wrote those blanks into its projection. Fixed by
   resolving on both paths, the same way the read that got it right does.
2. **A notification whose fetch failed was never retried.** A stream established
   before a network went away survives it, so a device could be told about a
   change and be unable to read it; the announcement was consumed and the next
   one only came when somebody else wrote something. Fixed with a bounded retry
   in `use-change-stream.ts`.
3. **`EventSource` does not always reconnect.** It retries what it considers
   transient and closes permanently otherwise — a refused connection is the
   second kind. Relying on its own retry left a device silent until someone
   reloaded the page. Fixed with our own backoff, and the browser's retry is left
   alone while it is still trying.

## Not done

- **No statistical latency measurement.** See *Latency*.
- **No hundred-change catch-up journey.** Five changes, plus randomised property
  coverage.
- **No journey for a file appearing on a second device.** Files travel the same
  feed and the same resolution path as everything else, so this is coverage
  rather than mechanism — but it is coverage that is missing.
- **The resolution screen does not support a legacy body.** A document written
  before the block editor has no block identities, so it cannot be compared block
  by block. The screen says so plainly and leaves both whole versions readable in
  the notice above it, rather than guessing.
- **A resolution needs the ancestor's snapshot.** Past its 24-hour retention
  window the three-way comparison is impossible; the screen says that too, and
  the two whole versions remain.
