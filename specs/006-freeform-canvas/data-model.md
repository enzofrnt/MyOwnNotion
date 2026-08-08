# Data Model: Freeform Canvas

## Canvas block

One version-6 page node has `type: "canvasBlock"` and exact `attrs`:

- `canvasId`: stable UUID, unique across canvas blocks in the document.
- `schemaVersion`: literal `1`.
- `cards`: ordered exact text/page card union, at most 500.
- `connections`: ordered exact directed edges, at most 1,000.
- `strokes`: ordered exact freehand strokes, at most 200.
- `viewport`: exact finite pan and zoom state.

Unknown keys are invalid at every nesting level.

## Cards

Every card has a stable `cardId`, finite signed `x` and `y` coordinates in `[-1_000_000, 1_000_000]`, `width` in `[160, 800]`, and `height` in `[96, 600]`.

### Text card

- `kind`: `"text"`.
- `text`: trimmed non-empty UTF-16 string, at most 4,000 code units.

### Page card

- `kind`: `"page"`.
- `targetItemId`: stable UUID of the referenced workspace page.

The current page name is projection data and is never copied into the canvas. Missing local targets remain stored and render as unavailable. At initial server acceptance, the existing page-link rules require an active page target other than the owning page.

## Connections

Every connection contains:

- `connectionId`: stable UUID.
- `sourceCardId`: current card UUID.
- `targetCardId`: different current card UUID.
- `label`: trimmed string from 0 to 120 code units.

Connection IDs and directed source/target pairs are unique. Removing a card removes its incoming and outgoing connections in the same candidate attributes object before validation.

## Strokes

Every stroke contains:

- `strokeId`: stable UUID.
- `width`: one of `2`, `4`, or `8` canvas units.
- `points`: ordered array of 2–1,000 exact `{x, y}` finite canvas-coordinate points within the coordinate limit.

Transient pointer points are not canonical. A complete stroke is added in one attribute update and a removal deletes exactly one stroke identity.

## Viewport

The exact viewport contains:

- `x`, `y`: finite screen-space pan offsets in `[-1_000_000, 1_000_000]`.
- `zoom`: finite scale in `[0.25, 4]`.

Viewport changes never mutate world geometry. Reset is `{x: 0, y: 0, zoom: 1}`.

## Derived projections

- Connection endpoints are the centers of current source and target rectangles.
- Screen/world conversion applies `screen = world × zoom + pan` and the exact inverse.
- Page-card labels resolve from current local page candidates, falling back to `Unavailable page`.
- Page cards project to existing `link:references` relationships with `cardId` as occurrence identity.
- Internal connections and strokes do not create workspace relationships.

## Validation invariants

1. All objects use exact allow-listed keys and all numbers are finite and within bounds.
2. Canvas/card/connection/stroke IDs are valid and unique in their scopes.
3. Page-card and inline wiki occurrence IDs are globally unique within the document.
4. Connections reference current distinct cards and each directed pair appears once.
5. Every stroke is complete, bounded, and uses a supported width.
6. Multiple canvas blocks have unique canvas identities.
7. Versions 1–5 forbid canvas blocks; version 6 enables canvas and retains current task/database metadata.

## Lifecycle and atomicity

The canvas has no independent lifecycle. It follows its owning page. An accepted edit replaces one complete page document, reconciles page-card relationships, and creates one revision in the same transaction. IndexedDB applies the complete document, derived relationships, and one outbox mutation atomically. Conflicts retain the complete local document.
