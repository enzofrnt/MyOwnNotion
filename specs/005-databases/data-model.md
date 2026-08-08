# Data Model: Structured Databases

## Database block

| Field | Type | Rules |
| --- | --- | --- |
| `databaseId` | UUID | Stable and unique in the page document |
| `schemaVersion` | integer | Exactly `1` |
| `properties` | ordered property definitions | At most 20; unique IDs and normalized names |
| `records` | ordered records | At most 1,000; unique IDs |
| `view` | current view configuration | Exact supported mode, query, sort, direction, and board group |

The required title field is implicit and is not removable. Optional properties are explicit definitions.

## Property definition

Common fields are stable `propertyId`, normalized `name`, and one type: `text`, `number`, `select`, `date`, `checkbox`, or `relation`.

Select properties additionally own zero to 50 ordered options. Each option has a stable UUID and normalized label unique inside that property. Other property types cannot carry options.

## Record

| Field | Type | Rules |
| --- | --- | --- |
| `recordId` | UUID | Stable and unique inside the database |
| `title` | string | Trimmed for display, at most 512 characters; empty is allowed and shown as Untitled |
| `values` | ordered tagged values | At most one per current property; no unknown property IDs |

## Tagged values

- Text: string up to 10,000 characters.
- Number: finite JSON number.
- Select: current option UUID or `null`.
- Date: real `YYYY-MM-DD` calendar date or `null`.
- Checkbox: boolean.
- Relation: zero to 200 unique record UUIDs. Missing record targets are retained and projected as unavailable.

Every value repeats the current property type. A mismatched tag is invalid. Removing a property removes all values keyed by it in the same document transaction.

## View configuration

- `mode`: `table`, `board`, or `gallery`.
- `query`: case-insensitive search string, at most 512 characters.
- `sortPropertyId`: current property UUID or `null` for title.
- `sortDirection`: `asc` or `desc`.
- `boardGroupPropertyId`: current select property UUID or `null`.

Projection normalizes readable text without modifying canonical values. Empty values sort last in both directions, followed by stable record UUID as the final tie-break. Board columns follow select-option order, then Unassigned. Gallery uses the same record order as table.

## Lifecycle and atomicity

The database has no independent lifecycle. It follows its owning page. Any accepted edit replaces one complete page document and creates one revision. IndexedDB applies that page document plus one outbox mutation in a single transaction. Conflicts retain the complete local document.
