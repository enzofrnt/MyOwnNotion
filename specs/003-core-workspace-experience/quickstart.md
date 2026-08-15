# Quickstart: verifying the Core Workspace Experience

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

How to convince yourself this feature works, from a clean checkout. Each
section names the user story or success criterion it settles, so a reviewer can
check the ones they care about rather than all of them.

## Prerequisites

```bash
pnpm install
docker compose up -d --wait postgres   # PostgreSQL for the integration and e2e levels
```

Migrations are applied by the `migrate` service on startup; see
[docs/development.md](../../docs/development.md) for the full local setup,
including the `TEST_DATABASE_URL` option for the integration levels. Node and
pnpm are pinned by the repository, and `pnpm toolchain:check` fails fast if the
local versions disagree.

## The full gate

The same gate that must pass before any push:

```bash
pnpm checks:local
pnpm test:e2e
```

Everything below is a subset, useful when working on one part.

## The document model (FR-005, FR-006, SC-009)

```bash
pnpm test:unit -- document
pnpm test:property -- document
```

What the property tests establish, and why each matters:

- **Round trip through the editor is the identity** on any valid document.
  Generated with fast-check over the block grammar in
  [data-model.md](./data-model.md), which is what makes it a claim about the
  model rather than about six documents someone thought of.
- **An unknown block survives unchanged.** Generated documents include blocks
  of types the client does not know; after a model → Tiptap → model trip, the
  unknown block serialises to the same JSON. This is SC-009.
- **Markdown export is total** — never throws, on any valid document, including
  ones containing unknown blocks.
- **Normalisation is idempotent.** `normalise(normalise(d)) === normalise(d)`;
  without it the round-trip property has no fixed point to compare against.

Expect: all pass. A failure in the round-trip property is a content-loss bug and
blocks the feature, whatever else is green.

## Writing a page (US1)

```bash
pnpm test:e2e -- block-editor
```

Or by hand, which is worth doing once:

1. `pnpm dev`, sign in, open any page.
2. Type `# ` — the line becomes a heading and the `# ` is gone.
3. Type `- ` then some text, `Enter`, `Tab` — a nested list item.
4. Press `/` — the block menu opens; insert a code block.
5. `Ctrl/⌘ ⇧ ↑` to move a block; `Ctrl/⌘ Z` to undo it.
6. Reload. The document is exactly as you left it.

## Knowing whether it saved (US2, FR-007 to FR-011, SC-010)

```bash
pnpm test:e2e -- save-state
```

By hand:

1. Open a page and type. The state reads *unsaved*, then *sending*, then
   *saved* — and never *saved* before the request completes.
2. Go offline in devtools and type again: the interface says the work is kept on
   this device.
3. Come back online: it resolves to *saved*.
4. Force a rotation write block (see feature 002's rotation commands): the state
   reads *blocked*, says existing content is still readable, and says what would
   resolve it.

Each of the four states is captured by the e2e run, which is what SC-010 asks
for.

## Keyboard only (US3, SC-003)

```bash
pnpm test:e2e -- keyboard-navigation
```

By hand, and with the mouse physically out of reach: create a folder, create a
page inside it, rename it (`F2`), move it to the root, and open it. Focus must
be visible at every step, and `Escape` must always get you out of the editor.

## A phone-sized screen (US4, FR-021, SC-008)

```bash
pnpm test:e2e -- narrow-viewport
```

The assertion is `scrollWidth <= clientWidth + 1` on every core screen at 320
pixels, plus a full pass of US1 at that width.

## Accessibility audit (SC-004)

```bash
pnpm test:e2e -- accessibility
```

`@axe-core/playwright` over the workspace, editor, and settings screens. No
critical or serious violations. This is an audit, not the journey tests — both
must pass, and neither substitutes for the other.

## Performance (SC-005, SC-006)

```bash
pnpm test:e2e -- editor-performance
```

Against a generated 500-block document: keystroke to visible output under
100 ms at p95, and open-to-editable under 2 seconds. Run on an unloaded
machine; these are the two criteria most likely to fail spuriously under a
parallel build, and a failure should be reproduced before it is believed.

## What is deliberately not verified here

**SC-002 and SC-007** need a usability protocol with ten participants. They
cannot be satisfied by automated evidence and are tracked the way feature 002
tracked its equivalent: recorded as pending in the feature's validation ledger
rather than quietly marked pass.

**FR-022** (two most recent major versions of four browsers) is evaluated at
release time. The Playwright projects cover the engines; the specific version
window is a release-gate concern.
