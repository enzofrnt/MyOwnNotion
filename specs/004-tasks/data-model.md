# Data Model: Tasks and Planning Views

## Version-4 page document

The page document remains the only canonical write unit. Version 4 keeps every version-3 block and mark and extends task-item attributes.

```text
TaskItemAttributes
├── checked: boolean
├── taskId: UUID
├── status: todo | in_progress | completed | cancelled
├── dueDate: YYYY-MM-DD | null
└── priority: none | low | medium | high
```

### Validation rules

- `taskId` is a valid UUID and appears at most once in one document.
- `status` and `priority` are exact allow-listed values.
- `dueDate` is `null` or a real proleptic Gregorian calendar date formatted as four-digit year, two-digit month, and two-digit day.
- `status = completed` if and only if `checked = true`.
- Cancelled tasks are unchecked.
- The existing task-item content rule remains: the first child is a paragraph and following compatible nested blocks are permitted.
- Wiki-link marks and all version-3 content remain valid inside task text.
- Versions 1–3 reject version-4 task attributes, remain readable through their own validator, and are upgraded only by a version-4 save.

## Task projection

A task projection is derived, never independently mutated.

| Field | Source | Rule |
| --- | --- | --- |
| `taskId` | task attributes | Stable canonical identity |
| `sourceItemId` | containing page | Stable page identity |
| `sourceName` | current item projection | Current active or diagnostic page name |
| `sourceLifecycle` | current item projection | `active`, `trashed`, or `purged` |
| `title` | first task paragraph | Plain text in document order; presentation may show `Untitled task` when empty |
| `status` | task attributes | Fixed state |
| `checked` | task attributes | Consistent with status |
| `dueDate` | task attributes | Date-only or null |
| `priority` | task attributes | Fixed priority |
| `documentOrder` | tree walk | Zero-based stable ordering for the current document |
| `depth` | task nesting | Non-negative nesting level for presentation |

Task projections are rebuilt after local item reads. Trashed source tasks remain derivable for diagnostics but active planning views exclude them. Purged sources disappear with their document.

## Scope classification

Classification receives `today` as an explicit `YYYY-MM-DD` value.

| Scope | Membership |
| --- | --- |
| All | Every task from active source pages |
| Today | Todo or in-progress with `dueDate = today` |
| Upcoming | Todo or in-progress with `dueDate > today` |
| Overdue | Todo or in-progress with `dueDate < today` |
| Finished | Completed or cancelled regardless of due date |

An undated active task belongs to All but no date scope. A task is represented at most once inside any selected scope.

## Filter and sort model

Filters combine with AND semantics:

- case-insensitive title or source-page substring;
- zero or more selected statuses;
- zero or more selected priorities.

Sort modes are deterministic and use `sourceItemId`, then `documentOrder`, then `taskId` as final tie-breakers:

- due date: dated tasks ascending, then undated;
- priority: high, medium, low, none;
- source page: locale-independent normalized name;
- document order: source page followed by current document order.

## State transitions

```text
todo ──start──> in_progress ──complete/check──> completed
  ▲                    │                              │
  └────reopen/uncheck──┴────────reopen/uncheck────────┘
  │                    │
  └────── cancel <─────┘

cancelled ──reopen──> todo
```

Changing due date or priority does not change status. Removing a task node removes its projection. Duplicating a node requires a new task identity before the document can be accepted.

## Durability and conflicts

- Canonical: a document mutation, revision snapshot, and current item revision commit together as they do today; the task projection is a pure view of that accepted document.
- Local: one IndexedDB transaction replaces the page document and appends the outbox mutation; task views only observe the resulting local item state.
- Reconciliation: accepted documents replace their source item once; rejected competing revisions retain the existing conflict document and therefore all recoverable task metadata.
- Export: version-4 document bodies carry the complete task representation; no detached task collection is needed for lossless round trips.
