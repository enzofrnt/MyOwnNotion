# Data Model: Canonical Content Foundations

## Model invariants

1. One installation contains one canonical workspace and one owner boundary.
2. Pages and folders have exactly one active hierarchy placement.
3. Files may have any number of hierarchy or page-attachment placements.
4. Workspace, page, and folder may be hierarchy parents; only pages may be attachment parents.
5. Files are always terminal and no placement graph may contain a cycle.
6. Names and paths are display properties, never identity.
7. Every accepted mutation is atomic and produces immutable revision lineage.
8. Independent file imports always have independent logical identities.
9. Physical blob reuse is invisible and copy-on-write.
10. Trash retains recoverable items for 30 days and backups include them during that window.

## Entity relationship overview

```text
Workspace 1 ── * CanonicalItem 1 ── * Placement
                          │
                          ├── 0..1 PageDocument
                          ├── 0..1 LogicalFile * ── 1 FileContent
                          ├── * Relationship (source/target)
                          └── * Revision * ── * RevisionParent

Mutation 1 ── * Revision
CanonicalItem 1 ── * LifecycleEvent

BrowserLocalState 1 ── * LocalProjection
                  ├── * OutboxMutation
                  └── * ConflictRecord
```

## Workspace

Represents the single canonical owner boundary.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Stable workspace identity | UUIDv7; exactly one active row |
| `created_at` | Creation time | Server-accepted UTC instant |
| `schema_version` | Canonical model version | Positive integer |

## CanonicalItem

Shared identity and lifecycle for pages, folders, and logical files.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Stable logical identity | UUIDv7; immutable |
| `workspace_id` | Owner boundary | Required; foreign key |
| `kind` | `page`, `folder`, or `file` | Immutable after creation |
| `name` | Display name | Unicode; trimmed; non-empty; not unique |
| `lifecycle` | `active`, `trashed`, `purged` | Controlled transitions only |
| `trashed_at` | Accepted trash time | Required only for `trashed` |
| `purge_after` | Earliest permanent-deletion time | `trashed_at + 30 days` |
| `current_revision_id` | Accepted current revision | Same item; immutable revision |
| `created_at`, `updated_at` | Accepted server times | UTC; never used as sole ancestry evidence |

### State transitions

```text
active ──trash──> trashed ──restore──> active
                         └──after purge_after + purge──> purged
```

- Trashing a page or folder applies one atomic lifecycle mutation to its reachable active hierarchy branch.
- Trashing a file occurs when its final active placement is removed or through an explicit whole-file action.
- Restoring a branch restores its last valid placements when parents remain valid; otherwise the owner must select a valid parent.
- Purge preserves tombstone/reference diagnostics and minimal lineage; reusable display names do not reuse identity.

## Placement

Represents one visible location. It is separate from canonical identity.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Placement identity | UUIDv7 |
| `workspace_id` | Workspace scope | Must match item and parent |
| `item_id` | Placed canonical item | Active or recoverably trashed |
| `placement_kind` | `hierarchy` or `attachment` | Determines parent rules |
| `parent_item_id` | Parent page/folder; null means workspace root | Attachment requires page; hierarchy forbids file parent |
| `position_key` | Explicit sibling order | Stable lexicographic key; never infer order from query output |
| `removed_at` | Placement removal time | Null while active |
| `created_revision_id`, `removed_revision_id` | Lineage | Same mutation lineage as placement change |

### Cardinality and validation

- Active page: exactly one active `hierarchy` placement.
- Active folder: exactly one active `hierarchy` placement.
- Active file: one or more active placements of either kind.
- Attachment placement: parent must be a page and does not appear in the main tree.
- Hierarchy placement: parent may be root, page, or folder and appears in the tree.
- Removing a non-final file placement changes only that placement.
- Removing the final file placement atomically trashes the logical file.
- A recursive ancestor check rejects any move that would create a cycle.

