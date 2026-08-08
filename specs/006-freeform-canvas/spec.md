# Feature Specification: Freeform Canvas

**Feature Branch**: `codex/freeform-canvas`

**Created**: 2026-08-08

**Status**: Implemented — CI Firefox evidence pending

**Input**: User description: "Continuer la roadmap avec un canvas infini, des cartes, des dessins, des liens et l'inclusion de pages, dans la continuité d'une expérience proche d'Obsidian."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Arrange Ideas Spatially (Priority: P1)

As the workspace owner, I can insert a freeform canvas into a page and arrange editable text cards in two dimensions so ideas are not constrained to a linear document.

**Why this priority**: Stable spatial cards and navigation are the minimum useful canvas and the foundation for every connection, drawing, and page reference.

**Independent Test**: Insert one canvas, add three text cards, edit their content, drag and keyboard-nudge them across positive and negative coordinates, resize one card, zoom and pan, save and reload, and verify stable identities and geometry.

**Acceptance Scenarios**:

1. **Given** an editable page, **When** the owner inserts a canvas through the toolbar or slash menu, **Then** a labelled canvas with a stable identity, visible origin, controls, and useful empty state appears.
2. **Given** a canvas, **When** the owner adds, edits, moves, resizes, or removes a text card, **Then** unrelated cards and all surviving identities remain unchanged.
3. **Given** a selected card, **When** the owner drags it or uses labelled keyboard move controls, **Then** its exact position changes without moving the surrounding page.
4. **Given** a large canvas, **When** the owner pans or changes zoom, **Then** the viewport changes while canonical card geometry remains unchanged.
5. **Given** a saved canvas, **When** the page reloads, is renamed, moved, exported, or restored from history, **Then** its cards, geometry, viewport, and identities are preserved.

---

### User Story 2 - Connect and Sketch Ideas (Priority: P1)

As the workspace owner, I can connect cards and draw freehand strokes so relationships and rough visual thinking remain inside the same canvas.

**Why this priority**: Connections and sketches turn positioned notes into a genuine thinking surface instead of a grid of detached cards.

**Independent Test**: Connect three cards, add and rename a connection label, draw strokes with different permitted widths, move connected cards, remove a connection and a card, and verify deterministic geometry plus explicit cleanup.

**Acceptance Scenarios**:

1. **Given** two cards, **When** the owner creates a connection, **Then** one stable labelled edge joins their current positions and is announced in a semantic connection list.
2. **Given** connected cards, **When** either card moves or resizes, **Then** the rendered connection follows it without changing edge identity.
3. **Given** draw mode, **When** the owner draws inside the canvas, **Then** a bounded stable stroke is stored in canvas coordinates and remains selectable and removable.
4. **Given** a card with connections, **When** the card is removed, **Then** every incident connection is removed in the same accepted update while unrelated cards and strokes remain unchanged.
5. **Given** malformed, duplicate, excessive, dangling, or unsupported canvas content, **When** it reaches a validation boundary, **Then** it is rejected without replacing the last valid page document or logging private canvas content.

---

### User Story 3 - Include Workspace Pages (Priority: P1)

As the workspace owner, I can add page cards to the canvas and open their current workspace pages so the canvas becomes a visual map of owned knowledge.

**Why this priority**: Page cards connect the canvas to the existing hierarchy and knowledge graph instead of creating an isolated drawing file.

**Independent Test**: Add two current pages, move and connect them to text cards, rename and move a target page, open it from the canvas, remove the target page, and verify current labels plus an explicit unavailable state.

**Acceptance Scenarios**:

1. **Given** current workspace pages, **When** the owner adds a page card, **Then** the card stores the stable page identity and displays its current readable name.
2. **Given** an included page is renamed or moved, **When** the canvas renders, **Then** the card resolves the current name without changing stored canvas identity or geometry.
3. **Given** an available page card, **When** the owner activates its labelled open action, **Then** the application navigates to that exact page.
4. **Given** an included page is unavailable locally or removed, **When** the canvas renders, **Then** the stable target remains explicit and is never silently retargeted.
5. **Given** text and page cards, **When** the owner selects connection endpoints, **Then** both card kinds participate in the same edge model and semantic connection list.

---

### User Story 4 - Work Offline and Recover Complete Canvases (Priority: P1)

As the workspace owner, I can continue using an already-loaded canvas while disconnected and recover the complete canvas when synchronization conflicts occur.

