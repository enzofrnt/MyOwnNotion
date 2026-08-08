# Research: Tasks and Planning Views

## Canonical task representation

**Decision**: Extend the page-document contract to version 4 and store stable identity, status, date, and priority directly on each task-list item.

**Rationale**: The task title and nesting already belong to the editor tree. Keeping metadata on the same node makes revision history, offline editing, export, and deletion atomic and prevents a detached task record from outliving or disagreeing with its source content.

**Alternatives considered**: A separate canonical task entity would require block-to-record transactions and conflict rules; encoding metadata into visible text is fragile and inaccessible; keeping only checkbox state cannot satisfy planning views.

## Task projection ownership

**Decision**: Derive queryable task projections with one pure domain function from page documents instead of persisting a PostgreSQL or IndexedDB task table.

**Rationale**: Snapshots and local items already carry every page document. At the required 5,000-task scale, a bounded tree walk plus deterministic filtering is inexpensive, guarantees document/projection agreement by construction, and avoids a migration, endpoint, change-envelope extension, reconciliation branch, and cache invalidation protocol.

**Alternatives considered**: Materialized server/client task tables improve very large analytical queries but duplicate authoritative state and add failure modes not justified by the current scale; a server-only task endpoint would violate offline requirements.

## Legacy task upgrade

**Decision**: Continue reading versions 1–3 unchanged and let the editor assign identity/default metadata to legacy task items before the next accepted version-4 save.

**Rationale**: Existing pages remain readable without an eager workspace rewrite. Once edited, each task obtains a durable UUID and explicit todo/completed status derived from its checkbox without inventing dates or priority.

**Alternatives considered**: A database-wide content rewrite is operationally risky and creates revisions without user edits; structural-path identifiers break after reorder; random IDs generated during read would not remain stable.

## Status and checkbox consistency

**Decision**: Treat checkbox interaction as the fast completed/todo transition while explicit controls own the complete four-state workflow. Completed is checked; todo, in-progress, and cancelled are unchecked.

**Rationale**: This preserves familiar task-list behavior, supports reopening, and avoids contradictory states. Cancelled stays distinguishable from work that was actually completed.

**Alternatives considered**: Allowing independent checkbox and status values creates ambiguous views; treating cancelled as checked makes completion metrics misleading; cycling four states from the checkbox harms predictability.

## Calendar semantics

**Decision**: Store optional ISO calendar dates without time or zone and classify them against an explicitly supplied device-local calendar date.

**Rationale**: Personal due dates usually mean a day, not an instant. Date-only values avoid midnight shifts, make tests deterministic, and fit the defined Today/Upcoming/Overdue scopes.

**Alternatives considered**: UTC timestamps shift across zones and imply unsupported time scheduling; locale-formatted strings are ambiguous; server-local dates break offline consistency.

## Planning views

**Decision**: Provide a semantic list and a fixed-status board over the same filtered projection. Keep updates in the source editor rather than adding board drag-and-drop.

**Rationale**: The two views satisfy scanning and workflow overview while preserving one editing model and equivalent keyboard navigation. Shared data derivation makes count equality executable.

**Alternatives considered**: Kanban drag-and-drop adds cross-document editing and is reserved for the later databases feature; calendar grids imply time/layout scope; a visual-only board lacks an equivalent compact semantic path.

## Deployment and review evidence

**Decision**: Rebuild the existing API/web images, extend the isolated container smoke with version-4 task persistence, and attach desktop/mobile images and traces from task Playwright journeys to the existing GitHub report.

**Rationale**: This proves the feature in the user-requested production-like path without introducing a service or committing generated binary artifacts.

**Alternatives considered**: A task service has no independent ownership or scaling need; screenshots stored only on a developer machine are not reviewable; committed browser output creates noisy source history.