## PageDocument

Versioned editorial envelope owned by a page. The rich editor schema is defined later.

| Field | Meaning | Rules |
| --- | --- | --- |
| `page_id` | Owning page | One-to-one with `CanonicalItem(kind=page)` |
| `format` | Document format identifier | Initially `myownnotion.document+json` |
| `format_version` | Schema version | Positive integer; unknown versions rejected, never silently stripped |
| `body` | Canonical document envelope | Validated JSON; minimal empty document allowed |

Folders and files cannot have a `PageDocument`.

## LogicalFile

User-visible file identity, independent from its current bytes and placements.

| Field | Meaning | Rules |
| --- | --- | --- |
| `item_id` | Canonical file identity | One-to-one with `CanonicalItem(kind=file)` |
| `content_id` | Current immutable content | Copy-on-write on update |
| `media_type` | Declared media type | Validated but not trusted as equality evidence |
| `original_name` | Import name | Display metadata only |
| `byte_length` | Current size | Must match verified content |

## FileContent

Immutable physical byte content that may be safely reused.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Content identity | UUIDv7 |
| `sha256` | Full content digest | 32 bytes; indexed with byte length |
| `byte_length` | Exact length | Non-negative |
| `storage_key` | Opaque blob-store locator | Unique; never exposed as public URL |
| `verified_at` | Completed verification | Required before reuse |
| `reference_count` | Optimization aid | Reconciled; not sole deletion authority |

Before reusing a candidate with matching digest and length, the adapter verifies byte equality or an equivalently strong owned verification procedure. If verification cannot be completed, it stores separate content. Removing one logical file never mutates another. Unreferenced content is garbage-collected only after lifecycle, revision, backup, and in-flight mutation protections are satisfied.

## Relationship

Typed non-hierarchical edge between canonical items.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Relationship identity | UUIDv7 |
| `workspace_id` | Scope | Endpoints must match |
| `source_item_id`, `target_item_id` | Stable endpoints | Never names or paths |
| `relation_type` | Owned vocabulary | Non-empty namespaced string |
| `metadata` | Type-specific data | Validated JSON |
| `created_revision_id`, `removed_revision_id` | Lineage | Removal is explicit, not silent rewrite |

Relationships to trashed or purged items remain diagnosable. A later graph spec decides visibility, not this model.

## Mutation

One accepted or rejected command boundary.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Mutation identity/idempotency key | UUIDv7; unique per workspace |
| `workspace_id` | Scope | Required |
| `command_type` | Owned command name | Versioned vocabulary |
| `status` | `accepted` or `rejected` | Immutable terminal result |
| `submitted_at`, `accepted_at` | Timing metadata | UTC; not ancestry proof |
| `result_revision_ids` | Produced revisions | Non-empty for accepted canonical change |
| `failure_code` | Safe rejection reason | Never contains private content |

Replaying an accepted mutation ID returns the prior result without reapplying side effects. Mutations that read and modify ancestry-sensitive placements use serializable transactions with bounded retry.

## Revision and RevisionParent

Append-only causal lineage for accepted item state.

### Revision

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Revision identity | UUIDv7; immutable |
| `item_id` | Revised canonical item | Required |
| `mutation_id` | Producing mutation | Required |
| `accepted_at` | Canonical acceptance time | UTC |
| `snapshot` | Complete restorable state | Retained at least 24 hours after supersession |
| `snapshot_expires_at` | Earliest pruning time | Null for current/unresolved protected revisions |
| `lineage_digest` | Integrity summary | Covers owned lineage header |

### RevisionParent

| Field | Meaning | Rules |
| --- | --- | --- |
| `revision_id` | Child revision | Required |
| `parent_revision_id` | Direct causal parent | Same logical item unless a documented aggregate revision type permits otherwise |