**Why this priority**: Spatial knowledge is user-owned content and must have the same local durability and recoverability as pages, tasks, links, and databases.

**Independent Test**: Load a canvas, disconnect, add/move/edit cards, connections, strokes, and viewport, reload offline, reconnect exactly once, then force a competing revision and recover the complete local canvas document.

**Acceptance Scenarios**:

1. **Given** a previously loaded canvas, **When** the API is unavailable, **Then** cards, connections, strokes, viewport, and page-card labels available locally remain readable and editable.
2. **Given** an offline canvas update, **When** the local save succeeds, **Then** one complete document and one pending mutation commit atomically.
3. **Given** pending canvas edits, **When** connectivity returns, **Then** one complete version synchronizes without duplicate identities, dangling edges, or partial stroke data.
4. **Given** a competing remote revision, **When** reconciliation detects the conflict, **Then** the complete local canvas remains recoverable and the accepted remote document remains valid.
5. **Given** a production-like restart, **When** the composition starts again, **Then** the exact canvas cards, geometry, connections, strokes, page targets, and viewport remain available.

### Edge Cases

- A canvas reaches card, edge, stroke, stroke-point, label, coordinate, or dimension limits.
- A drag leaves the visible viewport or crosses the origin into negative coordinates.
- The browser loses pointer capture during a card drag or freehand stroke.
- A connection attempts to target itself, a missing card, or duplicate an existing directed pair.
- Removing a card has multiple incoming and outgoing connections.
- A page card targets the page that owns the canvas.
- A page target exists in the stored canvas but is unavailable in the current local snapshot.
- Zoom reaches its minimum or maximum and repeated controls must remain stable.
- A canvas is opened in a narrow viewport or at 400% browser zoom.
- Offline reload occurs after a viewport-only change or during an unfinished pointer gesture.
- A future canvas schema or document version reaches an older client.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page editor MUST support inserting a freeform canvas through a labelled toolbar action and slash command.
- **FR-002**: Every canvas, card, connection, and stroke MUST have a stable unique identity that survives edits, saves, reloads, page rename/move, export, offline restart, and revision restoration.
- **FR-003**: A canvas MUST support editable text cards and page cards at finite signed two-dimensional coordinates with bounded dimensions.
- **FR-004**: The owner MUST be able to add, edit, move, resize, select, and remove cards with keyboard-operable labelled controls; pointer dragging MAY provide an equivalent faster path.
- **FR-005**: The viewport MUST support bounded zoom, pan in both axes, and reset without modifying canonical card, edge, or stroke coordinates.
- **FR-006**: Card movement MUST support positive and negative coordinates and MUST NOT cause page-level horizontal overflow.
- **FR-007**: A connection MUST store stable source and target card identities, MAY have a bounded label, MUST reject missing or identical endpoints, and MUST render from current card geometry.
- **FR-008**: Removing a card MUST remove every incident connection in the same accepted canvas update.
- **FR-009**: Connections MUST be exposed through a semantic labelled list in addition to visual lines and MUST NOT rely on color alone.
- **FR-010**: Draw mode MUST record finite bounded freehand stroke points in canvas coordinates with a stable stroke identity and permitted non-color width semantics.
- **FR-011**: The owner MUST be able to select and remove a complete stroke without partially modifying unrelated strokes.
- **FR-012**: Page cards MUST store stable workspace item identities, resolve current locally available names, expose a labelled open action, and retain an explicit unavailable state without retargeting.
- **FR-013**: Text and page cards MUST participate in the same movement, selection, connection, persistence, and revision model.
- **FR-014**: Canvas cards, geometry, edges, strokes, and viewport MUST be part of the canonical versioned page document and canonical export.
- **FR-015**: Canvas editing MUST remain available offline once the owning page is local; local document, pending mutation, and derived relationships MUST commit atomically.
- **FR-016**: Reconciliation MUST preserve complete canvas documents through accepted-head mapping, incremental catch-up, snapshot replacement, and explicit conflicts without a separate canvas cache.
- **FR-017**: Exact validation MUST reject unknown fields, duplicate identities, non-finite values, invalid dimensions, invalid zoom, dangling/self connections, excess limits, invalid nesting, and unsupported future versions while leaving stored content unchanged.
- **FR-018**: Application logs MUST NOT include card text, connection labels, page labels, coordinates, stroke points, viewport values, or canvas identifiers from request bodies.
- **FR-019**: Canvas controls, cards, connections, strokes, status, and page actions MUST be labelled, focus-visible, keyboard operable, and usable with assistive technology.
- **FR-020**: Narrow viewports and 400% browser zoom MUST contain the spatial surface and overflow within the canvas block rather than the page.
- **FR-021**: Rendering and deriving a locally available canvas with 500 cards, 1,000 connections, and 200 bounded strokes MUST complete within one second on the reference desktop environment.
- **FR-022**: Review evidence MUST include deterministic desktop and mobile images for empty, connected-card, page-card, and drawing journeys in the GitHub Playwright artifact.
- **FR-023**: The production-like composition and documentation MUST exercise canvas insertion, cards, connection, drawing, page inclusion, export, offline durability, and restart persistence without undocumented setup.
- **FR-024**: Existing version-1 through version-5 page documents MUST remain readable, editable, exportable, and restorable after canvas support is introduced.

