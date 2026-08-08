# Feature Specification: Structured Databases

**Feature Branch**: `codex/databases`

**Created**: 2026-08-08

**Status**: Implemented

**Input**: User description: "Continuer la roadmap avec les databases : propriétés, relations, filtres, tris et vues table, Kanban et galerie, en conservant les garanties hors ligne et de qualité existantes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Structure Records Inside a Page (Priority: P1)

As the workspace owner, I can insert a structured database into a page, define typed properties, and maintain records so recurring information does not have to be expressed as unstructured prose.

**Why this priority**: Stable records and properties are the source data required by every database view.

**Independent Test**: Insert one database, add records, create every supported property type, edit and clear representative values, save and reload, and verify stable database/property/record identities.

**Acceptance Scenarios**:

1. **Given** an editable page, **When** the owner inserts a database through the toolbar or slash menu, **Then** a readable database block with a stable identity and one title column appears at the insertion point.
2. **Given** a database, **When** the owner adds text, number, select, date, checkbox, or relation properties, **Then** each property has a stable identity, labelled type, and editable values appropriate to that type.
3. **Given** a database, **When** the owner adds, renames, edits, or removes records, **Then** unrelated records and property identities remain unchanged.
4. **Given** a populated database, **When** the page is saved, reloaded, renamed, moved, exported, or restored from history, **Then** its schema, records, values, and stable identities are preserved.
5. **Given** malformed, duplicate, contradictory, or unsupported database content, **When** it reaches a validation boundary, **Then** it is rejected without modifying the last valid page document or logging private values.

---

### User Story 2 - Find Records in a Table (Priority: P1)

As the workspace owner, I can use a compact table with filters and deterministic sorting so I can find the relevant records without changing their stored data.

**Why this priority**: A database becomes useful when its records can be reviewed consistently at more than trivial size.

**Independent Test**: Populate a mixed fixture, filter by title and property value, sort ascending and descending by every supported value class, clear the query, and verify exact record counts and order.

**Acceptance Scenarios**:

1. **Given** a populated database, **When** table view opens, **Then** each matching record appears exactly once with a title and every current property column.
2. **Given** table view, **When** the owner searches titles or visible values, **Then** only matching records remain and an explicit result count updates.
3. **Given** table view, **When** the owner selects a property sort and direction, **Then** records use documented type-aware ordering with stable identity as the final tie-break.
4. **Given** active filter and sort state, **When** values are edited or records are added or removed, **Then** the result recomputes without duplicating, losing, or mutating records.
5. **Given** no matching records or a narrow viewport, **When** table view renders, **Then** an explicit empty state appears and horizontal overflow remains contained within the database block rather than the page.

---

### User Story 3 - Review the Same Records as Board or Gallery (Priority: P2)

As the workspace owner, I can switch the current filtered records between table, board, and gallery presentations so I can scan workflow groups or visual cards without creating duplicate data.

**Why this priority**: Equivalent views deliver the roadmap's main organizational value while keeping one canonical record set.

**Independent Test**: Apply one filter and sort, capture record identities in table view, switch to board and gallery, and verify identical identity sets and counts with useful keyboard navigation.

**Acceptance Scenarios**:

1. **Given** filtered records, **When** the owner switches between table, board, and gallery, **Then** all views expose the exact same record identities and result count.
2. **Given** a select property, **When** board view groups by it, **Then** each option and an explicit unassigned group appear in deterministic order and every record belongs to exactly one group.
3. **Given** no compatible select property, **When** board view opens, **Then** records remain accessible in an unassigned group and guidance explains how to add a grouping property.
4. **Given** gallery view, **When** records render, **Then** cards show their title and a bounded readable property summary without relying on color alone.
5. **Given** any view, **When** a record is activated with keyboard or pointer, **Then** focus moves to a labelled record editor for that stable record.

---

### User Story 4 - Relate Records and Work Offline (Priority: P1)

As the workspace owner, I can link records within a database and continue editing already-loaded databases while disconnected, with conflicts remaining recoverable.

