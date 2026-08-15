# Phase 1 Data Model: Core Workspace Experience

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

This is the normative description of the document content model — the entity
FR-005 requires to be documented and library-independent. It lives in
`packages/domain/src/document/`, where neither React nor Tiptap can be imported,
so the independence is enforced by the module graph rather than by convention.

Nothing here changes the entities of feature 001. Items, placements, revisions,
and lineage are untouched (FR-025); this document defines only what is *inside*
the page-document body that feature 001 already stores and feature 002 already
seals.

---

## Document

The outer envelope is unchanged from feature 001 and remains
`PageDocumentSchema` in `@myownnotion/contracts`. Version 2 is a statement
about the `body`, not about the envelope.

| Field | Type | Rule |
|-------|------|------|
| `format` | `"myownnotion.document+json"` | Unchanged. |
| `formatVersion` | integer ≥ 1 | `2` for documents using the block model. `1` means a legacy body (see *Legacy documents*). |
| `body` | object | For version 2: `{ blocks: Block[] }`. |

**Body invariants** (version 2):

- `blocks` is present and is an array. An empty array is a valid, empty document.
- Every block has a unique `id` within the document, including nested children.
- Block order in the array *is* document order. There is no separate ordering
  key; this is a single-owner document edited as a whole, not a set of
  independently placed rows, and inventing a position key here would duplicate a
  mechanism feature 001 already owns at the item level.

`formatVersion` is the only version marker. An earlier draft carried a second
version inside the body; it was removed because two version numbers that can
disagree are worse than one.

---

## Block

The addressable unit. Every block, of every type, has these three fields:

| Field | Type | Rule |
|-------|------|------|
| `id` | UUIDv7 string | Stable for the life of the block. Generated with the existing `generateUuidV7()`, so ids sort in creation order — the same property the feature-002 capture boundary relies on. |
| `type` | string | One of the known types below, or anything else, which makes it an **unknown block**. |
| `children` | `Block[]` (optional) | Absent or empty means a leaf. Only the types marked below may carry children. |

Type-specific fields are listed with each type. A block MUST NOT carry fields
its type does not define — except an unknown block, which by definition carries
whatever it carries.

### Known block types

| `type` | Extra fields | Children | Requirement |
|--------|--------------|----------|-------------|
| `paragraph` | `content: Inline[]` | no | FR-001 |
| `heading` | `content: Inline[]`, `level: 1 \| 2 \| 3` | no | FR-001 (at least three levels) |
| `bulletedListItem` | `content: Inline[]` | **yes** | FR-001 |
| `numberedListItem` | `content: Inline[]` | **yes** | FR-001 |
| `checkbox` | `content: Inline[]`, `checked: boolean` | **yes** | FR-001 |
| `quote` | `content: Inline[]` | **yes** | FR-001 |
| `code` | `text: string`, `language: string \| null` | no | FR-001 |
| `divider` | — | no | FR-001 |

Two notes on the shape of that table.

**A code block holds `text`, not `Inline[]`.** Marks inside code are not
meaningful, and allowing them would create documents whose Markdown export
cannot represent them — the failure mode the last spec edge case names.

**Lists nest through `children`, not through a list container.** FR-001 asks
for bulleted and numbered lists; a container node would add a second way to
express the same document (an empty list, a list containing one item, a list
containing another list), and every such ambiguity is a case the round-trip
property has to pin down. Items nest directly.

### Link is a mark, not a block

FR-001 lists "link" among the block types. It is implemented as an inline mark
because that is what a link is — a span of text pointing somewhere, not a
paragraph-level unit. The requirement is met (an owner can create a link); the
placement in the model differs from the sentence in the spec, and this is the
deliberate reading rather than an omission.

---

## Inline

The content of a text-bearing block. An array of nodes, in document order.

| Field | Type | Rule |
|-------|------|------|
| `text` | string | May be empty only if the array itself would otherwise be empty; adjacent nodes with identical marks are merged on normalisation, so `["a"]["b"]` never survives as two nodes. |
| `marks` | `Mark[]` (optional) | Absent means unmarked. |

