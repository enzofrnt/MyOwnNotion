# Implementation Plan: Files and Local Storage

**Branch**: `feat/005-files-and-local-storage` | **Date**: 2026-08-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-files-and-local-storage/spec.md`

## Summary

Feature 001 already stores files: content addressed by digest, a logical file
record, attachment and hierarchy placements, sealed envelopes. This feature
builds the experience on top and adds the three things the storage layer cannot
supply on its own — knowing where a file is used, surviving an interrupted
transfer, and telling the truth about what this device is actually holding.

Two decisions carry more weight than the rest and are settled in
[research.md](./research.md): Draw.io is served by this installation rather than
embedded from a third party, because the obvious integration would send the
owner's diagrams to `diagrams.net`; and previews run in a sandbox, because SVG
and PDF can carry script and a file is bytes the owner got from somewhere else.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 24 LTS

**Primary Dependencies**: existing — Fastify, Drizzle, React 19, Tiptap 3,
Dexie. Added — a tus-compatible server implementation, and the Draw.io editor
bundled as a static asset.

**Storage**: PostgreSQL 18 for metadata; the existing filesystem blob store for
content; IndexedDB via Dexie for the local projection.

**Testing**: Vitest with fast-check for the domain and client; Playwright for
the journeys, five browser projects, Firefox in the Linux container.

**Target Platform**: self-hosted server behind an administrator's reverse
proxy; browsers, two most recent stable major versions.

**Project Type**: web application, existing monorepo.

**Performance Goals**: a 2 GB upload completes and resumes; a preview opens
without blocking the workspace; local space measurement is not recomputed on
every render.

**Constraints**: offline-capable; local data encrypted at rest; nothing
executed from file content in the application context; no third-party origin
receives content.

**Scale/Scope**: one owner, several devices, a workspace with thousands of
items and files up to 2 GB each.

## Constitution Check

| Principle | Status | Note |
| --- | --- | --- |
| I. User ownership and local resilience | pass | Offline intent, eviction that never touches unsynchronized work, offloaded content always recoverable. |
| II. One spec, any agent | pass | Spec, plan, research, data model, contracts and quickstart all under this directory. |
| III. Incremental, verifiable delivery | pass | Four user stories, independently testable; P1 pair delivers a usable file experience without previews. |
| IV. Privacy and security by default | pass | The decisive one: Draw.io self-hosted rather than embedded, previews sandboxed, downloads served inert, local set encrypted. |
| V. Simple, modular architecture | pass | No new service. tus is a protocol implemented on the existing API; the usage index is a table beside existing ones. |
| VI. Accessible and predictable experience | pass | Availability states named rather than implied; nothing reads as "missing"; refusals state the limit and the reason. |
| VII. Reproducible toolchains | pass | TypeScript only; Draw.io assets pinned and vendored; no new package manager. |
| VIII. Canonical product direction | pass | Realises canvas sections 15 to 18 without absorbing features 010 and 011. |

No violations, so [Complexity Tracking](#complexity-tracking) stays empty.

One constraint deserves restating because it shaped a decision rather than
merely being satisfied: *private content stays private unless deliberately
shared*. That is what rules out the public Draw.io embed, which would otherwise
be the cheapest possible implementation of FR-011.

## Project Structure

### Documentation (this feature)

```
specs/005-files-and-local-storage/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── file-transfer.md
│   └── local-availability.md
└── checklists/requirements.md
```

### Source Code (repository root)

```
packages/domain/src/files/
├── usages.ts            # extract embeds from a block document (pure)
├── eviction.ts          # the priority order, pure and total
└── limits.ts            # what the configured maximum admits

packages/database/
├── migrations/0003_files_and_offline.sql
└── src/repositories/content/
    ├── upload-repository.ts     # tus lifecycle
    └── usage-repository.ts      # the derived index

packages/client-core/src/local-store/
├── availability.ts      # present | offloaded | never-fetched
└── budget.ts            # measurement and the eviction pass

apps/api/src/routes/
├── uploads.ts           # POST/HEAD/PATCH
└── files.ts             # download headers, Range

apps/web/src/features/files/
├── attachment-list.tsx  # the nine fields of FR-002
├── file-preview.tsx     # the sandbox
├── drawio-editor.tsx    # bundled engine
├── delete-file.tsx      # usages before confirmation
└── storage-panel.tsx    # budget, breakdown, what was offloaded
```

**Structure Decision**: the existing monorepo layout, unchanged. Pure rules go
in `packages/domain` where they can be tested without a browser or a database —
the eviction order in particular, because being wrong about it costs an owner
their unsynchronized work and that is not something to discover in a journey.

## Phase 0 — Research

Complete: [research.md](./research.md). Six decisions, each with what it rules
out. Resumable transfer uses tus 1.0 rather than a private scheme; Draw.io is
self-hosted; previews are sandboxed and downloads inert; usages are derived by
indexing rather than hand-maintained; local space is measured with
`navigator.storage` but every eviction is an application decision; offline
intent is content, stored with the item.

## Phase 1 — Design

Complete: [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

The shapes that matter:

- **A partial upload is not an item.** No `logical_file`, no placement, nothing
  in the tree until the bytes are complete and verified. The requirement that a
  partial upload never appears as a file follows from the shape instead of from
  a check someone must remember.
- **Three availability states, not two.** `offloaded` and `never-fetched` read
  identically if collapsed, and mean different things to an owner deciding
  whether something is safe.
- **Recoverability is what admits content to eviction.** Size and age only
  order what is already admitted. Said the other way round, the tempting
  shortcut — evict the biggest — is how unsynchronized work gets released.

## Complexity Tracking

No constitutional violations to justify.