- A normal sequential update has one parent.
- A resolved concurrent update may have multiple parents.
- A creation revision has no parent.
- Pruning a snapshot never removes the revision header or its parent edges.
- Unresolved concurrent revisions keep complete content even beyond 24 hours.
- Restoring retained historical content never rewrites history: it creates a new revision whose parent is the current accepted revision and whose snapshot copies the selected retained content. A changed current head produces an explicit concurrency conflict.

## LifecycleEvent

Append-only audit of recoverable lifecycle changes without private body content.

| Field | Meaning | Rules |
| --- | --- | --- |
| `id` | Event identity | UUIDv7 |
| `item_id` | Affected item | Required |
| `mutation_id` | Atomic command | Required |
| `event_type` | `trashed`, `restored`, `purged` | Owned vocabulary |
| `occurred_at` | Accepted time | UTC |
| `placement_snapshot` | Recovery metadata | IDs, parents, positions; no file bytes |

## Database enforcement strategy

- Foreign keys and check constraints enforce local kind/state/cardinality rules where possible.
- Partial unique indexes enforce one active hierarchy placement for pages/folders.
- Domain services plus recursive queries enforce no-cycle and final-file-placement transitions inside one transaction.
- Database triggers are limited to invariants that cannot be bypassed safely by migrations or administrative repair; business orchestration remains explicit in domain/application services.
- Deferred constraints are used where an atomic branch move temporarily changes several related rows.
- Every repository method requires a transaction context for canonical writes.

## Retention jobs

Retention workers are not delivered by this feature, but the model exposes deterministic eligibility:

- Trash purge eligibility: `lifecycle=trashed AND purge_after <= now`, excluding legal/backup/repair holds introduced later.
- Revision snapshot pruning: superseded, resolved, `snapshot_expires_at <= now`, and not retained by trash or backup rules.
- Blob collection: no live logical-file reference, no retained revision reference, no trash/backup hold, and no in-flight upload.

Eligibility never implies immediate deletion; later operational specs define scheduling, locking, and backup coordination.

## Browser-local projection

The browser stores a versioned projection, not a second independent source of truth. It must remain useful while disconnected and reconcilable afterward.

### BrowserLocalState

| Field | Meaning | Rules |
| --- | --- | --- |
| `workspace_id` | Projected workspace | Matches server workspace |
| `schema_version` | Local migration version | Migrated transactionally |
| `last_change_cursor` | Last contiguous server change applied | Opaque durable cursor |
| `sync_state` | `offline`, `pending`, `syncing`, `synced`, `conflict` | Derived and persisted where required |

### LocalProjection

Contains loaded item state, placements, page documents, file metadata, relationships, and revision headers keyed by the same stable IDs as the server. It may omit file bytes and unloaded content, but must never fabricate a different canonical identity.

### OutboxMutation

| Field | Meaning | Rules |
| --- | --- | --- |
| `mutation_id` | Stable idempotency identity | UUIDv7; never regenerated on retry |
| `command_type`, `payload` | Validated local command | Versioned format |
| `base_revision_ids` | Causal assumptions | Required for changed items |
| `local_revision_ids` | Optimistic projection revisions | Remain recoverable until acknowledgement/resolution |
| `status` | `pending`, `sending`, `conflict` | `sending` recovers to pending after interrupted attempt |
| `created_at`, `last_attempt_at` | Local timing | Diagnostics only |

The local projected mutation and its outbox row commit in one IndexedDB transaction.

### ConflictRecord

Retains the rejected local mutation, local revisions/content, causal bases, competing server revision identities, and safe error code. It remains until an explicit later resolution or owner-authorized discard; normal cache eviction cannot remove it.

## Server change cursor

Every accepted mutation receives a monotonic workspace-local sequence in addition to causal revision IDs. The API returns ordered change envelopes after an opaque cursor. If history compaction invalidates a cursor, the server returns a verified snapshot boundary followed by changes after that boundary; the client preserves and reapplies or conflicts its outbox rather than deleting it.