### Key Entities

- **Canvas Block**: A versioned page block owning spatial cards, connections, freehand strokes, and viewport state.
- **Canvas Card**: A stable positioned and sized text or page-reference item.
- **Canvas Connection**: A stable directed relationship between two current card identities with an optional readable label.
- **Canvas Stroke**: A stable ordered collection of canvas-coordinate points plus bounded display width.
- **Canvas Viewport**: Saved pan coordinates and zoom used only to present canonical canvas content.
- **Page Target**: A stable workspace item identity resolved from the current local hierarchy when available.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can insert a canvas, add three text cards, arrange them, and connect two of them in under two minutes using only the keyboard.
- **SC-002**: Canvas, card, connection, stroke, and page-target identities survive save, reload, offline restart, page rename/move, export, and revision restoration in 100% of acceptance fixtures.
- **SC-003**: Invalid and fault-injected updates never expose a partially updated card set, dangling connection, truncated stroke, or pending mutation.
- **SC-004**: Moving or resizing connected cards updates every rendered connection while preserving 100% of connection identities.
- **SC-005**: Current page names and explicit unavailable states resolve correctly for 100% of deterministic page-card fixtures without changing stored targets.
- **SC-006**: A 500-card, 1,000-connection, 200-stroke local canvas validates and derives its visible geometry within one second on the reference desktop environment.
- **SC-007**: Principal canvas journeys complete without critical accessibility violations or page-level horizontal overflow on supported desktop and mobile viewports.
- **SC-008**: An offline add/edit/move/draw/reload/reconnect journey produces exactly one synchronized canvas identity and complete expected state in every automated run.
- **SC-009**: A competing revision preserves the complete local canvas document and exposes one recoverable conflict in every automated run.
- **SC-010**: Reviewers can inspect desktop/mobile evidence and reproduce cards, page inclusion, connections, drawing, and restart persistence through the documented production-like composition.

## Assumptions

- A canvas is a block inside one owning page rather than a new workspace item kind or service.
- Coordinates are effectively unbounded for normal use but exact safety limits protect storage and rendering.
- The saved viewport is shared with the page document; per-device viewport preferences are outside this increment.
- Page cards show the current locally available page name and do not embed the target page's editable body.
- Connections are directional for identity and semantic output, even when their initial visual treatment is neutral.
- Freehand drawings are simple polylines; pressure, brushes, shapes, handwriting recognition, and collaborative cursors are separate features.
- Existing local mutation, outbox, reconciliation, revision, export, and Compose paths can carry one complete next-version document without new storage infrastructure.

## Scope Boundaries

### Included

- Page-owned freeform canvas block.
- Text and current-page cards.
- Stable spatial geometry, selection, drag, keyboard move, resize, pan, zoom, and reset.
- Directed labelled connections with semantic representation.
- Simple freehand strokes and removal.
- Offline editing, synchronization, conflicts, export, revision restore, responsive accessibility, screenshots, performance, and production restart validation.

### Excluded

- Real-time collaboration, multi-user cursors, and automatic merge of simultaneous geometry edits.
- Cross-canvas or cross-workspace connections.
- Rich-text card bodies, databases inside cards, live editable page bodies, thumbnails, and transclusion.
- Automatic graph layout, mind-map generation, snapping, alignment guides, minimap, spatial search, and presentation mode.
- Pressure-sensitive brushes, shapes, image annotations, erasers, handwriting recognition, and drawing-layer compositing.
- Multi-touch pinch gestures and platform-specific stylus behavior.
- Raster, SVG, PDF, or presentation export of the rendered canvas.
