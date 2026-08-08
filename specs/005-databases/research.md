# Research: Structured Databases

## Canonical ownership

**Decision**: Store each database as one strict node inside its owning page document.

**Rationale**: The existing document replacement already provides revision history, local atomicity, conflict recovery, export, and server persistence. A page-owned first slice can satisfy record/property views without introducing a detached source of truth or a cross-entity transaction.

**Alternatives considered**: Dedicated database/record/property tables offer server-side queries but require migrations, endpoints, a new change-feed payload, IndexedDB tables, reconciliation logic, and document-to-record transactions. Encoding a table in prose cannot provide stable identities or typed validation.

## Record ownership

**Decision**: Records belong to the database block rather than becoming independent hierarchy pages in this release.

**Rationale**: This is the smallest complete implementation of properties, relations, filters, and three equivalent views. Independent record pages would couple the hierarchy, document, database, lifecycle, and conflict models and deserves a later specification.

**Alternatives considered**: Every row as a page is closer to mature knowledge tools but expands navigation, lifecycle, permissions, offline transactions, and import semantics beyond the current slice.

## Typed values

**Decision**: Support text, finite number, select, date-only, checkbox, and same-database relation properties through tagged values keyed by stable property identity.

**Rationale**: Tagged values allow exact safe validation, deterministic formatting/search/sort, and clean property removal. The set covers the roadmap's core structured-data use cases while avoiding computed execution.

**Alternatives considered**: Arbitrary JSON is not safely sortable or contractable. Formulas, rollups, files, people, and cross-database relations add evaluation, permissions, or detached lifecycle rules.

## Views and filters

**Decision**: Derive table, board, and gallery from one pure filtered/sorted record list. Persist one current view configuration with a single text query, sort key/direction, and optional select grouping.

**Rationale**: Shared derivation makes view parity executable and keeps the first interaction model understandable. A text query across readable values is useful without a full compound-filter language.

**Alternatives considered**: Separate view caches risk drift. Named view collections and compound predicates add schema/versioning and UI scope not needed for the first useful slice.

## Relations

**Decision**: Relation values store stable record UUIDs from the same database and resolve current titles during projection.

**Rationale**: Stable identity survives title edits. Keeping targets local makes validation and offline behavior deterministic. Missing targets can be shown explicitly after record deletion without unsafe reassignment.

**Alternatives considered**: Title-based references break on rename and duplicates. Cross-database links require workspace-wide referential rules and atomic changes across page documents.

## Editor integration

**Decision**: Use a Tiptap atom node with a React node view. The node view edits typed attributes through Tiptap transactions, while the existing save coordinator owns persistence.

**Rationale**: The database remains located inside normal page content, participates in undo/save/history, and avoids a second page editor. The atom boundary prevents ProseMirror from interpreting interactive table controls as rich text.

**Alternatives considered**: A workspace-global database screen detaches the database from its source page. Raw contenteditable tables complicate selection and typed input semantics.

## Deployment and review evidence

**Decision**: Extend existing contracts, browser artifacts, documentation, and isolated Compose persistence smoke without adding infrastructure.

**Rationale**: Reviewers can reproduce the full feature through the same published images, and local-only bindings preserve the unauthenticated security boundary.
