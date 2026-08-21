# Implementation Plan: Multi-Device Synchronization

> **Supersession note (2026-08-20)**: This plan describes the delivered
> feature-006 baseline. Feature 017 preserves its transport and device
> foundations but replaces the page-body three-way merge with an operational,
> convergent editing path.

**Branch**: `feat/006-multi-device-sync` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-multi-device-sync/spec.md`

## Summary

Features 001 to 005 already provide the parts synchronization is built from: an
ordered change feed with a cursor and compaction, revisions with causal parents,
a durable outbox, save state derived from that outbox, and authorised devices.

Four things are missing, and only two of them are mechanisms:

1. **Push.** Devices learn about changes when they next ask. This adds a stream
   that tells them the feed advanced.
2. **Resolution.** Conflicts are detected and retained already; nothing lets the
   owner decide between the versions.
3. **A version gate.** Nothing stops an out-of-date client writing.
4. **Attribution.** History cannot say which device made a change.

Conflict *detection* is deliberately untouched: it already distinguishes a
device that is behind from one that diverged, and a second detector could only
disagree with the first.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 24 LTS

**Primary Dependencies**: existing — Fastify, Drizzle, React 19, Dexie. Added:
none. Server-sent events are plain HTTP, and the merge is a pure function.

**Storage**: PostgreSQL 18; one nullable column added. No new table.

**Testing**: Vitest with fast-check for the merge rule, contract tests for the
stream and the version gate, Playwright for two-device journeys.

**Target Platform**: self-hosted server behind an administrator's reverse proxy;
browsers, two most recent stable major versions.

**Project Type**: web application, existing monorepo.

**Performance Goals**: a change visible on another device in under two seconds
in 95% of measured cases; one notification plus one fetch, no polling.

**Constraints**: no event ever lost; no version destroyed before resolution;
nothing pushed that bypasses the protections the pull path enforces.

**Scale/Scope**: one owner, several devices, a workspace of 100 000 pages per
the canvas's reference set.

## Constitution Check

| Principle | Status | Note |
| --- | --- | --- |
| I. User ownership and local resilience | pass | Catch-up completeness, snapshot rebuild that keeps the outbox, nothing destroyed before resolution. |
| II. One spec, any agent | pass | Spec, plan, research, data model, two contracts, quickstart under this directory. |
| III. Incremental, verifiable delivery | pass | Four stories; the P1 trio is independently testable and each ends shippable. |
| IV. Privacy and security by default | pass | The stream carries a position, never content, so nothing bypasses envelope resolution. Revocation enforced server-side. History records no session identifier or key material. |
| V. Simple, modular architecture | pass | No new service, no new dependency, no second ordering authority, no second conflict detector. |
| VI. Accessible and predictable experience | pass | Six visible states named by the spec; the resolution screen is a keyboard journey; nothing silently prefers a version. |
| VII. Reproducible toolchains | pass | TypeScript only; SSE needs no package. |
| VIII. Canonical product direction | pass | Canvas sections 9 and 17 to 20, without absorbing search (008) or the desktop clients (014). |

No violations, so [Complexity Tracking](#complexity-tracking) stays empty.

Two constraints shaped decisions rather than merely being met:

- *Private content stays private* is why the stream carries a position rather
  than a payload — a pushed payload would skip the sealed-envelope resolution.
- *No feature may imply conflict-free synchronization without acceptance criteria
  for conflicts and recovery* is why resolution is in this feature at all,
  rather than left as "conflicts are recorded".

## Project Structure

### Documentation (this feature)

```
specs/006-multi-device-sync/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── live-stream.md
│   └── conflict-resolution.md
└── checklists/requirements.md
```

### Source Code (repository root)

```
packages/domain/src/sync/
├── merge-documents.ts      # ancestor + local + remote → merged or conflicted (pure)
├── protocol-version.ts     # the window, and what a version may do
└── index.ts

packages/database/
├── migrations/0004_revision_device.sql
└── src/repositories/change-repository.ts   # notify on append

apps/api/src/
├── routes/change-stream.ts  # GET /v1/changes/stream (SSE)
├── sync/change-notifier.ts  # in-process fan-out to open streams
└── plugins/protocol.ts      # header on every response, gate on writes

apps/web/src/features/sync/
├── use-change-stream.ts     # subscribe, reconnect, hand the cursor to the puller
├── conflict-resolution.tsx  # three columns, per-block choice, review
└── connection-state.tsx     # connected / keeping locally

packages/client-core/src/reconciliation/
└── resolve-conflict.ts      # write the resolution with two parents
```

**Structure Decision**: the existing monorepo, unchanged. The merge rule goes in
`packages/domain` for the same reason the eviction rule did — it decides what
happens to an owner's words, so it must be testable exhaustively without a
browser or a database.

## Phase 0 — Research

Complete: [research.md](./research.md). Five decisions. Server-sent events over
WebSocket, because every message is server-to-client and a WebSocket would add a
second write path with none of the existing protections — which is precisely the
defect feature 005 found in the batch route. The event carries a position rather
than a payload, so idempotency is free and nothing bypasses envelope resolution.
Conflict detection is untouched. Merging is per block, because blocks have stable
identities. The protocol version rides on every response and gates writes only,
so an old client is read-only rather than locked out.

## Phase 1 — Design

Complete: [data-model.md](./data-model.md), [contracts/](./contracts/),
[quickstart.md](./quickstart.md).

The shapes that matter:

- **A resolution is a revision with two parents.** That one shape satisfies "the
  originals are kept": both sources stay reachable as ancestors, so it is a
  property of the lineage rather than a retention policy someone must honour.
- **Told about ≠ applied.** The stream's `Last-Event-ID` and the device's cursor
  are allowed to disagree, and the cursor wins. Conflating them is how an event
  gets lost when the fetch after a notification fails.
- **Two version thresholds, not one.** A read minimum and a write minimum are
  what make read-only mode expressible instead of a binary lockout.
- **Deleted on one side, rewritten on the other, is a conflict.** Taking either
  silently discards an intention. This is the row of the merge table a naive
  implementation gets wrong.

## Complexity Tracking

No constitutional violations to justify.