**Why this priority**: Relations and local durability distinguish structured owned data from a disposable visual table.

**Independent Test**: Create same-database relations, disconnect, edit schema/records/views, reload offline, reconnect exactly once, then force a competing revision and recover the complete local database document.

**Acceptance Scenarios**:

1. **Given** a relation property, **When** the owner selects one or more records from the same database, **Then** stable record identities are stored while current readable titles are displayed.
2. **Given** a related record is renamed or removed, **When** relations render, **Then** renames resolve automatically and unavailable identities remain explicit rather than silently retargeted.
3. **Given** a previously loaded database, **When** the API is unavailable, **Then** schema edits, record edits, relation selection, filters, sorts, and all three views remain usable from local state.
4. **Given** offline database edits, **When** local save succeeds and connectivity returns, **Then** one complete version synchronizes without duplicate identities or partial schema/value state.
5. **Given** a competing accepted page revision, **When** the offline database document is rejected, **Then** the complete local database remains recoverable and a conflict is explicit.

### Edge Cases

- A database has no records, no optional properties, hundreds of records, duplicate titles, empty titles, or long labels and values.
- A property is renamed or removed while records contain values for it; removed-property values must not survive invisibly.
- Number input is negative, fractional, zero, empty, or non-finite; dates include leap-day and invalid calendar input.
- Select options are renamed, removed, duplicated, empty, or used by board grouping.
- A relation points to itself, multiple records, a renamed record, or a removed record.
- Filters return no rows; values compare equal; the sorted property is empty; view switching occurs on a narrow viewport.
- An offline edit is interrupted before acknowledgement or conflicts with a server revision.
- A database contains at least 1,000 records and 20 properties.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The page editor MUST support inserting a structured database block through a labelled toolbar action and slash command.
- **FR-002**: Every database, property, and record MUST have a stable unique identity that survives edits, saves, reloads, revision restoration, page renames, and hierarchy moves.
- **FR-003**: Every database MUST have one required record-title field and MAY define text, number, select, date, checkbox, and same-database relation properties.
- **FR-004**: Property names and select-option labels MUST be non-empty after trimming, unique within their scope, and bounded to documented safe lengths.
- **FR-005**: Values MUST match their property's type; invalid dates, non-finite numbers, unknown options, unknown properties, and malformed relations MUST be rejected safely.
- **FR-006**: Removing a property MUST remove its values from every record in the same accepted document update.
- **FR-007**: Removing a record MUST leave relation references explicit as unavailable until the owner edits them; references MUST NOT silently target another record.
- **FR-008**: The table view MUST expose every matching record exactly once with its title, current property columns, and an explicit result count.
- **FR-009**: The database surface MUST support case-insensitive text search over record titles and readable current values.
- **FR-010**: The database surface MUST support deterministic ascending and descending sorting by title or a selected property, using type-aware empty-value rules and stable record identity as the final tie-break.
- **FR-011**: Table, board, and gallery views MUST render the exact same filtered and sorted record identity set without modifying canonical data.
- **FR-012**: Board view MUST group by one select property when available, MUST include an explicit unassigned column, and MUST fall back predictably when no compatible property exists.
- **FR-013**: Gallery cards MUST expose record title and bounded readable property summaries without relying on color alone.
- **FR-014**: Activating a record from any view MUST reveal a labelled editor for that same stable record.
- **FR-015**: Relation values MUST store stable record identities, resolve current titles, permit self-reference only through an explicit owner selection, and surface missing targets.
- **FR-016**: Database schema, records, values, and view configuration MUST be part of the canonical versioned page document and canonical export.
- **FR-017**: Database editing and all views MUST remain available offline once the source page is local; local document, derived view, and pending mutation MUST commit atomically.
- **FR-018**: Reconciliation MUST preserve complete database documents through accepted-head mapping, incremental catch-up, snapshot replacement, and explicit conflicts without a separate database cache.
- **FR-019**: Unsupported future database versions, unknown fields, duplicate identities, excess limits, and invalid nesting MUST leave stored content unchanged.
- **FR-020**: Application logs MUST NOT include database titles, property names, record titles, values, filters, option labels, or relation labels.
- **FR-021**: Database controls, cells, filters, views, cards, groups, and record editors MUST be keyboard operable, labelled, focus-visible, and usable with assistive technology.
- **FR-022**: Narrow viewports MUST contain table and board overflow within the database block and MUST NOT produce page-level horizontal overflow.
- **FR-023**: Filtering, sorting, and switching views for 1,000 locally available records and 20 properties MUST complete within one second on the reference desktop environment.
- **FR-024**: Review evidence MUST include desktop and mobile images for property editing, table, board, and gallery journeys in the GitHub Playwright artifact.
- **FR-025**: The production-like composition and documentation MUST exercise database creation, property/record edits, view parity, export, offline durability, and restart persistence without undocumented setup.

