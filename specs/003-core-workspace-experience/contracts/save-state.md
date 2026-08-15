# Contract: the save state

**Requirements**: FR-007 to FR-011, SC-010 | **Research**: [decision 4](../research.md)

The interface must always be able to answer "is my work saved?" and must never
answer it optimistically. This file fixes what each answer means and where it
comes from, because a save state that is *computed* in two places will
eventually be computed differently in each.

## The four states

Exactly one applies to a document at any moment.

| State | Meaning to the owner | Derived from |
|-------|----------------------|--------------|
| `unsaved` | Kept on this device, not sent yet | an outbox row for this item with status `pending` |
| `sending` | On its way to the server | an outbox row with status `sending` |
| `blocked` | The server refused; existing content is still readable | an outbox row with status `blocked` |
| `saved` | The server has confirmed it | **no** outbox row for this item |

`conflict` is a fifth outbox status and is deliberately not a save state. A
conflict is not a stage of saving — it is a question for the owner — and it
surfaces through its own affordance under FR-011.

## Rules

**`saved` is the absence of pending work, never a hopeful assumption**
(FR-008). It cannot be set on optimistic local application, on a request being
issued, or on a timer. The outbox row is removed when the server confirms, and
the state follows from the removal.

**Offline is a presentation of `unsaved`, not a sixth state** (FR-007, US2
scenario 2). The wording changes — "kept on this device, will be sent when
you're back online" — because the owner's question offline is different. The
underlying state does not, because the row is `pending` either way and inventing
an `offline` state would put connectivity and durability in one field.

**`blocked` must say three things** (FR-010): what is refused, that existing
content is still readable, and what would resolve it. A rotation write block is
the case that exists today, and the reason the status is added: the current set
(`pending | sending | conflict`) can only express "not yet", which is a lie when
retrying cannot help.

**Every transition into `blocked` or `conflict` is announced** to assistive
technology, not only rendered (FR-020). A state an owner has to notice is a
state that will be missed.

## Interface

```ts
type SaveState =
  | { kind: "saved" }
  | { kind: "unsaved"; offline: boolean }
  | { kind: "sending" }
  | { kind: "blocked"; reason: string; resolution: string };

function deriveSaveState(rows: readonly OutboxMutationRow[], online: boolean): SaveState;
```

Pure, synchronous, and total over the outbox rows for one item — which is what
makes it directly testable without a browser, and testable at the same level
where the guarantee actually matters.

Precedence when several rows exist for one item, worst-first: `blocked`, then
`sending`, then `unsaved`, then `saved`. A document with one blocked write and
three pending ones is blocked; reporting the cheerier of two true facts is the
same failure as reporting a false one.

## Schema change

`OutboxStatus` in `packages/client-core/src/local-store/schema.ts` gains
`blocked`:

```ts
type OutboxStatus = "pending" | "sending" | "conflict" | "blocked";
```

This is a local-projection change and requires a `LOCAL_SCHEMA_VERSION` bump
with a Dexie upgrade path. No existing row is rewritten: `blocked` is only ever
written by a future refusal, so the upgrade widens what is storable without
touching what is stored.
