# Implementation Plan: Core Workspace Experience

**Branch**: `003-core-workspace-experience` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-core-workspace-experience/spec.md`

## Summary

Feature 001 made the content correct and feature 002 made it private. Neither
made it writable: a page today is a title and a `<textarea>` holding raw JSON.
This feature delivers the block editor, the save-state statement, the keyboard
navigable tree, and the 320-pixel layout that turn the existing guarantees into
something an owner would actually use.

The technical centre of the plan is one decision: **the stored document model
is ours, and the editor library renders it**. `myownnotion.document+json`
gains a `formatVersion: 2` body with an explicit, ordered block tree defined in
`@myownnotion/domain` — validated, exportable to Markdown, and with no
dependency on Tiptap, React, or the DOM. Tiptap sits behind a conversion
boundary in the web app, and a block type this client does not recognise
survives a round trip because our converter parks its original JSON in an
opaque node rather than handing it to a schema that would strip it.

Everything else follows from existing machinery. Internal page links are the
one cross-boundary addition: the editor stores a stable target identity in a
`pageLink` mark, and the page-document mutation reconciles the corresponding
`page-link` relationship without changing hierarchy placements. The save state
is derived from feature 001's outbox rather than tracked separately; the sealed
body is still a `Record<string, unknown>` so feature 002's envelopes need no
change at all. The server does not need to interpret the complete editor model,
but validates the explicit page-link target set and updates the canonical
relation index in the same transaction as the document revision.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22 (pinned by the repository),
strict mode, ES modules. No handwritten JavaScript.

**Primary Dependencies**: React 19 (already present); **Tiptap 3 /
ProseMirror** (new, web app only, behind a conversion boundary);
`@axe-core/playwright` (new, test-only, for SC-004). No new server or domain
runtime dependency.

**Storage**: PostgreSQL through Drizzle on the server, Dexie (IndexedDB) for
the local projection. The document body is a JSON column on the server and a
sealed envelope in both places. Page-link target identities are also kept in
the typed relationship projection so backlinks and diagnostics do not require
decrypting every document.

**Testing**: Vitest for domain, contract, and integration levels; fast-check
for the model round-trip properties; Playwright for every user-visible journey,
including the 320-pixel viewport, the keyboard-only journey, the axe audit, and
the two performance benchmarks.

**Target Platform**: Browser — the two most recent stable major versions of
Chrome, Edge, Firefox, and Safari (FR-022), from a 320-pixel viewport upward
(FR-021).

**Project Type**: Web application in an existing pnpm monorepo — `apps/web`
(client), `apps/api` (server), `packages/domain`, `packages/contracts`,
`packages/client-core`, `packages/database`.

**Performance Goals**: Keystroke to visible output under 100 ms at p95 in a
500-block document (SC-005); such a document open and editable within 2 seconds
(SC-006). Both are measured in Playwright against a generated fixture, not
asserted by inspection.

**Constraints**: Editing MUST refuse rather than degrade when the device key is
unavailable (spec edge case, FR-026). The interface MUST NOT show "saved"
before the server confirms (FR-008). An unrecognised block MUST round-trip
byte for byte (SC-009). Internal page links MUST preserve target identity
without creating placements (FR-001a, FR-027, FR-028). No change to canonical
identities, revision lineage, or mutation semantics (FR-025).

**Scale/Scope**: One owner, one workspace. Documents up to 500 blocks are the
tested envelope; the tree is expected in the hundreds to low thousands of items.
Six user stories, 28 functional requirements, 12 success criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How this plan satisfies it |
|-----------|---------|----------------------------|
| I. User Ownership and Local Resilience | **PASS** | Editing works from the local projection with no network; the document model has a documented Markdown export path (FR-005), which is what makes "exportable in durable formats" true rather than aspirational. |
| II. One Spec, Any Agent | **PASS** | Everything lives under `specs/003-core-workspace-experience/`. Product intent stays in `spec.md`, decisions here, progress in `tasks.md`. The product canvas is cited by section, and the section-14 exclusion is recorded in the spec rather than left implicit. |
| III. Incremental, Verifiable Delivery | **PASS** | Six independently testable stories, each with its own Playwright journey at the responsive viewport. The document model gets property tests because a round-trip guarantee stated in prose is not a guarantee. |
| IV. Privacy and Security by Default | **PASS** | No new boundary and no weakening of one. The body stays sealed on the server and in the projection; the editor never sees an unsealed store, and refuses to accept edits when the device key is unavailable. No document content is logged. |
| V. Simple, Modular Architecture | **PASS** | One new domain module and one editor feature module. Tiptap is a real vendor dependency, so it is confined behind a conversion boundary — see Complexity Tracking, where the coupling and its exit are written down rather than assumed away. |
| VI. Accessible and Predictable Experience | **PASS** | This principle is most of the feature: FR-017 to FR-020 make keyboard, focus, semantics, and announcements acceptance criteria, and SC-003 to SC-006 make them measurable from the owner's side. |
| VII. Reproducible Toolchains and Enforced Quality | **PASS** | pnpm only, TypeScript only, new dependencies added to the existing workspace lock. The two new dev-time additions ride the existing CI gates; no new toolchain. |
| VIII. Canonical Product Direction | **PASS** | The spec's scope is canvas sections 7 and 11–13, including the canvas distinction between placements and internal page links. The roadmap's section-14 exclusion remains recorded in the spec and task history. |

**Constraint checks.** Tiptap is named by the constitution as the initial
candidate *provided* the internal content model and export path are preserved —
which is exactly what Phase 1 defines, and the reason the model is not simply
ProseMirror JSON. Single-owner, offline-explicit, TypeScript-only, and the
Compose/`.env.example` constraints are all untouched by this feature.

**Post-design re-evaluation** (after Phase 1): no verdict changed. The design
added no service, no server route, and no storage guarantee; the one item
carried forward is the roadmap amendment above.

## Project Structure

### Documentation (this feature)

```text
specs/003-core-workspace-experience/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions and what was rejected
├── data-model.md        # Phase 1 output — the block model, normatively
├── quickstart.md        # Phase 1 output — how to verify the feature works
├── contracts/
│   ├── document-format.md   # myownnotion.document+json v2
│   ├── save-state.md        # the four states and how each is derived
│   └── ui-semantics.md      # roles, keys, and announcements as a contract
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/domain/src/document/          # NEW — the content model, no UI, no editor
├── block.ts                           # Block types, the registry, type guards
├── document.ts                        # Document envelope, normalisation, invariants
├── validate.ts                        # Parse-or-explain; unknown blocks preserved
├── export-markdown.ts                 # FR-005's documented export path
└── legacy.ts                          # Reading a v1 body without destroying it

