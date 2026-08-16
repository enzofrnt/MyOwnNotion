# Phase 1 Data Model: Unified Items and Page/Folder Conversion

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

The normative description of the unified item. It changes two things in feature
001's model — the kind becomes mutable, and the placements denormalisation
changes what it copies — and nothing else.

---

## Item

| Field | Type | Rule |
|-------|------|------|
| `id` | UUIDv7 | Unchanged. Never changes, including across a conversion. |
| `kind` | `page` \| `folder` \| `file` | **Now mutable between `page` and `folder`.** Never to or from `file`. |
| `name` | 1–512 chars | Unchanged. |
| `lifecycle` | `active` \| `trashed` \| `purged` | Unchanged. |
| `currentRevisionId` | UUID | Unchanged. A conversion advances it like any mutation. |

**What each kind may hold:**

| | hierarchy children | editorial content | content attachments |
|---|---|---|---|
| `folder` | yes | no | no |
| `page` | yes | yes | yes |
| `file` | no — files are terminal | no | n/a |

The shared base is the first column. A page adds the second and third. That is
the whole difference, and it is why the two are one model rather than two.

**The kind transition rule**, and it is total:

```
folder → page    allowed, additive, no confirmation
page   → folder  allowed, destructive, confirmation required when content exists
file   → *       forbidden
* → file         forbidden
X → X            no-op, not an error
```

`file` is excluded because a file is terminal — it has no children and no
content — so a conversion would have nothing to preserve and nothing to add.
Excluding it is also what makes the placements change below sound.

---

## Placement — the one schema change

Today `placements` carries `item_kind`, denormalised from `items.kind`, behind:

```sql
CONSTRAINT placements_item_kind_fk FOREIGN KEY (item_id, item_kind)
    REFERENCES items (id, kind)
```

It becomes `item_is_file boolean`, behind the equivalent key on `(id, is_file)`.

**Why this is not a loss.** Both constraints that read the column ask only
whether the item is a file:

| Constraint | What it asserts | What it needs |
|------------|-----------------|---------------|
| `placements_attachment_file_check` | an attachment is a file | is it a file |
| `placements_single_hierarchy_unique` | a non-file has exactly one hierarchy placement | is it a file |

Neither has ever distinguished a page from a folder. Denormalising `is_file`
keeps both guarantees exactly, and makes conversion **structurally unable to
affect placements** — nothing cascades because nothing a placement depends on
has changed.

**Why it is sound**: because `file` is excluded from conversion. If files were
convertible, `is_file` would be mutable too and this would only move the
problem. The transition rule above is therefore load-bearing, not a
convenience.

`items` gains `is_file boolean GENERATED ALWAYS AS (kind = 'file') STORED` with
a unique index on `(id, is_file)`, so the two columns cannot disagree — the
database computes one from the other rather than trusting a writer.

---

## Two relations, not two views of one

This is the distinction FR-015 asks the interface to show, and it already
exists in the data. It is restated here because conflating the two is the
failure mode.

| | stored as | parent may be | shown as |
|---|---|---|---|
| **Hierarchy child** | placement with `kind = 'hierarchy'` | a page **or** a folder | the tree disclosure, for both kinds |
| **Content attachment** | placement with `kind = 'attachment'` | a page only | the attachments control, pages only |
| **Internal page link** | `page:link` relationship plus an inline `pageLink` mark | a page-compatible item | an in-content link, never a tree child |

A standalone file filed under a folder is a *hierarchy child* and always was
legal. A file bound to a page's text is an *attachment*. Same table, different
`kind`, different meaning — and a page is the only item that has both.
An internal page link is the third relation: it stores the target's canonical
identity and is deliberately independent from hierarchy placement. Conversion
changes `kind`, not the target identity or the relation endpoint.

---

## Page document

`page_documents` is unchanged in shape. What changes is its lifecycle:

- Created or replaced when a page's content is edited (feature 001, feature 003).
- **Deleted when a page becomes a folder**, in the same transaction as the kind
  change, together with its protected envelope.

The envelope deletion is not tidiness. Feature 002 seals the body beside the
row; keeping it would leave content the owner deliberately destroyed sitting on
disk, encrypted, where no screen shows it and no owner would look. The revision
snapshot is the opposite case and must survive — it is what makes the
destruction undoable, it is visible in the history, and it expires on the
existing retention schedule.

---

## Conversion *(the operation, as data)*

A conversion is a mutation, and produces a revision like every other.

| Field | Rule |
|-------|------|
| `itemId` | The item. Its identity does not change. |
| `targetKind` | `page` or `folder`. |
| `confirmedDestruction` | Required and must be `true` when converting a page that holds content. Carried **in the command**, not set later. |
| `baseRevisionId` | The causal base, as every mutation has. |

**Invariants, all enforced in the domain:**

1. Identity is preserved. A conversion is never a delete plus a create.
2. Every hierarchy child keeps its parent and its position, in both directions.
3. Content attachments are removed with the content they were bound to, and only
   then.
4. A page with content cannot become a folder without `confirmedDestruction`.
5. A conversion to the kind an item already has is a no-op, not an error —
   otherwise a retried offline command fails on replay.
6. Files never convert.

Invariant 4 is the one that must live here rather than in a screen. That is
FR-014, and it is the reason this is a named operation at all.
