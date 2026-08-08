# Feature Specification: Links and Knowledge Graph

**Feature Branch**: `codex/links-knowledge-graph`

**Created**: 2026-08-08

**Status**: Implemented — CI Firefox and shell evidence pending

**Input**: User description: "Continuer la roadmap avec les liens de type wiki, les backlinks et un graphe de connaissances local et global, sans perdre les garanties hors ligne des fondations existantes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link Pages While Writing (Priority: P1)

As the workspace owner, I can search for and insert a link to another page directly from the page editor so related knowledge stays connected without interrupting writing.

**Why this priority**: Creating stable page-to-page links is the foundation for every backlink and graph experience in this feature.

**Independent Test**: Create two pages, type `[[` in the first page, select the second page using only the keyboard, save and reload, then activate the rendered link and verify that the second page opens.

**Acceptance Scenarios**:

1. **Given** an editable page and at least one other active page, **When** the owner types `[[`, **Then** a labelled page-search menu appears at the insertion point without changing existing content.
2. **Given** an open page-search menu, **When** the owner types a query, uses arrow keys, and confirms a result, **Then** a readable inline page link replaces the query and editing continues after it.
3. **Given** a saved page link, **When** the page is reloaded or opened offline, **Then** its label, target identity, and navigation behavior remain available.
4. **Given** a rendered page link, **When** the owner activates it with a pointer or keyboard, **Then** the target page opens in the current workspace without a full application reload.
5. **Given** a linked target that is later renamed or moved, **When** the source page is opened, **Then** the link still resolves to the same target identity.

---

### User Story 2 - Understand Incoming and Outgoing Links (Priority: P1)

As the workspace owner, I can inspect the pages that reference the current page and the pages referenced by it so I can move through related knowledge in either direction.

**Why this priority**: Backlinks turn one-way editing actions into a navigable knowledge system and immediately expose the value of stable relationships.

**Independent Test**: Link page A to page B more than once, open page B, verify that page A appears once with its occurrence count, and navigate back to page A from the backlink panel.

**Acceptance Scenarios**:

1. **Given** a page with incoming and outgoing wiki links, **When** it opens, **Then** separate labelled sections list both directions using current page names.
2. **Given** repeated links from one source to one target, **When** backlinks are shown, **Then** the source appears once with an accurate occurrence count.
3. **Given** a backlink or outgoing-link entry, **When** the owner activates it, **Then** the related page opens and keyboard focus moves to a meaningful destination.
4. **Given** a link to a trashed or unavailable page, **When** the source or backlink view opens, **Then** the relationship remains diagnosable and is never silently redirected or deleted.
5. **Given** that the last occurrence of a wiki link is removed from a page, **When** the document is saved, **Then** the corresponding outgoing relationship and backlink disappear together with that accepted edit.

---

### User Story 3 - Explore the Knowledge Graph (Priority: P2)

As the workspace owner, I can explore a focused graph around the current page or the complete workspace graph so I can discover clusters and navigate between related pages.

**Why this priority**: The graph provides spatial discovery after links and backlinks already deliver the independently useful core behavior.

**Independent Test**: Create a four-page linked network, open the local graph and then the global graph, filter nodes, select a connected page in both the visual and accessible representations, and verify navigation.

**Acceptance Scenarios**:

1. **Given** a selected page, **When** the local graph opens, **Then** it shows that page, directly connected active pages, and the relationships between the visible nodes.
2. **Given** an active workspace, **When** the global graph opens, **Then** every active linked page appears once and each distinct source-target connection appears once with its occurrence count.
3. **Given** either graph, **When** the owner filters by page name, **Then** matching nodes and their visible connections are emphasized while the original data remains unchanged.
4. **Given** a graph node, **When** the owner selects it by pointer or keyboard, **Then** its name and connection summary become explicit and it can be opened as a page.
5. **Given** a user who cannot or does not use the visual graph, **When** the graph opens, **Then** an equivalent semantic list of nodes and connections supports the same navigation.

---

### User Story 4 - Keep the Knowledge Network Offline (Priority: P1)

As the workspace owner, I can create, inspect, and follow already-loaded page links while the server is unavailable, and my changes synchronize safely when connectivity returns.

