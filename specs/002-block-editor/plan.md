# Implementation Plan: Block Editor

**Branch**: `codex/block-editor` | **Date**: 2026-08-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-block-editor/spec.md`

## Summary

Replace the raw page-document JSON textarea with an accessible offline-first block editor. Tiptap 3 supplies the ProseMirror transaction model, common nodes and marks, input rules, history, React integration, and a local slash-command suggestion surface. Canonical content remains the existing `myownnotion.document+json` envelope, with a new version 2 body containing validated Tiptap JSON rather than rendered HTML. The existing IndexedDB projection/outbox, causal revisions, reconciliation, PostgreSQL JSONB document store, exports, Docker images, and CI remain the delivery foundation.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24.19.0; React 19 in supported evergreen browsers

**Primary Dependencies**: Tiptap 3 React bindings, ProseMirror runtime, StarterKit, list/task extensions, Placeholder, Suggestion; existing React, Dexie, Fastify, Drizzle, PostgreSQL

**Storage**: Existing PostgreSQL `page_documents` JSONB envelope and revision snapshots; existing Dexie local projection and outbox

**Testing**: Vitest unit/property/contract tests, existing PostgreSQL integration tests, Playwright Chromium/Firefox/WebKit desktop and mobile journeys, Biome and strict TypeScript

**Target Platform**: Responsive offline-capable web application served through the existing containerized web/API topology

**Project Type**: pnpm workspace web application with API and shared domain/client packages

**Performance Goals**: p95 local keystroke-to-visible update below 100 ms for a representative 2,000-block document; saves coalesced without losing the newest state

**Constraints**: Offline-first; private text never logged; page-only editing; no HTML as canonical content; no silent unknown-node loss; loopback-only deployment; no real-time collaborative merge

**Scale/Scope**: Permanent single owner; one editor surface; 8 block families, 4 marks, slash commands, Markdown input rules, v1-empty compatibility, v2 export round trip

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design response | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Editor reads and writes the durable local projection/outbox first and remains usable offline; JSON export remains documented | Pass |
| II. One Spec, Any Agent | All intent and progress live under `specs/002-block-editor/` | Pass |
| III. Incremental, Verifiable Delivery | Page editing, slash commands, shortcuts, and offline durability are independent tested stories with responsive Playwright coverage | Pass |
| IV. Privacy and Security by Default | Document text is excluded from diagnostics; schema validation rejects malformed content; no new remote service | Pass |
| V. Simple, Modular Architecture | Tiptap is confined behind an editor-document boundary and reuses existing persistence rather than creating a service or parallel model | Pass |
| VI. Accessible and Predictable Experience | Toolbar, editor, command list, focus, keyboard operation, save state, errors, and conflicts are acceptance requirements | Pass |
| VII. Reproducible Toolchains and Enforced Quality | Dependencies use the pinned pnpm workflow and all existing CI gates remain required | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/002-block-editor/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/
├── src/features/editor/
│   ├── block-editor.tsx
│   ├── editor-toolbar.tsx
│   ├── slash-command.ts
│   ├── slash-command-menu.tsx
│   └── save-coordinator.ts
├── src/features/pages/page-document-form.tsx
├── src/services/local-content.ts
└── src/styles.css

packages/domain/
├── src/content/editor-document.ts
├── src/content/hierarchy.ts
└── tests/editor-document.spec.ts

packages/contracts/src/content-api.ts
packages/client-core/tests/
tests/
├── contract/editor-export.spec.ts
├── e2e/block-editor.spec.ts
├── e2e/block-editor-offline.spec.ts
└── performance/block-editor.perf.spec.ts
```

**Structure Decision**: Keep the editor UI inside the existing web feature boundary and put canonical v2 validation/normalization in the platform-independent domain package. No schema migration or new deployable service is required because both canonical and local document stores already persist versioned JSON envelopes.

## Design Decisions

- `formatVersion: 2` identifies validated editor JSON. Version 1 empty bodies normalize to one empty paragraph in memory and upgrade only when the owner saves.
- Canonical bodies are JSON trees rooted at `doc`; HTML is presentation-only and never stored or synchronized.
- Supported nodes and marks are allow-listed in the domain validator. Unknown content returns a safe incompatibility state and is never passed through a destructive editor load.
- StarterKit provides paragraph, headings, bullet/ordered lists, quote, code block, horizontal rule, marks, history, and input rules. Task list/item and Placeholder are explicit additions.
- Slash commands use the local Suggestion utility with start-of-line activation, synchronous filtering, managed popup positioning, and no network dependency.
- Editor updates enter a serialized coalescing save coordinator. At most one local mutation is in flight; if content changes during it, only the latest pending snapshot is saved next.
- The local projection/outbox transaction remains the durability boundary. The editor reports local save separately from reconciliation state.
- The existing JSONB database column and export representation need no migration; validation and fixtures expand to v2.
- No exception to the constitution is required.
