# Data Model: Block Editor

## Page document envelope

The existing page-owned envelope remains canonical:

- `format`: constant `myownnotion.document+json`
- `formatVersion`: `2` for validated block-editor documents
- `body`: one Editor Document tree

Version 1 remains readable through an explicit compatibility function. An empty v1 body becomes an in-memory empty v2 document; arbitrary non-empty v1 bodies remain visibly incompatible until a later migration rule is specified.

## Editor Document

- `type`: constant `doc`
- `content`: ordered array of block nodes; an empty document normalizes to one paragraph

The document is the unit of local durability, synchronization, revision history, and export. Cursor position, selection, command-menu state, and undo history are session state rather than canonical content.

## Supported block nodes

| Node | Required attributes | Allowed children |
| --- | --- | --- |
| `paragraph` | none | text spans |
| `heading` | `level` in 1, 2, 3 | text spans |
| `bulletList` | none | one or more `listItem` |
| `orderedList` | optional positive `start` | one or more `listItem` |
| `listItem` | none | paragraph followed by compatible nested blocks |
| `taskList` | none | one or more `taskItem` |
| `taskItem` | boolean `checked` | paragraph followed by compatible nested blocks |
| `blockquote` | none | one or more paragraph-compatible blocks |
| `codeBlock` | optional plain-text language hint | text only, no marks |
| `horizontalRule` | none | none |

## Text and marks

A text node has `type: text`, a non-empty `text` value, and zero or more unique marks: `bold`, `italic`, `strike`, and `code`. Marks carry no arbitrary attributes in this feature.

## Validation rules

- Only allow-listed node, mark, and attribute keys are accepted.
- The root is always `doc`; text cannot appear directly below the root.
- Heading levels outside 1–3 are rejected.
- List wrappers contain their matching item nodes.
- Code blocks contain unmarked text only.
- Unknown future content returns `document.unsupported-content` and the stored body remains unchanged.
- A v2 save always contains at least one top-level block.
- Validation errors expose structural paths but never page text.

## Editor mutation and state transitions

An editor mutation reuses the existing `page.document.replace` command:

`editing → saving-locally → saved-locally/pending → synchronizing → synchronized`

Failure branches:

- local transaction failure → `save-error`, editor content remains visible and unsaved
- stale causal base → `conflicted`, local body and revision identities remain recoverable
- network failure after local commit → `pending`, retry keeps the same mutation identity

Only one save is in flight for a page. A newer snapshot replaces the queued snapshot but never the active one. Completion triggers the queued latest save against the newly accepted local head.

## Relationships

- Exactly one Page Document belongs to one canonical Page.
- Each accepted Editor Mutation creates one causal Revision through existing foundations.
- The IndexedDB projected page holds the newest locally accepted envelope.
- The outbox holds the stable mutation and causal base until reconciliation.
- Canonical export embeds the complete envelope without HTML conversion.