**Why this priority**: Links are core knowledge content and must preserve the same local-resilience guarantee as page editing.

**Independent Test**: Load two pages, disconnect the server, create and follow a link, reload while still offline, then reconnect and verify exactly one synchronized link and backlink.

**Acceptance Scenarios**:

1. **Given** pages and relationships already present locally, **When** the server is unavailable, **Then** wiki-link search, navigation, backlinks, and graph exploration continue using the local projection.
2. **Given** an offline edit that adds or removes wiki links, **When** the page is saved and the application reloads, **Then** the edited document and relationship projection remain locally durable and visibly pending synchronization.
3. **Given** pending link edits, **When** connectivity returns, **Then** the document and its relationship changes synchronize without duplicate graph edges or backlink entries.
4. **Given** a competing server revision, **When** an offline linked document is rejected, **Then** the local document and its link information remain recoverable and the conflict is reported rather than partially applied.

### Edge Cases

- The page search has no match, contains hundreds of pages, or is dismissed with Escape or an outside click.
- The owner attempts to link a page to itself, inserts the same target repeatedly, or deletes only one of several occurrences.
- The target is renamed, moved, trashed, restored, or purged after a link was created.
- A legacy or externally supplied document contains malformed, duplicated, or unsupported wiki-link attributes.
- A page document save succeeds locally but synchronization is interrupted before server acknowledgement.
- The graph has no relationships, contains isolated pages, or contains cycles and reciprocal links.
- Very long page names and narrow mobile viewports must not create page-level horizontal overflow.
- A graph exceeds the visual reference size; interaction must remain bounded and the accessible representation must stay usable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page editor MUST offer page-link insertion from a `[[` trigger at the current insertion point.
- **FR-002**: The page-link menu MUST search active pages by name without requiring network access after those pages are locally available.
- **FR-003**: The page-link menu MUST support keyboard navigation, pointer selection, confirmation, dismissal, an explicit empty-result state, and positioning within the visible viewport.
- **FR-004**: Page-link search MUST exclude the source page itself and MUST NOT create self-referential relationships.
- **FR-005**: Every inserted wiki-link occurrence MUST preserve a stable target identity, a stable occurrence identity, and a readable label in the canonical page document.
- **FR-006**: Wiki links MUST remain editable as part of ordinary text and MUST expose their linked-page semantics to assistive technology.
- **FR-007**: Activating a wiki link MUST select and open its target inside the current application without a full reload.
- **FR-008**: Accepting a page-document edit MUST atomically align its wiki-link occurrences with the canonical relationship projection; partial document-only or relationship-only acceptance is forbidden.
- **FR-009**: Removing one occurrence MUST retain any remaining occurrences, while removing the last occurrence MUST remove the corresponding aggregated connection from backlink and graph views.
- **FR-010**: Link identity MUST survive page renames and hierarchy moves without rewriting the relationship target.
- **FR-011**: The current page MUST expose separately labelled incoming backlinks and outgoing wiki links.
- **FR-012**: Incoming and outgoing views MUST aggregate repeated source-target occurrences, report their count, and display the current related-page name when it is available.
- **FR-013**: Backlink and outgoing entries MUST support keyboard and pointer navigation to active related pages.
- **FR-014**: Trashed and unavailable endpoints MUST remain explicitly diagnosable and MUST NOT be silently redirected, reassigned, or erased.
- **FR-015**: The application MUST provide a local graph centered on the selected page and a global graph for the workspace.
- **FR-016**: Graph data MUST contain one node per relevant page and one aggregate edge per distinct ordered source-target pair, including occurrence counts.
- **FR-017**: Graph views MUST support name filtering, node selection, connection summaries, and opening an active page.
- **FR-018**: Every visual graph MUST have an equivalent semantic list representation that supports keyboard navigation and communicates direction and counts without relying on color or position alone.
- **FR-019**: Wiki-link search, link navigation, backlinks, and graph views MUST read from the durable local projection and remain usable offline once their data is present.
- **FR-020**: Offline link additions and removals MUST update the page document, relationship projection, and pending-change record atomically before local success is shown.
- **FR-021**: Reconciliation MUST preserve idempotency, must not duplicate link occurrences or graph edges, and must retain recoverable local state when a competing revision is rejected.
- **FR-022**: Canonical exports and revision snapshots MUST retain wiki-link occurrences and relationships in documented versioned structures.
- **FR-023**: Malformed or unsupported wiki-link content MUST be rejected with a safe validation error without altering the last valid document.
- **FR-024**: Link queries and graph rendering MUST introduce no page-level horizontal overflow at supported responsive sizes and MUST keep active keyboard controls visible.
- **FR-025**: Application logs MUST NOT include page document text, page-link query text, or private graph labels.
- **FR-026**: Review evidence MUST include desktop and mobile images for the principal link, backlink, and graph journeys, available to reviewers with the change.
- **FR-027**: The production-like composition and its documentation MUST remain sufficient to build or retrieve the application images and exercise links, backlinks, and graph navigation after a restart.

