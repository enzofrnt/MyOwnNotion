# Research: Freeform Canvas

## Page-owned canvas rather than a new item type

**Decision**: Store each canvas as one atomic block inside its owning versioned page document.

**Rationale**: This immediately inherits local editing, outbox atomicity, revision history, export, conflicts, and container persistence. A canvas service or independent item lifecycle would add synchronization and permission boundaries before any approved need.

**Alternatives considered**: A dedicated canvas table/item kind was rejected because it duplicates the established document lifecycle. One DOM node per canvas element outside the editor was rejected because it would split save and undo boundaries.

## Native DOM and SVG rendering

**Decision**: Use a clipped DOM world layer for interactive cards and SVG for connections and strokes.

**Rationale**: Native inputs, buttons, sections, lists, focus, and accessible names remain available for cards while SVG provides deterministic geometric primitives. The bounded scale does not require WebGL or a canvas framework.

**Alternatives considered**: HTML canvas was rejected because it needs a parallel semantic tree and custom hit testing. A third-party diagram library was rejected because it adds dependency and content-model coupling for behavior native platform primitives can satisfy.

## Persisted world coordinates and viewport transform

**Decision**: Store finite signed world coordinates plus a separate bounded `{x, y, zoom}` viewport.

**Rationale**: Cards and drawings remain stable when the owner pans or zooms. Screen/world conversion is deterministic, testable, and independent from the device viewport.

**Alternatives considered**: Persisting screen pixels was rejected because it changes meaning across viewport sizes. Persisting CSS transforms was rejected as browser-specific and difficult to validate exactly.

## Page cards reuse canonical wiki relationships

**Decision**: Treat each page card as a `link:references` occurrence whose occurrence ID is the card ID.

**Rationale**: Page inclusion then participates automatically in backlinks, graph, offline relationship projection, snapshots, and export. No new graph vocabulary or database path is needed.

**Alternatives considered**: Keeping page cards invisible to the graph was rejected because it produces two inconsistent link concepts. A new `canvas:includes` type was rejected because the existing knowledge graph intentionally aggregates user-facing page references.

## Connections are internal directed pairs

**Decision**: Store directed edges between current card IDs, forbid self/dangling/duplicate pairs, and expose both visual arrows and a semantic list.

**Rationale**: Stable directed semantics support deterministic identity and assistive technology without implying a second workspace relationship. Internal canvas edges do not become page backlinks.

**Alternatives considered**: Undirected edges were rejected because direction would later require a migration. Projecting every internal edge into the knowledge graph was rejected because text cards are not workspace items.

## Atomic freehand strokes

**Decision**: Collect transient pointer points locally and commit a bounded stroke only at gesture completion.

**Rationale**: The canonical page document never contains half a gesture, the editor save path is not flooded per pointer event, and removal operates on stable complete identities.

**Alternatives considered**: Saving every point was rejected for write amplification and partial-state risk. Raster images were rejected because they lose editable geometry and require blob lifecycle changes.

## Limits and performance

**Decision**: Cap canvases at 500 cards, 1,000 connections, 200 strokes, and 1,000 points per stroke; keep coordinates/pan within ±1,000,000 and zoom within 0.25–4.

**Rationale**: The limits support substantial visual maps while bounding validation, JSON document size, DOM/SVG work, pointer conversion, and denial-of-service inputs.

**Alternatives considered**: Unbounded structures were rejected for predictable local performance. Viewport virtualization is deferred until measured scale requires it.

## Production and review evidence

**Decision**: Extend current API/export contracts, Playwright artifact capture, documentation, and isolated Compose persistence smoke without new infrastructure.

**Rationale**: Reviewers can reproduce the full feature using the same published images, and the existing loopback-only security boundary remains unchanged.
