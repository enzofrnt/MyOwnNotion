# Implementation Plan: Tasks and Planning Views

**Branch**: `codex/tasks` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-tasks/spec.md`

## Summary

Extend the canonical editor document to version 4 so each task item carries a stable task identity, consistent status/checkbox state, optional calendar due date, and fixed priority. Derive task projections as pure data from page documents already present in PostgreSQL snapshots and the IndexedDB item projection, avoiding a second materialized task store or synchronization protocol. The editor assigns metadata to new and legacy task items, exposes focused task controls, and the workspace adds deterministic list and status-board views with calendar scopes, filters, sorting, source navigation, offline operation, and conflict recovery.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24; React 19 in supported evergreen browsers

**Primary Dependencies**: Existing Tiptap 3 React/list extensions and ProseMirror runtime; existing React, Dexie, Fastify, Drizzle, and PostgreSQL; native date inputs and CSS grid

**Storage**: Existing PostgreSQL `page_documents`, revisions, mutations, and change feed; existing Dexie items, revisions, outbox, conflicts, and metadata. No new table is required because task projections are deterministic views of canonical page documents.

**Testing**: Vitest unit/property/contract tests, PostgreSQL integration/fault-injection tests, Playwright Chromium/Firefox/WebKit desktop and mobile journeys, performance fixtures, Biome, strict TypeScript, production builds, and container smoke

**Target Platform**: Responsive offline-capable web application served through the existing containerized web/API topology

**Project Type**: pnpm workspace web application with API and shared domain/client packages

**Performance Goals**: Extract, classify, filter, sort, and switch a 5,000-task local projection within one second on the reference desktop environment; focused editor controls remain visually immediate

**Constraints**: Offline-first; stable task identity; document/task consistency by pure derivation; date-only calendar semantics; private titles and filter text never logged; no new service; loopback-only deployment until authentication exists

**Scale/Scope**: Permanent single owner; document format versions 1–4; four task states; four priorities; five built-in scopes; list and status-board views; 5,000-task acceptance fixture

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design response | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Task metadata remains in versioned page documents and export; every planning read derives from the durable local item projection and offline edits use the existing atomic outbox path | Pass |
| II. One Spec, Any Agent | Intent, design, contracts, validation, and progress remain under `specs/004-tasks/` | Pass |
| III. Incremental, Verifiable Delivery | Capture, metadata, cross-page views, and offline recovery are independently testable stories with domain, contract, fault, responsive, browser, and performance coverage | Pass |
| IV. Privacy and Security by Default | Strict metadata validation prevents malformed state; task titles, page text, and filters remain excluded from logs; no sharing or remote provider is added | Pass |
| V. Simple, Modular Architecture | A pure projection over existing page documents avoids a table, endpoint, migration, cache invalidation path, or deployable unit without sacrificing current requirements | Pass |
| VI. Accessible and Predictable Experience | Checkbox/status consistency, labelled controls, keyboard source navigation, textual status/priority, semantic list/board structures, focus, and responsive criteria are explicit | Pass |
| VII. Reproducible Toolchains and Enforced Quality | No dependency or toolchain is introduced; all existing pinned format, lint, type, test, build, browser, artifact, and container gates remain required | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/004-tasks/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
├── contracts/
│   ├── task-document.schema.json
│   └── task-projection.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/
├── src/content/editor-document.ts
├── src/content/task-planning.ts
└── tests/
    ├── editor-document.spec.ts
    └── task-planning.spec.ts

apps/web/src/
├── features/editor/
│   ├── block-editor.tsx
│   ├── editor-extensions.ts
│   ├── task-item.ts
│   └── task-details.tsx
├── features/tasks/
│   ├── task-board.tsx
│   ├── task-list.tsx
│   └── task-workspace.tsx
├── features/hierarchy/hierarchy-explorer.tsx
├── services/local-content.ts
└── styles.css

packages/contracts/src/content-api.ts
packages/client-core/src/outbox/apply-to-projection.ts
packages/database/src/mutations/execute-command.ts
apps/api/tests/page-documents.contract.spec.ts
tests/
├── contract/editor-export.spec.ts
├── e2e/tasks-capture.spec.ts
├── e2e/tasks-offline.spec.ts
├── e2e/tasks-views.spec.ts
└── performance/tasks.perf.spec.ts
```

**Structure Decision**: Keep version-4 validation, extraction, calendar classification, filtering, and sorting in the platform-independent domain package. Reuse the current page-document mutation, revision, export, snapshot, and reconciliation paths unchanged structurally. Keep editor-specific identity assignment and controls inside the editor feature and compose presentation-only task views from the local content service.

## Design Decisions

- `formatVersion: 4` extends `taskItem.attrs` with `taskId`, `status`, `dueDate`, and `priority` alongside the existing `checked` flag. Versions 1–3 remain readable; they upgrade only through an accepted editor save.
- Version-4 validation requires UUID task identities, valid enumerations, either `null` or a real `YYYY-MM-DD` calendar date, unique task IDs within the document, and exact checkbox/status consistency. Todo and in-progress are unchecked, completed is checked, and cancelled is unchecked.
- A custom extension of the installed task-item node assigns missing UUIDv7 identities and default metadata to newly inserted or legacy task items. Its transaction reconciliation maps checkbox toggles to completed/todo and task-detail commands update status plus checkbox together.
- `extractTaskProjections(page)` walks a validated editor tree in document order. The first paragraph supplies a plain-text title, empty titles receive an explicit presentation fallback, nesting/path is presentation metadata, and page identity/lifecycle is joined by the caller.
- The task projection is deliberately not materialized. Canonical writes store one page document; server validation, revision restoration, export, snapshot delivery, local optimistic writes, catch-up, and conflict preservation already move that document atomically. Both canonical tests and local reads invoke the same pure extractor, eliminating document/projection drift by construction.
- The task workspace scans locally available active page documents, builds the projection once per refresh, and applies pure scope/filter/sort functions. All, Today, Upcoming, Overdue, and Finished use the device-local `YYYY-MM-DD` supplied as an explicit input for deterministic tests.
- List and board render the same filtered array. The board groups by fixed status without drag-and-drop; all updates continue through the source editor to avoid a second editing surface and ambiguous document placement.
- Task navigation selects the stable source page and passes a task focus target to the editor. Task items render stable data attributes so the editor can focus and reveal the destination without encoding DOM coordinates in canonical content.
- Task titles and filter values are never sent to diagnostic logging. Existing API log redaction is extended with tests for version-4 payloads.
- Playwright journeys attach deterministic desktop/mobile images for capture, task details, list scopes, and status board; existing CI publication retains the report, images, and traces.
- The existing API/web images and Compose topology are rebuilt. Container smoke creates a version-4 task document and proves metadata persistence after restart; no migration or new environment variable is required.

No exception to the constitution is required.