### Key Entities

- **Wiki Link Occurrence**: One inline reference embedded in a page document, identified independently and pointing to one stable target page.
- **Knowledge Relationship**: The durable directed connection derived from a wiki-link occurrence, with source, target, type, lifecycle, and endpoint availability.
- **Backlink Summary**: An aggregation of incoming occurrences by source page, including count and endpoint status.
- **Outgoing Link Summary**: An aggregation of outgoing occurrences by target page, including count and endpoint status.
- **Graph Node**: A page represented in a local or global knowledge graph, with stable identity, current label, lifecycle, selection, and connection counts.
- **Graph Edge**: An ordered source-target aggregation of one or more wiki-link occurrences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A keyboard-only owner can insert and follow a wiki link between two existing pages in under 20 seconds after the source page opens.
- **SC-002**: Saved wiki links retain their target and occurrence identities across reload, offline restart, page rename, and hierarchy move in 100% of acceptance fixtures.
- **SC-003**: Adding or removing a link never leaves the accepted page document and relationship projection out of agreement in fault-injection tests.
- **SC-004**: Backlink and outgoing summaries report exact occurrence counts for all duplicate, reciprocal, trashed-target, and last-occurrence-removal fixtures.
- **SC-005**: Local and global graph views represent every in-scope active page and aggregate directed connection exactly once in deterministic graph fixtures.
- **SC-006**: A 500-page, 1,000-connection workspace becomes filterable and keyboard-interactive within 1 second on the reference desktop environment.
- **SC-007**: All principal link, backlink, and graph journeys complete without critical accessibility violations in supported desktop and mobile viewports.
- **SC-008**: Supported responsive viewports exhibit zero page-level horizontal overflow throughout page-link search and graph interaction.
- **SC-009**: An offline add-link, reload, reconnect journey produces exactly one synchronized occurrence and one backlink summary entry in every automated run.
- **SC-010**: Reviewers can inspect desktop and mobile visual evidence and reproduce the feature using the documented production-like composition without undocumented setup steps.

## Assumptions

- This release operates within the existing private single-workspace boundary; authentication, multi-user authorization, and public graphs require separate specifications.
- Wiki links connect page items to page items. Folders, files, external URLs, and embedded remote resources are excluded from the wiki-link picker.
- Each inline occurrence owns a stable identity. User-facing backlinks and graph edges aggregate multiple occurrences that share a source and target.
- The inline label is editable author content captured when the link is inserted. Navigation and summaries resolve by stable identity and use the current target name when available.
- Local and global graphs are navigation and discovery views, not persistent spatial canvases; node positions are not user-owned data in this feature.
- The existing causal revision, outbox, export, container, and same-origin deployment foundations remain authoritative and are extended rather than replaced.

## Scope Boundaries

### Included

- Inline page-to-page wiki links from the block editor.
- Offline page search for link insertion.
- Incoming backlinks and outgoing-link summaries.
- Local and global knowledge graphs with accessible list equivalents.
- Atomic document-to-relationship projection, synchronization, export, responsive behavior, and review evidence.

### Excluded

- External web links, transclusion, aliases with independent lifecycle, embeds, and live previews.
- Full-text workspace search outside the page-link picker.
- Persistent manual graph layout, freeform canvas behavior, or three-dimensional rendering.
- Sharing, permissions, comments, mentions, collaboration, and presence.
- Exact visual compatibility with Notion, Obsidian, or another editor.
