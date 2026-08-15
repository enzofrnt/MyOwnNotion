# Implementation Plan: Unified Items and Page/Folder Conversion

**Branch**: `004-unified-items-conversion` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-unified-items-conversion/spec.md`

## Summary

An item's `kind` is fixed at creation today, and one schema decision is the
reason: `placements` denormalises it, with a composite foreign key
`(item_id, item_kind) → items (id, kind)`. Changing an item's kind would break
that key on every placement it has.

The plan turns on noticing that **the denormalisation copies more than it
needs**. Both constraints that use `item_kind` only ever ask whether the item is
a *file*:

```sql
(kind <> 'attachment') OR (item_kind = 'file')          -- attachments are files
WHERE kind = 'hierarchy' AND ... AND item_kind <> 'file' -- non-files: one placement
```

Neither distinguishes a page from a folder. So the column denormalises a
mutable value in order to enforce a rule about an immutable one. Replacing it
with the property the rules actually use — is this item a file — makes the
conversion **structurally unable to affect placements**: nothing cascades,
because nothing the placements depend on has changed.

Everything else follows. `item.convert` becomes a named mutation alongside
`item.rename`, producing a revision like any other, and carrying the
destructive-direction guard in the domain where no client can skip it (FR-014).
Page → folder deletes the page document and its protected envelope inside the
same transaction as the kind change, so an item is never a folder that still
owns a document.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 22, strict, ES modules.

**Primary Dependencies**: No new runtime dependency. Drizzle, Fastify, TypeBox,
React 19 and Tiptap are all already present.

**Storage**: PostgreSQL 18 through Drizzle; Dexie for the local projection. This
feature reshapes the `placements` denormalisation and collapses the migration
history into one initial migration — permitted because no installation is in
production and there is no data to preserve.

**Testing**: Vitest for domain, contract and integration; fast-check for the
conversion invariants; Playwright for the two conversion journeys, the two
disclosures and the keyboard path.

**Target Platform**: Browser client against the self-hosted server; unchanged.

**Project Type**: Web application in the existing pnpm monorepo.

**Performance Goals**: A conversion completes within 2 seconds from the owner's
perspective in a workspace of 1,000 items (SC-009). It is a single-row update
plus at most one delete, so the target is about the round trip rather than the
work.

**Constraints**: Identity and hierarchy children preserved in both directions,
without exception (FR-007, FR-008). No destructive conversion without an
explicit confirmation carried in the domain (FR-010, FR-014). Document bodies
stay sealed (FR-019). Revision lineage unchanged beyond the kind becoming
mutable (FR-020).

**Scale/Scope**: One owner, one workspace, hundreds to low thousands of items.
Four user stories, 20 functional requirements, 9 success criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | How this plan satisfies it |
|-----------|---------|----------------------------|
| I. User Ownership and Local Resilience | **PASS** | Conversion works from the local projection through the existing outbox. The destructive direction stays recoverable through the revision history the owner already has. |
| II. One Spec, Any Agent | **PASS** | Everything under `specs/004-unified-items-conversion/`. The canvas was amended in the change that raised the feature, not after. |
| III. Incremental, Verifiable Delivery | **PASS** | Four independently testable stories. US1 (folder → page) ships alone and is useful alone. Each conversion direction gets a Playwright journey; the preservation invariants get property tests, because "children are preserved" asserted on three examples is not the same claim. |
| IV. Privacy and Security by Default | **PASS** | No new boundary. Deleting a page document also deletes its protected envelope in the same transaction — leaving a sealed envelope behind for content the owner destroyed would be the one privacy regression available here. |
| V. Simple, Modular Architecture | **PASS** | One new mutation, no new service, one schema simplification that removes a column rather than adding one. |
| VI. Accessible and Predictable Experience | **PASS** | FR-018 puts keyboard completion and announcement in the acceptance criteria; the confirmation is a real dialog, not a `window.confirm`. |
| VII. Reproducible Toolchains and Enforced Quality | **PASS** | pnpm and TypeScript only, no new tooling. The migration collapse keeps the same runner and the same CI migration check. |
| VIII. Canonical Product Direction | **PASS** | Canvas sections 11 and 12 amended, roadmap realigned, and spec 003's cross-references updated — all in the change that raised this feature. |

**Constraint check.** Single-owner, offline-explicit and TypeScript-only are
untouched. The migration collapse deserves its own note: constitution principle
VII requires CI to validate migrations, and it still will — the check runs
against whatever migration set exists, and a single initial migration is a
smaller surface, not an unchecked one.

**Post-design re-evaluation** (after Phase 1): no verdict changed. The design
removed a column and added a mutation; it introduced no service, no new
boundary, and no new dependency.

## Project Structure

### Documentation (this feature)

```text
specs/004-unified-items-conversion/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions and what was rejected
├── data-model.md        # Phase 1 — the unified item, normatively
├── quickstart.md        # Phase 1 — how to verify it works
├── contracts/
│   ├── convert-mutation.md   # The named operation and its guarantees
│   └── item-model.md         # What a kind means, and what it does not
├── checklists/
│   └── requirements.md  # Written by /speckit-specify
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
packages/domain/src/content/
├── conversion.ts                      # NEW — the rules, pure and testable
├── mutations.ts                       # CHANGED — `item.convert` command
├── types.ts                           # CHANGED — mutable kind, new error codes
└── file-placements.ts                 # CHANGED — reads `isFile`, not `kind`

packages/database/
├── migrations/0001_initial.sql        # REPLACES 0001–0005 (see research)
├── src/schema/index.ts                # CHANGED — placements denormalise isFile
└── src/repositories/content/
    └── conversion-repository.ts       # NEW — one transaction, kind + document

packages/contracts/src/content-api.ts  # CHANGED — the convert command shape
packages/client-core/src/outbox/       # CHANGED — convert applies to projection

apps/api/src/routes/                   # CHANGED — the command reaches the domain
apps/web/src/features/navigation/
├── convert-item.tsx                   # NEW — the control and its confirmation
└── tree.tsx                           # CHANGED — two disclosures for a page

tests/e2e/item-conversion.spec.ts      # NEW — both directions, keyboard, a11y
```

**Structure Decision**: The existing layout is kept and the conversion rules go
in `packages/domain/src/content/`, beside the hierarchy rules they extend. That
placement is what makes FR-014 true rather than aspirational: a rule living in
the domain is one every caller passes through, including the API, the offline
client and any future one. A rule living in `apps/web` is one the next screen
can forget.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Rewriting the migration history into one initial migration | The placements denormalisation changes shape, and expressing that as an incremental migration means writing a data migration for rows that do not exist, then maintaining it forever. | Keeping 0001–0005 and adding 0006 was the default and was rejected only because the application has no production installation — the owner confirmed this explicitly. The moment one exists, this option disappears and additive migrations become mandatory again. This is recorded as an exception under the constitution's "deliberate exception" rule, with its removal condition being the first deployment. |
| A named `item.convert` mutation rather than reusing `item.rename` for the kind | FR-010 and FR-014 require the destructive direction to be refused unless confirmed, in the domain. A generic field update has nowhere to put that check that a caller cannot bypass. | Making `kind` an ordinary updatable field was considered and rejected with the owner: it is less code, but the confirmation becomes a property of one screen, and any other path — a script, a direct API call, a future client — empties a page silently. |
