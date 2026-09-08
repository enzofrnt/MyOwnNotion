# Quickstart: verifying unified items and conversion


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to convince yourself this works. Each section names the story or criterion
it settles.

## Prerequisites

```bash
pnpm install
docker compose up -d --wait postgres
```

**This feature resets the local database.** The migration history is collapsed
into a single initial migration, so an existing local volume must be discarded:

```bash
docker compose down -v && docker compose up -d --wait postgres
```

That is safe here and only here — no installation is deployed. See
[research.md decision 4](./research.md) for the removal condition.

## The full gate

```bash
pnpm checks:local
pnpm test:e2e
```

Note that a local Playwright run may exclude Firefox: its browser binary does
not launch on every machine. CI is the gate for that engine.

## The conversion rules (FR-004 to FR-014)

```bash
pnpm test:unit -- conversion
pnpm test:property -- conversion
```

What the property tests establish, and why each matters:

- **Children survive every conversion**, in both directions, over generated
  trees. Asserted as a property rather than on three examples, because "the
  hierarchy is preserved" is a claim about all shapes — including a folder with
  a hundred children and a page nested six deep.
- **Identity survives.** The item id and its revision lineage are unchanged.
- **A page with content cannot become a folder without confirmation**, whatever
  the caller. This is FR-014, tested at the domain level precisely because that
  is where the guarantee is supposed to live.
- **Converting to the current kind is a no-op**, so a replayed offline command
  succeeds instead of failing on the second attempt.
- **Files never convert**, in either direction.

## Turning a folder into a page (US1)

```bash
pnpm test:e2e -- item-conversion
```

By hand:

1. Create a folder, put two pages and a file inside it.
2. Convert it to a page — no confirmation should be asked, because nothing is lost.
3. Write a sentence and save.
4. Reload: the sentence is there and all three children are in place, in order.

## Turning a page into a folder (US2)

By hand, and worth doing once for the warning alone:

1. Create a page, write a heading and a paragraph, add two child pages.
2. Convert it to a folder. The confirmation must name what is destroyed — the
   content and the attachments bound to it — and say recovery is limited to the
   retention window.
3. Decline: nothing changes at all.
4. Accept: the text is gone, both child pages are still there and in order.
5. Restore the revision from before the conversion: the text comes back.

## Preserving an internal page link through conversion

1. Create a source page and a target page; insert the target as an internal
   page link in the source document, without making it a child.
2. Convert the target between page and folder.
3. Confirm the source link still points to the same target identity and the
   target has not acquired a new hierarchy placement.

## The two disclosures (US3, FR-015, FR-016)

Put a file **under** a page in the hierarchy, and attach a different file to the
page's **content**. Then confirm:

- the first appears in the tree, the second does not;
- the second appears in the attachments control, the first does not;
- a folder offers the tree disclosure only.

This is the one part of the feature where a passing test and a correct interface
can diverge, so look at it as well as testing it.

## Database invariants

```bash
pnpm test:integration -- conversion
```

Asserts what the schema now guarantees: converting an item touches no placement
row, the composite key still holds, a folder never owns a page document, and a
deleted document leaves no protected envelope behind.

## Accessibility and keyboard (FR-018, SC-007, SC-008)

```bash
pnpm test:e2e -- item-conversion
```

Both conversions completable by keyboard alone; the confirmation is a real
dialog that takes focus, returns it on close, and is announced. The axe audit
covers the confirmation, which is easy to omit because it is not on screen at
load.

## What is deliberately not verified here

**SC-009** (conversion within 2 seconds in a workspace of 1,000 items) needs a
seeded workspace at that size; it runs in the performance suite rather than in
the journey.

**Firefox** is covered by CI rather than locally, as noted above.
