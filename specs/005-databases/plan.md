# Implementation Plan: Structured Databases

**Branch**: `codex/databases` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-databases/spec.md`

## Summary

Extend canonical page documents to version 5 with one strict `databaseBlock` node whose attributes own stable database, property, option, record, relation, and view identities. Keep the complete database inside the same versioned page document so existing PostgreSQL JSONB, IndexedDB projection, outbox, snapshots, conflicts, export, and restore paths remain atomic without another table or protocol. Add pure domain validation and projection functions, a Tiptap React node view for record/property editing, equivalent table/board/gallery presentations, and focused contract, offline, responsive, performance, export, and production-restart evidence.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24; React 19 in supported evergreen browsers

**Primary Dependencies**: Existing Tiptap 3 React/ProseMirror runtime, React, Dexie, Fastify, Drizzle, PostgreSQL, Playwright, Vitest, and native HTML form controls

**Storage**: Existing PostgreSQL `page_documents` JSONB and revision/change tables; existing Dexie items, revisions, outbox, conflicts, and metadata. No database migration or new table is required.

**Testing**: Vitest unit/property/contract/fault tests, existing PostgreSQL contract coverage, Playwright Chromium/Firefox/WebKit desktop/mobile journeys, performance fixtures, Biome, strict TypeScript, production builds, and isolated Compose smoke

**Target Platform**: Responsive offline-capable web application served by the existing web/API composition

**Project Type**: pnpm workspace web application with API and shared domain/client packages

**Performance Goals**: Validate, search, sort, and derive table/board/gallery projections for 1,000 records and 20 properties within one second

**Constraints**: Local-first; strict stable identities; one canonical document transaction; date-only semantics; private schema/value/filter text never logged; no second data store; at most 20 optional properties and 1,000 records per block

**Scale/Scope**: One database block may contain 1,000 records, 20 properties, 50 options per select, and 200 targets per relation value; relations remain inside the owning database

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design response | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Schema, records, values, relations, and view configuration stay in the exported versioned page document and use the existing offline mutation path | Pass |
| II. One Spec, Any Agent | Intent, design, tasks, contracts, validation, and progress live only under `specs/005-databases/` | Pass |
| III. Incremental, Verifiable Delivery | Stable records, table operations, alternate views, and offline relations are independent stories with focused automated evidence | Pass |
| IV. Privacy and Security by Default | Exact allow-lists and limits reject malformed data; body/schema/value/query content is absent from logs | Pass |
| V. Simple, Modular Architecture | A page-owned document block avoids a database service, table, migration, endpoint, local cache, and cross-document transaction | Pass |
| VI. Accessible and Predictable Experience | Semantic table, grouped lists, cards, labelled editors, focus handoff, contained overflow, and keyboard journeys are acceptance gates | Pass |
| VII. Reproducible Toolchains and Enforced Quality | No dependency or toolchain is added; all pinned repository gates remain required | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/005-databases/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
├── contracts/
│   ├── database-block.schema.json
│   └── database-projection.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/
├── src/content/editor-document.ts
├── src/content/database.ts
└── tests/database.spec.ts

apps/web/src/features/databases/
├── database-block.ts
├── database-node-view.tsx
├── database-table.tsx
├── database-board.tsx
├── database-gallery.tsx
└── database-block.spec.ts

tests/
├── fixtures/databases.ts
├── e2e/databases-*.spec.ts
└── performance/databases.perf.spec.ts
```

**Structure Decision**: Keep strict structures and all view derivation in the platform-independent domain package. The Tiptap extension owns insertion and attribute updates; focused React components render equivalent semantic views. Existing page save, local projection, server persistence, reconciliation, export, and history paths carry the version-5 document unchanged.

## Data and Synchronization Design

- `databaseBlock.attrs` contains a `databaseId`, internal schema version, ordered property definitions, ordered records with typed values, and one current view configuration.
- Values are an ordered list keyed by property UUID rather than an unvalidated object. Each value repeats its property type, enabling exact runtime validation and safe property removal.
- Select and relation values store stable option or record UUIDs. Current labels are resolved from the owning block. Missing relation targets remain diagnosable.
- Domain validation enforces exact keys, supported types, cross-reference integrity, unique identities, limits, finite numbers, real calendar dates, and property/value type agreement.
- Database UI updates one node's attributes. The existing editor save coordinator validates and writes the complete version-5 page document and outbox entry atomically.
- Incremental catch-up, snapshot fallback, conflict retention, revision restore, and canonical export need no database-specific persistence branch; focused tests prove that generic document transport remains complete.

## Operational Impact

- No schema migration, environment variable, port, service, dependency, or image topology change.
- API and web images rebuild normally. The production smoke writes a version-5 database fixture, restarts Compose, and checks exact identity/schema/value/view persistence through the same-origin proxy.
- Playwright capture, table, board, gallery, and offline journeys attach review screenshots to the existing 14-day GitHub artifact.

## Complexity Tracking

No constitution violation or intentional quality exception is introduced.
