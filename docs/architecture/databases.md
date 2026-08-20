# Structured databases

Feature 009 adds structured collections and task views without creating a new
content identity. A database is a capability of an ordinary page, and every
entry is also an ordinary page. The editor, hierarchy, history, files, search,
offline queue, export and lifecycle therefore continue to refer to the same
`itemId`.

## Canonical model

PostgreSQL migration `0007_databases.sql` adds two structural tables:

- `databases` binds a page identity to a monotonically increasing definition
  version;
- `database_entries` binds one entry-page identity to one database and a value
  version.

These tables intentionally contain no property names, option labels, view
configuration or entry values. Definitions and values use versioned protected
envelopes (`database.definition` and `database.entry-values`). Property
relations remain ordinary canonical relationships of type
`database:property`; their endpoints stay traversable while their metadata is
sealed as `relationship.metadata`.

The page and membership lifecycles are separate. Moving an entry in the
hierarchy does not change its database membership, and renaming either page does
not replace an identity. A page hosting a database or belonging to one cannot be
converted to a folder while that role exists.

## Definition and values

A `DatabaseDefinition` owns stable UUIDs for properties, options and views.
Property and view order uses position keys, not array position or display name.
The first version supports title, text, decimal number, civil date or instant,
status, select, multi-select, checkbox and relation properties. Removing or
changing a type retires the old identity; it never silently reinterprets stored
values.

An `EntryValues` record contains only non-relational values. Relation targets
remain graph edges so rename, move, trash and restore keep the same target
identity. Missing, zero, false and an empty string are distinct states.
Civil dates are compared without a timezone; instants are canonical UTC values
rendered in the current timezone.

Task tracking is a projection over ordinary properties. A definition may map a
status, due-date and priority property to task roles. Kanban and calendar moves
write those same property values; no parallel task table or task document
exists.

## Commands, revisions and synchronization

All structured writes pass through the existing mutation executor and create
ordinary revisions. The six command families cover database creation,
definition replacement/resolution, entry creation and value
replacement/resolution. Destructive definition changes require an impact
digest calculated from the base revision and affected values; a stale digest is
refused.

The browser applies the same commands optimistically. It seals the projected
rows and outbox payload before opening a Dexie transaction, then commits the
projection, local revision headers and queued mutation atomically. Server
acknowledgements remap optimistic revision references before dependent commands
are sent. Interrupted `sending` rows return to `pending` without changing their
mutation identity.

The canonical change feed and snapshot carry items, relationships, database
definitions and entry values under one cursor. Applying a snapshot replaces all
four projected sets and the cursor atomically. A purge tombstone retains the
item identity needed for convergence while removing the database definition,
membership, values and derived query state.

## Query projection and views

The query projection is reconstructible and private. The server keeps it in
memory; the browser derives it from sealed IndexedDB rows after unlock. A
generation is published as `ready` only after its complete source cursor has
been applied. Any missing or offloaded values produce `partial` coverage, so
groups, totals and empty results are never presented as exhaustive.

Table, list, board, gallery and calendar views execute the same saved
definition and return the same entry identities. Filters, multi-key sorts and
groups share one deterministic evaluator. The final tie-breaker is canonical
title then UUID. Cursors bind to the database, view, generation and definition;
a stale cursor is refused rather than mixed with a newer result.

The first page uses a top-K selection when exhaustive grouping is unnecessary.
Long table, board and gallery surfaces are virtualized with stable focus and
accessibility position metadata. The measured budgets and reference machine are
recorded in the feature validation artifact.

## Conflicts

Definitions merge by property/view identity and values merge by property
identity. Changes to distinct fields rebase automatically. A same-field
divergence keeps ancestor, local and remote versions in the sealed local
conflict record until the owner decides. Resolution creates a new command and a
revision with exactly two parents; neither source version is rewritten.

Schema resolutions that retire values still require the ordinary impact
preview. Resolving a conflict is therefore not a bypass around destructive
change confirmation.

## Lifecycle, export and backup

Trashing one entry removes it from every view but retains membership and values
for restoration. Trashing a database first reports the active member count,
then revises the host and every active member in one PostgreSQL transaction.
All revisions share the mutation identity used as the restore group, including
entries moved outside the database's hierarchy branch.

Canonical export format 2 includes versioned definitions, entry values and
property relationships. A ready export is stored as an `export.manifest`
protected envelope until its authorized download; the exports table contains
only status, identity and digest. Backup reuses the same canonical export,
records structured counts and a separate structured digest, and seals the
archive before a destination receives it. Restore recreates structural rows,
protected envelopes, relationships and revisions before announcing health.

## Local protection and reconstruction

Dexie schema version 6 stores `sealedDefinition`, `sealedValues`, sealed item
content, sealed relationship metadata, `sealedPayload` for outbox rows and
separate sealed payload/three-version context for conflicts. The codec leaves
only stable identities, lifecycle, causal references, availability and ordering
metadata readable. First unlock reseals legacy plaintext rows idempotently.

The projection can always be discarded and rebuilt from an authenticated
snapshot plus later changes, except for pending or conflicted local work. The
storage budget therefore never offloads an item named by a decrypted outbox or
conflict record and never evicts an owner-pinned item. Offloaded entry values
retain membership and identity but force partial query coverage.

## Language boundary

All database labels, validation errors and accessibility announcements are
owned by `apps/web/src/features/databases/database-copy.ts`. The catalogue is
English while that remains the application's active language; the release-wide
French switch replaces it together with every other product surface rather
than producing a mixed-language database area. Locale-sensitive dates use the
active runtime locale.

Persisted behavior never branches on translated labels. Property, option and
view identities remain UUIDs, types remain canonical codes, and filtering,
sorting and grouping use those identities and codes. Database creation may send
the localized initial title-property name explicitly, but that name remains
ordinary owner-visible content: changing it does not change the property's UUID
or its canonical `title` type. Older clients that omit the name retain the
English compatibility default.

## Current limits

- One canonical database membership per entry page.
- Saved views execute their stored filters; arbitrary private filters are not
  accepted in query-string URLs.
- Grouping and sorting support the eight V1 property types, not formulas or
  rollups.
- Gallery previews use only already-authorized, locally available page or
  raster content.
- Database purge orchestration remains owned by the shared future lifecycle
  worker; this feature only consumes its canonical tombstone.
- Person, contact, file-property, formula, rollup, sub-item and automation
  properties remain outside feature 009.

Operationally, a projection reporting `degraded` must be rebuilt from the last
verified snapshot. Do not repair its in-memory indexes manually: they are not a
source of truth. A failed envelope authentication remains a protected-read
failure and must never fall back to a complete-looking plaintext view.
