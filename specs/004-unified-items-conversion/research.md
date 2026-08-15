# Phase 0 Research: Unified Items and Page/Folder Conversion

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-08-15

Five questions had to be answered before the design could be written. The first
one determines the other four.

---

## 1. What actually stops an item's kind from changing?

**Decision**: The `placements` table denormalises `item_kind` behind a composite
foreign key. Replace that denormalisation with `item_is_file`, the property the
constraints actually use.

**Rationale**: The obstacle is not that the model calls the field immutable —
nothing does. It is this, in `0001_content_foundations.sql`:

```sql
CONSTRAINT placements_item_kind_fk FOREIGN KEY (item_id, item_kind)
    REFERENCES items (id, kind)
```

Change `items.kind` and every placement row for that item violates its foreign
key. That is a real constraint, deliberately placed, and it does useful work —
it lets the database enforce kind-aware rules rather than trusting application
code.

But look at what those rules ask:

```sql
(kind <> 'attachment') OR (item_kind = 'file')            -- an attachment is a file
WHERE kind = 'hierarchy' AND ... AND item_kind <> 'file'  -- a non-file has one placement
```

**Neither distinguishes a page from a folder.** Both ask only whether the item
is a file. The column therefore denormalises a *mutable* value in order to
enforce a rule about an *immutable* one — and that mismatch, not the constraint
itself, is what makes conversion look impossible.

Denormalising `is_file` instead keeps every guarantee the constraints give
today, and makes page ↔ folder conversion **structurally unable to affect
placements**: there is nothing to cascade, because nothing a placement depends
on has changed. The invariant that files are never converted (spec Assumptions)
is what makes the replacement sound, and it is enforced by the conversion rules
rather than assumed.

**Alternatives considered**:

- *`ON UPDATE CASCADE` on the composite key.* One line, and PostgreSQL would
  propagate the new kind to every placement. Rejected not because it fails but
  because it accepts the mismatch and pays for it forever: every conversion
  writes rows that did not need to change, and the schema keeps claiming that a
  placement depends on whether an item is a page.
- *Update the placements in the same transaction.* Same objection, with the
  cascade written by hand instead of by the database.
- *Drop the composite key and check in application code.* Rejected: it trades a
  guarantee the database enforces for one that holds until somebody writes a new
  code path.

---

## 2. Is `item.convert` a mutation of its own, or is `kind` just a field?

**Decision**: A named `item.convert` mutation, alongside `item.rename`, carrying
the destructive-direction guard in the domain.

**Rationale**: FR-010 requires a confirmation before content is destroyed, and
FR-014 requires that guarantee to hold in the domain rather than in the
interface. A generic field update has nowhere to put that check that a caller
cannot bypass — and "cannot bypass" is the whole requirement. With a plain
field, the confirmation is a property of one screen; a script, a direct API
call during testing, or a future mobile client empties a page in silence.

A named operation also makes the conversion legible in the revision history.
Restoring "the state before I converted this" is a thing an owner will want, and
it is far easier to offer when the history says `item.convert` than when it says
a field changed.

This choice was put to the owner with both options and their consequences, and
confirmed.

**Alternatives considered**:

- *`kind` as an ordinary updatable field.* Less code, and the interface could
  still show a warning. Rejected for the reason above: the protection lives
  where the buttons are rather than where the data is.
- *Two mutations, `item.toPage` and `item.toFolder`.* Rejected as the same
  operation split in half: they share every invariant, and only the destructive
  guard differs, which is a branch rather than a second command.

---

## 3. What happens to the page document, and to its sealed envelope?

**Decision**: Page → folder deletes the page document row **and** its protected
envelope, in the same transaction as the kind change.

**Rationale**: Two things would otherwise go wrong, and the second is a privacy
regression rather than an inconsistency.

An item that is a folder while still owning a row in `page_documents`
contradicts the model, and `page_documents.page_id` references `items.id`
without caring about kind — so nothing would stop it. The transaction boundary
is what makes "a folder has no document" true rather than usually true.

More seriously: feature 002 stores the body as a sealed envelope beside the row.
Deleting the document and leaving the envelope would keep the owner's destroyed
content on disk, encrypted, in a place no screen shows and no owner would think
to look. Content the owner deliberately destroyed must not survive in a form
they cannot see or audit.

The revision snapshot is a different matter and must survive: it is what FR-012
makes restorable, it is visible in the history, and it expires on the existing
retention schedule. The distinction is that a snapshot is a record the owner can
find and undo; an orphaned envelope is a copy they cannot.

**Alternatives considered**:

- *Keep the document row and hide it.* Rejected: data no screen shows and no
  owner can audit, which the spec Assumptions already reject.
- *Delete the document, keep the envelope.* Rejected as above.
- *Delete the revision history too.* Rejected: it would make FR-012 impossible
  and turn a recoverable action into a permanent one.

---

## 4. Incremental migration, or one initial migration?

**Decision**: Collapse `0001`–`0005` into a single `0001_initial.sql`.

**Rationale**: The placements denormalisation changes shape. Expressed
incrementally, that means writing a data migration that rewrites `item_kind`
into `item_is_file` for existing rows — and there are no existing rows, because
no installation is deployed. The migration would be written, reviewed, tested
and maintained forever in order to transform data that does not exist.

The owner authorised this explicitly, including resetting the local development
database.

**This is a deliberate exception with a removal condition**, recorded here as
the constitution requires: **the moment a production installation exists, this
option disappears** and additive migrations become mandatory again. The
collapsed migration is not a precedent for the next schema change.

**Alternatives considered**:

- *Add `0006` with an `ALTER TABLE` and a data backfill.* The default, and
  correct in every other circumstance. Rejected only because the data it would
  migrate does not exist.
- *Keep `item_kind` and add `item_is_file` beside it.* Rejected as the worst of
  both: two denormalised columns, one of which is a trap.

---

## 5. How does the client apply a conversion offline?

**Decision**: Through the existing outbox, as an ordinary mutation, with the
confirmation captured **before** the command is enqueued.

**Rationale**: Nothing here needs new synchronisation machinery — feature 001
already reconciles arbitrary mutations, and a conversion is one row. What does
need care is *when* the owner confirms. The confirmation must be part of the
command that is enqueued, not a flag the reconciler sets later, so that a
command replayed after a restart cannot destroy content the owner never agreed
to lose.

The spec's edge case about two devices converting in opposite directions falls
out of the existing reconciliation: last writer wins on the item row, the
conflict is visible, and the hierarchy is untouched either way because
placements never participated.

**Alternatives considered**:

- *Refuse conversion while offline.* Rejected: it contradicts principle I, and
  the operation is no less safe offline than a rename is.
- *Confirm at reconciliation time.* Rejected: it puts a destructive prompt in
  front of an owner minutes or hours after the action they took, with no context
  to answer it.

---

## Resolved unknowns

| Unknown | Resolved by |
|---------|-------------|
| What prevents a mutable kind | Decision 1 — the denormalisation, not the model |
| Named operation vs plain field | Decision 2, confirmed with the owner |
| Fate of the document and its envelope | Decision 3 |
| Migration strategy | Decision 4, with its removal condition |
| Offline behaviour and confirmation timing | Decision 5 |