**Marks**: `bold`, `italic`, `strikethrough`, `code`, and `link`. Only `link`
carries data: `{ type: "link", href: string }`. `href` must be a parseable
absolute URL with an `http:`, `https:`, or `mailto:` scheme — a `javascript:`
URL is rejected at validation, not merely unrendered, so it cannot reach the
stored document from a paste.

Normalisation is defined and total: marks are sorted by type, adjacent nodes
with equal mark sets are merged, and empty text nodes are dropped. This exists
so the round-trip property has a fixed point to compare against; without it,
"the document is unchanged" would depend on how the editor happened to split
its text.

---

## Unknown block

A block whose `type` is not in the table above. It is **data, not an error**.

- It is **preserved verbatim** on save: the parsed JSON value received from
  storage is re-emitted, never reconstructed from what was displayed (FR-006,
  SC-009).
- It is **displayed as unrenderable** — a visible placeholder naming the type,
  not an empty space and not a silent gap (FR-006).
- It is **not editable**, and it is **movable and deletable**, because an owner
  must be able to organise a document without understanding every block in it.
- Its `id`, if it has one, is used for addressing. If it has none, one is
  assigned in memory for the editing session only and is not written back.

**On "byte for byte" (SC-009).** The guarantee holds because the value is never
interpreted: it is carried through the editor as an opaque attribute and
re-serialised from the same object. One honest limit is worth stating — an
object key that looks like an array index (`"0"`, `"1"`) is reordered by the
JavaScript engine itself during `JSON.parse`, before any of our code runs. Such
keys do not occur in any document this application produces, and the property
test asserts the guarantee over the shapes that can actually occur rather than
claiming something the runtime cannot deliver.

---

## Legacy documents (`formatVersion: 1`)

A body that is not `{ blocks: [...] }` is a legacy body. Feature 001 defined it
as a free-form object, so there is no shape to parse.

- It is read **losslessly** and shown as one read-only code block containing
  its JSON, so nothing is hidden from the owner.
- It is **not rewritten on open**. The upgrade happens on the owner's first
  edit, and only then.
- On that first edit, the original body is preserved as a single unknown block
  of type `legacyBody` inside the new v2 document, so the upgrade adds structure
  around the old content instead of replacing it.

The server takes no part in this. It cannot: since feature 002 the body is a
sealed envelope and the server holds no key. That is a property of the design
to preserve, not an obstacle to route around.

---

## Editing session *(transient — not stored)*

The owner's in-progress state for one open document. Named as an entity in the
spec, recorded here as explicitly **not persisted**:

- undo/redo history — per session, per the spec's Assumptions;
- current selection and cursor;
- the derived save state (see [contracts/save-state.md](./contracts/save-state.md)),
  which is read from the outbox rather than held here.

It appears in this document precisely so that nobody adds a table for it.

---

## Navigation state *(persisted locally, per installation)*

What makes returning to a page feel like returning (FR-014).

| Field | Type | Rule |
|-------|------|------|
| `expandedItemIds` | UUID set | Which branches are open. |
| `lastVisitedItemId` | UUID or null | For restoring the workspace on open. |
| `scrollPositions` | map: item id → number | Bounded to the most recent 50 entries, discarded oldest-first, so this cannot grow without limit. |

Stored in the local projection (Dexie), not on the server. It is device
ergonomics, not content: it does not participate in revisions, reconciliation,
or the outbox, and losing it costs an owner a scroll position. Favourites and
recents are the opposite case — the spec assumes they are per-installation, so
they are content and belong to the server-backed model, not here.

---

## Validation

`validate.ts` exposes one entry point that either returns a typed document or
explains what is wrong, and never throws for content reasons. Two rules govern
it, and they are the ones that matter:

1. **An unknown block is never a validation failure.** Forward compatibility is
   the requirement; rejecting the document would turn a newer block type into an
   outage.
2. **A malformed *known* block is a failure.** A `heading` with `level: 9`, a
   `checkbox` with no `checked`, a `link` with a `javascript:` href — these are
   corruption or attack, not the future, and are reported rather than
   normalised into something plausible.

The distinction is the whole design: we are permissive about what we do not
recognise, and strict about what we do.