### Key Entities

- **Database Block**: A structured, versioned page block owning one schema, record collection, and view configuration.
- **Property Definition**: A stable named field with one supported value type and optional select choices.
- **Record**: A stable database entry with a required title and typed values keyed by property identity.
- **Relation Value**: One or more stable record identities resolved against the owning database's current records.
- **Database View State**: The selected table, board, or gallery presentation plus search, sort, direction, and optional board grouping.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can insert a database, add two properties, and enter three records in under two minutes using only the keyboard.
- **SC-002**: Database, property, record, option, and relation identities survive save, reload, offline restart, page rename/move, export, and revision restoration in 100% of acceptance fixtures.
- **SC-003**: Invalid and fault-injected updates never expose a partially updated schema, record value set, or pending mutation.
- **SC-004**: Table, board, and gallery expose identical filtered record identity sets and counts for every deterministic fixture.
- **SC-005**: Search and type-aware sorting produce the documented exact order for 100% of text, number, select, date, checkbox, relation, empty, and tie fixtures.
- **SC-006**: A 1,000-record, 20-property local database filters, sorts, and switches views within one second on the reference desktop environment.
- **SC-007**: Principal database journeys complete without critical accessibility violations or page-level horizontal overflow on supported desktop and mobile viewports.
- **SC-008**: An offline create/edit/reload/reconnect journey produces exactly one synchronized database identity and complete expected schema/record state in every automated run.
- **SC-009**: A competing revision preserves the complete local database document and exposes one recoverable conflict in every automated run.
- **SC-010**: Reviewers can inspect desktop/mobile evidence and reproduce database creation plus all three views through the documented production-like composition.

## Assumptions

- This release provides page-embedded databases whose records are owned by that database block; turning records into independently editable hierarchy pages belongs to a later increment.
- Relation properties target records inside the same database in this release. Cross-database relations, rollups, formulas, and reciprocal automation require a later specification.
- One database block owns one current view configuration. Named saved views and synchronized per-user preferences are outside this release.
- Filtering is one case-insensitive search across titles and readable values. Compound filter builders belong to a later increment.
- Board grouping uses select properties only. Kanban drag-and-drop is excluded; values are edited through the record editor.
- Gallery cards do not include file cover images in this release; they present structured text summaries.
- Schema and record limits are 20 optional properties, 1,000 records, 50 select options per property, 200 relation targets per value, and bounded text documented by the executable contract.
- The existing single-owner, local-first, revision, export, conflict, and loopback-only deployment boundaries remain in force.

## Scope Boundaries

### Included

- Page-embedded structured databases with stable schema and record identities.
- Text, number, select, date, checkbox, and same-database relation properties.
- Record editing, search, deterministic type-aware sorting, table, select-grouped board, gallery, counts, and source focus.
- Offline local save, synchronization, conflict recovery, revision restore, export, responsive accessibility, review images, and production-like restart validation.

### Excluded

- Record pages, cross-database relations, rollups, formulas, computed properties, automations, templates, permissions, collaboration, comments, public sharing, and external data sources.
- Named saved views, compound filter builders, calendar/timeline views, Kanban drag-and-drop, gallery cover images, imports, and database APIs for third-party clients.