packages/contracts/src/content-api.ts  # CHANGED — formatVersion 2 documented
packages/client-core/src/outbox/       # CHANGED — a `blocked` outbox status
packages/client-core/src/save-state/   # NEW — derives FR-007's four states

apps/web/src/features/editor/          # NEW — everything Tiptap touches
├── editor-view.tsx                    # The React surface
├── tiptap-schema.ts                   # ProseMirror nodes mirroring the model
├── to-tiptap.ts / from-tiptap.ts      # The conversion boundary, both directions
├── unknown-block.ts                   # The opaque node that makes FR-006 true
├── page-link.ts                       # Internal page-link mark and presentation
├── page-link-control.tsx              # Accessible local page picker
├── slash-menu.tsx                     # FR-002
└── block-controls.tsx                 # FR-003

apps/web/src/features/navigation/      # NEW — the sidebar tree (FR-012..FR-016)
apps/web/src/features/save-state/      # NEW — the statement (FR-007..FR-011)
apps/web/src/features/connection/      # NEW — trust the connection (FR-023, FR-024)

tests/e2e/                             # Playwright journeys, one file per story
├── block-editor.spec.ts               # US1
├── save-state.spec.ts                 # US2
├── keyboard-navigation.spec.ts        # US3
├── narrow-viewport.spec.ts            # US4
├── connection-trust.spec.ts           # US5
├── page-links.spec.ts                 # US6
├── editor-performance.spec.ts         # SC-005, SC-006
└── accessibility.spec.ts              # EXTENDED — axe on the new screens
```

**Structure Decision**: The existing monorepo layout is kept unchanged, and the
one structural addition is `packages/domain/src/document/`. It sits in the
domain package rather than in `apps/web` for a specific reason: FR-005 requires
the model to be independent of the editing library, and a model that lives next
to the editor drifts into it. Putting it where neither React nor Tiptap can be
imported makes the independence a fact the type checker enforces rather than a
promise in a document. The server remains ignorant of editor rendering, but
the page-document mutation validates the explicit target set and reconciles
`page-link` rows transactionally so the relationship index cannot drift from
the saved document.

## Follow-up editor evolution

Feature 003 remains the editor foundation rather than becoming an evergreen
bucket for every Notion-inspired capability. The richer interaction layer is a
new, independently specified feature after the foundations it consumes are
stable. Its feature number is assigned only after the current roadmap numbering
is reconciled; this plan does not reserve one by guesswork.

The follow-up is sequenced by ownership:

| Increment | Dependency | Technical boundary |
|-----------|------------|--------------------|
| Writing refinement: contextual block menu, drag handle, floating toolbar, colours, collapsible sections, simple document tables, cohesive visual system | Feature 003 | May reuse open-source Tiptap extensions or UI source, but continues through `toTiptap` / `fromTiptap`. |
| Media and file blocks | Feature 005 | Uses the canonical logical-file, transfer, preview, and local-availability contracts; the editor never creates a parallel upload store. |
| Multi-device editing feedback and richer conflict interaction | Feature 006 | Uses the canonical outbox, change stream, revisions, and conflict resolution; no second collaboration document becomes authoritative. |
| Databases and saved views | Separate database feature | A custom node may host a view, but typed properties, queries, filters, sorting, grouping, and view state stay outside the editor document. |

The official Tiptap Notion-like template is reference material, not the plan.
Any later proposal to use its Pro-licensed template, Cloud services,
collaboration backend, AI services, or another hosted dependency must document
licence cost, private-data flow, offline behaviour, self-hosting, replacement,
and failure modes before implementation. Open-source components may be adopted
selectively after compatibility with React 19, the accessibility contract, and
the owned document model is demonstrated.

Every new block type still requires a domain representation, validation,
conversion in both directions, export behaviour, unknown-client preservation,
version compatibility, and tests proving the round trip. A template component
that renders correctly but cannot satisfy those invariants is not adoptable.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| A vendor editor framework (Tiptap/ProseMirror) — a real coupling under Principle V | FR-001 to FR-004 need selection, transformation, drag, input rules, and a correct undo stack over a nested block tree. Writing that on `contenteditable` is a multi-month project with a long tail of browser bugs, and it is not the product. | Building it by hand was rejected on cost and risk; a heavier "batteries-included" block editor (BlockNote, Editor.js) was rejected because it owns the storage format, which is precisely what FR-005 forbids. The coupling is bounded: the domain model has no dependency on it, the conversion is two named files, and replacing the library means rewriting those files, not migrating stored data. |
| A second document format version rather than one canonical shape | Documents already exist in production with an unstructured v1 body, and the server cannot convert them because it cannot read them — they are sealed. | A server-side migration is not merely inconvenient here, it is impossible by design. A client-side destructive upgrade was rejected because it would rewrite an owner's data on read; instead a v1 body is read losslessly (see `legacy.ts`) and only becomes v2 when the owner actually edits it. |
