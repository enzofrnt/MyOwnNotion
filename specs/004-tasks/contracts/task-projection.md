# Contract: Task Projection and Planning Views

## Derivation boundary

The projection function accepts current item data and an explicit local calendar date. It does not access the network, current clock, browser storage, or presentation state.

Only page items with a supported editor document are inspected. Version-4 task items produce actionable projections. Legacy task items remain editor-readable and are upgraded before their next accepted save; they do not fabricate durable task identities during read.

## Canonical projection shape

```text
TaskProjection {
  taskId: UUID
  sourceItemId: UUID
  sourceName: string
  sourceLifecycle: active | trashed | purged
  title: string
  status: todo | in_progress | completed | cancelled
  checked: boolean
  dueDate: YYYY-MM-DD | null
  priority: none | low | medium | high
  documentOrder: non-negative integer
  depth: non-negative integer
}
```

## Determinism

For identical item documents, item metadata, `today`, scope, filters, and sort:

- projections have identical values and order;
- each `taskId` appears at most once;
- list and board flatten to the same ordered task-ID set;
- no input object is mutated;
- labels and filter text are not emitted to diagnostic logging.

## View-state contract

```text
TaskViewState {
  mode: list | board
  scope: all | today | upcoming | overdue | finished
  query: string
  statuses: set<todo | in_progress | completed | cancelled>
  priorities: set<none | low | medium | high>
  sort: due_date | priority | source_page | document_order
}
```

Switching mode preserves every other field. Changing a filter never mutates a document. Empty results expose the selected scope/filter context and a result count of zero.

## Source navigation

An active task exposes source navigation by `sourceItemId` and `taskId`. Navigation selects the page without a full reload, then focuses or reveals the matching task item. Trashed or unavailable sources expose diagnostics and do not redirect to another item.

## Compatibility and transport

- Runtime page-document contracts accept format versions 1–4 and validate version-4 task attributes structurally.
- Domain validation owns semantic dates, uniqueness, and checkbox/status consistency.
- Existing item, snapshot, change-envelope, revision, mutation, and export shapes require no new top-level field because their page document already transports all task data.
- Unknown later versions or malformed metadata return content-safe validation errors and do not replace the last valid document.
