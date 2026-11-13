# Notion parity tooling

Capture and compare a UI surface against Notion.

```sh
bun run notion:parity:capture --profile .notion-lab/profile \
  --url <notion-url> --steps <recipe.json> \
  --selector auto --item "[role=option]" --out .notion-lab/parity/<name>

bun run notion:parity:capture --profile .notion-lab/app-profile \
  --url <app-url> --steps <recipe.json> \
  --selector "<candidate-selector>" --item "<candidate-item>" \
  --out .notion-lab/parity/<name>-ours

bun run notion:parity:compare \
  --reference .notion-lab/parity/<name>/capture.json \
  --candidate .notion-lab/parity/<name>-ours/capture.json
```

Each capture writes `capture.json`, `report.md` and `surface.png`. The compare
step reports missing/extra items, order and computed style deltas at rest and on
hover.

Recipes live in `recipes/`. `--selector auto` finds the smallest common ancestor
of the visible items, which is useful for atomic-class UIs like Notion. Steps
support `mouseMove`, `mouseClick`, `click`, `clickVisibleRole`, `hover`,
`rightClick`, `press`, `evaluate`, `wait`.

Never capture the personal workspace. Captures stay in `.notion-lab/` (ignored).

## One-command parity gate

For a surface that will be maintained, describe it once in
`scripts/notion-parity/surfaces/<name>.json` and run:

```sh
bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-menu.json
```

The command captures the Notion reference and the candidate with the same
recipe, compares structure and geometry, writes `comparison.md`, `manifest.json`
and clips, and exits non-zero when an in-scope item or geometry metric drifts.
`outOfScope` names are reported separately: they are explicit decisions, never
silently missing items.

The property-menu recipe compares the 9 in-scope items, order, labels, item
geometry, icon boxes, text origin, font family/weight/line-height and hover veil.
It is a measurement tool, not a claim of pixel identity: the column menu now uses
an explicit application-adapted optical scale (13 px normal text, 28 px rows,
20 px line icons), so the current comparison still reports the deliberate
14 → 13 px and icon/inset deltas. Notion-only actions remain declared explicitly.

## Capture metrics

`capture.json` now records, per item: `gapBefore`, hover styles, `content.svgs`
(size and relative position), leaf text metrics (font, weight, color, origin),
disabled/expanded state. `surface-clip.png` is a cropped visual proof. Compare
uses these metrics for every common item, not just the first one.

## Current gates

```sh
bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-menu.json
bun run notion:parity:verify --config scripts/notion-parity/surfaces/property-sort-submenu.json
```

These are measurement recipes, not visual acceptance certificates. Historical
captures without `fontFamily` must be regenerated: missing typography, bold
weight, oversized/misplaced icons and non-finite geometry now fail rather than
silently passing. Regression tests:

```sh
bun test scripts/notion-parity/compare.test.ts
```

## Visual-form review

The current column-menu treatment uses an application-adapted optical scale
(13 px normal text, 28 px rows, lighter 18 px line icons). It is not declared a
pixel-identical Notion copy. A numeric reference delta remains visible; do not
weaken the gate to erase an intentional adaptation.

Review the main menu, type/sort flyouts, property panel **and portaled option
menus**, in both themes and in full-page context at native screenshot scale.
A parent-menu measurement cannot establish its children's font inheritance.
Keep a single CSS owner: `column-property-menu.css`. Feature CSS must not add
later overrides for the same selectors. No feature additions/removals belong
to a visual-form-only correction.
