# Implementation Plan: Freeform Canvas

**Branch**: `codex/freeform-canvas` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-freeform-canvas/spec.md`

## Summary

Extend canonical page documents to version 6 with one strict `canvasBlock` atom whose attributes own stable canvas, card, connection, stroke, and viewport identities. Keep the complete canvas inside the same page document so existing PostgreSQL JSONB, revisions, IndexedDB projection, outbox, snapshots, conflicts, exports, and production composition remain atomic. Represent page cards as existing `link:references` occurrences keyed by card identity so backlinks and the knowledge graph include canvas references without another relationship type. Add pure domain validation and geometry projection, an accessible React node view backed by native HTML/SVG, equivalent keyboard and pointer controls, and focused offline, responsive, performance, export, revision, and production-restart evidence.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24; React 19 in supported evergreen browsers

**Primary Dependencies**: Existing Tiptap 3 React/ProseMirror runtime, React, Dexie, Fastify, Drizzle, PostgreSQL, Playwright, Vitest, and native HTML/SVG/pointer events

**Storage**: Existing PostgreSQL `page_documents` JSONB, revision/change/relationship tables, and existing Dexie items, relationships, revisions, outbox, conflicts, and metadata. No migration or new table is required.

**Testing**: Vitest unit/property/contract/fault tests, existing PostgreSQL API contracts, Playwright Chromium/Firefox/WebKit desktop/mobile journeys, deterministic screenshots, performance fixtures, Biome, strict TypeScript, production builds, and isolated Compose smoke

**Target Platform**: Responsive offline-capable web application served by the existing web/API composition

**Project Type**: pnpm workspace web application with API and shared domain/client packages

**Performance Goals**: Validate and project 500 cards, 1,000 connections, and 200 strokes within one second; keep individual pointer/keyboard updates proportional to the affected canvas collections

**Constraints**: Local-first; strict stable identities; one canonical document transaction; no second canvas store; private content and geometry never logged; finite coordinates; native rendering without a diagramming dependency

**Scale/Scope**: Up to 500 cards, 1,000 directed connections, 200 strokes, 1,000 points per stroke, signed coordinates/pan within ±1,000,000, card sizes within 160–800 × 96–600, and zoom from 0.25× to 4×

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design response | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Cards, geometry, edges, strokes, viewport, page targets, relationships, revisions, and exports use the existing local-first document path | Pass |
| II. One Spec, Any Agent | Intent, design, tasks, contracts, validation, and progress live only under `specs/006-freeform-canvas/` | Pass |
| III. Incremental, Verifiable Delivery | Spatial cards, connections/drawing, page inclusion, and offline recovery are independent stories with focused evidence | Pass |
| IV. Privacy and Security by Default | Exact allow-lists and limits reject malformed geometry; request bodies and private canvas values stay out of logs | Pass |
| V. Simple, Modular Architecture | One page-owned atom, pure domain helpers, native DOM/SVG, and existing relationship projection avoid a canvas service, table, migration, cache, or dependency | Pass |
| VI. Accessible and Predictable Experience | Semantic lists, labelled controls, focus handoff, keyboard movement, explicit unavailable states, and contained overflow are acceptance gates | Pass |
| VII. Reproducible Toolchains and Enforced Quality | No toolchain or dependency is added; every pinned repository gate remains required | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/006-freeform-canvas/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
├── contracts/
│   ├── canvas-block.schema.json
│   └── canvas-projection.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/
├── src/content/editor-document.ts
├── src/content/canvas.ts
└── tests/canvas.spec.ts

apps/web/src/features/canvas/
├── canvas-block.ts
├── canvas-extension.ts
├── canvas-node-view.tsx
├── canvas-surface.tsx
└── canvas-block.spec.ts

tests/
├── fixtures/canvas.ts
├── e2e/canvas-*.spec.ts
└── performance/canvas.perf.spec.ts
```

**Structure Decision**: Keep strict canvas structures, cleanup rules, coordinate conversion, and connection geometry in the platform-independent domain package. Immutable web commands update one atom. A focused React node view owns form state and composes one clipped surface whose cards are native controls and whose connections/strokes are SVG. The existing page save, relationship reconciliation, local projection, server persistence, export, and history paths carry the version-6 document unchanged.

## Data and Synchronization Design

- `canvasBlock.attrs` contains one `canvasId`, internal schema version, ordered cards, connections, strokes, and saved viewport.
- Text cards store bounded text. Page cards store only stable item UUIDs; current names are resolved from the already-local page candidates and missing targets render explicitly.
- Card identity doubles as the occurrence identity for page-card `link:references` projection. The combined document occurrence set remains globally unique, so inline wiki links and page cards cannot collide.
- Connections store stable source/target card IDs. Domain validation rejects self, dangling, duplicate directed pairs, invalid labels, and excess limits. Removing a card immutably removes all incident edges.
- Strokes contain a stable ID, a width from the bounded supported set, and ordered finite points. Pointer-up commits one complete stroke; abandoned gestures never schedule a partial document.
- Viewport pan/zoom is presentation state inside the document. Screen-to-canvas conversion is pure and exact; changing viewport never rewrites cards, connections, or strokes.
- The existing editor save coordinator validates and writes the complete version-6 page document and derived page-card relationships atomically in PostgreSQL and Dexie.
- Incremental catch-up, snapshot fallback, conflict retention, revision restore, and canonical export need no canvas-specific persistence branch; focused tests prove that generic transport remains complete.

## Rendering and Interaction Design

- A fixed-height, clipped `application` surface avoids page-level overflow. One transformed world layer hosts cards and one coordinate-matched SVG hosts connections and strokes.
- Connection endpoints derive from current card centers. SVG lines use markers plus a separate semantic connection list so direction and labels never depend on color.
- Toolbar controls add text/page cards, create connections, enter draw mode, pan, zoom, and reset. A selected-card inspector provides text editing, numeric size, four labelled nudge buttons, removal, and page navigation.
- Pointer drag uses capture and converts screen deltas by the current zoom. Lost capture commits only the last complete finite position. Keyboard controls remain the normative accessible path.
- Draw mode collects transient points outside the canonical document and commits one stroke only after at least two valid points. Stroke selection/removal is also exposed through a semantic list.

## Operational Impact

- No schema migration, environment variable, port, service, dependency, or image topology change.
- API and web images rebuild normally. The production smoke writes a version-6 canvas fixture, restarts Compose, and checks exact card/geometry/edge/stroke/page-target/viewport persistence through the same-origin proxy.
- Playwright empty, connected, page-card, drawing, and offline journeys attach desktop/mobile review screenshots to the existing 14-day GitHub artifact.

## Complexity Tracking

No constitution violation or intentional quality exception is introduced.
