# Implementation Plan: Links and Knowledge Graph

**Branch**: `codex/links-knowledge-graph` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-links-knowledge-graph/spec.md`

## Summary

Extend the canonical editor document to version 3 with an allow-listed inline `wikiLink` mark carrying stable target and occurrence identities. Page-document replacement atomically reconciles those occurrences into the existing typed relationship store, and relationship state is included in snapshot/change reconciliation so the IndexedDB projection remains complete offline. The web client adds a local `[[` page picker, link navigation, backlink/outgoing summaries, and deterministic local/global SVG graphs with an equivalent semantic list. No new service or database table is introduced.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js 24; React 19 in supported evergreen browsers

**Primary Dependencies**: Existing Tiptap 3 core/React/Suggestion and ProseMirror runtime; existing React, Dexie, Fastify, Drizzle, PostgreSQL; native SVG for graph rendering

**Storage**: Existing PostgreSQL `page_documents`, `relationships`, revisions, mutations, and change feed; existing Dexie items, relationships, revisions, outbox, conflicts, and metadata

**Testing**: Vitest unit/property/contract tests, PostgreSQL integration/fault-injection tests, Playwright Chromium/Firefox/WebKit desktop and mobile journeys, performance fixtures, Biome and strict TypeScript

**Target Platform**: Responsive offline-capable web application served through the existing containerized web/API topology

**Project Type**: pnpm workspace web application with API and shared domain/client packages

**Performance Goals**: Build and filter a deterministic 500-node/1,000-edge graph within 1 second on the reference desktop environment; page-link menu filtering remains visually immediate for 500 candidates

**Constraints**: Offline-first; atomic page-document/relationship acceptance; private labels and queries never logged; no external graph service; no persisted graph coordinates; page-to-page links only; loopback-only deployment until authentication exists

**Scale/Scope**: Permanent single owner; document format versions 1–3; one inline wiki-link mark; local and global graph modes; 500-page/1,000-connection acceptance fixture

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Design response | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Links, relationships, backlink summaries, and graph data live in the local projection; versioned JSON export retains both document occurrences and canonical relationships | Pass |
| II. One Spec, Any Agent | Intent, design, contracts, validation, and progress remain under `specs/003-links-knowledge-graph/` | Pass |
| III. Incremental, Verifiable Delivery | Wiki-link editing, backlinks, graph exploration, and offline reconciliation are independently testable stories with domain, integration, contract, responsive, and performance coverage | Pass |
| IV. Privacy and Security by Default | Only stable identifiers cross mutation boundaries; malformed targets are rejected; page text, queries, and graph labels are excluded from logs; no sharing surface is added | Pass |
| V. Simple, Modular Architecture | The feature reuses the editor, typed relationships, JSONB document store, Dexie projection, API, and Compose topology; graph derivation is a pure domain function and SVG avoids a new rendering dependency | Pass |
| VI. Accessible and Predictable Experience | `[[` search, link activation, summaries, filters, graph selection, focus, offline state, and list alternatives have explicit keyboard and responsive acceptance criteria | Pass |
| VII. Reproducible Toolchains and Enforced Quality | No new toolchain is introduced; all existing pinned pnpm, TypeScript, static, test, build, browser, artifact, and container gates remain required | Pass |

## Project Structure

### Documentation (this feature)

```text
specs/003-links-knowledge-graph/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
├── contracts/
│   ├── knowledge-projection.md
│   └── wiki-link-document.schema.json
└── tasks.md
```

### Source Code (repository root)

```text
apps/web/src/
├── features/editor/
│   ├── block-editor.tsx
│   ├── editor-extensions.ts
│   ├── wiki-link.ts
│   ├── wiki-link-menu.tsx
│   └── wiki-link.spec.ts
├── features/knowledge/
│   ├── knowledge-panel.tsx
│   ├── knowledge-graph.tsx
│   └── knowledge-links.tsx
├── features/hierarchy/hierarchy-explorer.tsx
├── features/pages/page-document-form.tsx
├── services/local-content.ts
└── styles.css

packages/domain/
├── src/content/editor-document.ts
├── src/content/knowledge-graph.ts
├── src/content/relationships.ts
└── tests/
    ├── editor-document.spec.ts
    └── knowledge-graph.spec.ts

packages/client-core/
├── src/local-store/local-repository.ts
├── src/local-store/schema.ts
├── src/outbox/apply-to-projection.ts
├── src/reconciliation/reconcile.ts
└── tests/

packages/database/
├── src/mutations/execute-command.ts
├── src/repositories/relationship-repository.ts
└── tests/relationships.integration.spec.ts

packages/contracts/src/content-api.ts
apps/api/src/routes/changes.ts
tests/
├── contract/
├── e2e/knowledge-graph.spec.ts
├── e2e/wiki-links-offline.spec.ts
├── e2e/wiki-links.spec.ts
└── performance/knowledge-graph.perf.spec.ts
```

**Structure Decision**: Keep canonical wiki-link validation and graph aggregation in the platform-independent domain package, atomic relationship projection beside existing database mutation execution, offline hydration in client-core, and all user-facing behavior in focused web feature directories. The existing API and deployment units remain unchanged.

## Design Decisions

- `formatVersion: 3` extends the canonical editor JSON with a `wikiLink` mark. Versions 1 and 2 remain readable; they upgrade only after an accepted edit.
- A wiki-link mark carries `targetItemId` and `occurrenceId`. The visible text is ordinary editable content, while identity and navigation never depend on that label.
- Active `link:references` relationship rows form the current derived projection of wiki-link occurrences. Page-document replacement validates targets and reconciles additions, retained occurrences, removals, and restored occurrences inside the same database or Dexie transaction.
- Relationship rows are included in verified snapshots and relevant change envelopes. Applying a source-page change replaces only that source's derived wiki relationships so unrelated explicit relationship types remain untouched.
- Backlink/outgoing summaries and graph edges aggregate occurrences by ordered source-target pair while retaining exact occurrence counts.
- The `[[` picker uses the installed Suggestion utility with a multi-character trigger, synchronous local filtering, managed viewport positioning, keyboard/pointer input, and no remote request.
- The graph builder is a pure deterministic function. A bounded SVG view provides spatial discovery; a semantic list is always rendered from the same graph model and is the accessibility authority.
- The graph uses a stable radial layout for local mode and stable concentric placement for global mode. Coordinates are presentation state and are neither synchronized nor exported.
- Restoring a document revision re-runs the same relationship projection logic, so the restored document and current backlinks cannot diverge.
- Existing JSONB tables and relationship columns already satisfy the data shape; no database migration or new deployable service is required.
- GitHub Actions retains Playwright screenshots/traces as artifacts and the validation report references desktop/mobile evidence. The existing production Compose smoke is extended with a version-3 link persistence assertion and its documented local-build path remains authoritative for unmerged revisions.
- No exception to the constitution is required.
