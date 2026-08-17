# Data Model: Files and Local Storage

What feature 001 already stores is not repeated here except where this feature
changes it. The additions fall into three groups: knowing where a file is used,
carrying an upload that is not finished yet, and knowing what this device is
actually holding.

## Already present (feature 001)

| Table | Role |
| --- | --- |
| `file_contents` | The stored bytes, addressed by `sha256` + `byte_length`, with `storage_key`, `verified_at`, and `reference_count`. Identical bytes are stored once. |
| `logical_files` | The owner-facing file: `item_id`, `content_id`, `media_type`, `original_name`, `byte_length`. |
| `placements` | Where an item sits: `hierarchy` or `attachment`, with a parent and a position key. |

`verified_at` is the field FR-007 already depends on: content is not usable
until the server has verified its digest. This feature makes that visible to
the owner rather than introducing it.

## Addition 1 — File usages

An index over every place a logical file is referenced. Derived, never
hand-maintained (research decision 4).

| Field | Type | Notes |
| --- | --- | --- |
| `file_item_id` | UUID → `items.id` | The logical file being used. |
| `used_by_item_id` | UUID → `items.id` | The page or folder that refers to it. |
| `usage_kind` | text | `attachment`, `embed`, or `hierarchy`. |
| `block_id` | UUID, nullable | For `embed`, which block in the document. |

Keyed on (`file_item_id`, `used_by_item_id`, `usage_kind`, `block_id`) so the
same file embedded twice in one page is two usages — which is what the owner
sees, and what a deletion confirmation must enumerate.

`attachment` and `hierarchy` rows are derivable from `placements` alone.
`embed` rows are not: they live inside the document body and are extracted when
a document is written. The extraction is a pure function over the block
document, so it is tested without a database.

**Why a table rather than a query**: the question "what uses this file" is
asked at the worst possible moment — while the owner waits to confirm a
deletion — and answering it by scanning every document does not stay fast as
the workspace grows.

## Addition 2 — Uploads in progress

One row per resumable upload (research decision 1).

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | The upload identity the client resumes against. |
| `workspace_id` | UUID → `workspaces.id` | |
| `declared_length` | bigint | Total size the client announced. Checked against the configured maximum before a single byte is accepted. |
| `received_length` | bigint | Authoritative offset. What `HEAD` returns. |
| `media_type` | text | |
| `original_name` | text | |
| `storage_key` | text | Where the partial bytes accumulate. |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | An abandoned upload is reclaimed rather than kept forever. |

**Never a `logical_file` until complete.** A partial upload has no item, no
placement, and appears nowhere in the tree. FR-006's requirement that a partial
upload never appears as a complete file is a consequence of this shape rather
than a check someone has to remember.

On completion the bytes are hashed, matched against `file_contents` (so a
resumed upload of already-stored content deduplicates like any other), and the
`logical_file` and its placement are created in one transaction.

## Addition 3 — Offline intent

Server-side, on the item, beside `favourite` (research decision 6).

| Field | Type | Notes |
| --- | --- | --- |
| `offline_intent` | boolean | Whether the owner asked for this item to be kept locally. Default false. |

Applies to a page, a folder, or a file (FR-016). For a folder it is inherited
by everything under it, which is what makes "mark this branch" a single action
rather than a hundred.

Inheritance is resolved at read time rather than written down the branch:
writing it down means every move has to rewrite it, and a move that is
interrupted leaves the branch inconsistent.

## Addition 4 — Local availability (device only)

In the local projection, never on the server. Each device holds a different
answer and no device's answer is authoritative for another.

| Field | Type | Notes |
| --- | --- | --- |
| `item_id` | UUID | |
| `state` | text | `present`, `offloaded`, or `never-fetched`. |
| `byte_length` | number | What it costs, or would cost. |
| `last_accessed_at` | string | Drives the offload order. |
| `offloaded_at` | string, nullable | Set when the client released the bytes. |

The three states are deliberately distinct. `offloaded` means *this device had
it and released it*; `never-fetched` means *this device has never held it*.
They look identical if collapsed into "not here", and they are not the same
thing to an owner deciding whether something is safe.

## Addition 5 — Device storage budget

One row per device in the local projection.

| Field | Type | Notes |
| --- | --- | --- |
| `limit_bytes` | number or null | `null` means unlimited (FR-014). Defaults to 5 GB. |
| `used_bytes` | number | Last measurement. |
| `measured_at` | string | When, so a stale figure can be labelled as stale. |
| `persisted` | boolean | Whether the browser granted durable storage. |

`limit_bytes: null` for unlimited rather than a sentinel like `-1` or a very
large number: unlimited is the absence of a limit, and any number chosen to
mean "no limit" eventually gets compared against.

## Eviction order

When usage exceeds the limit, content is released in this order, and the first
two groups are never touched:

1. **Never**: unsynchronized changes, unresolved conflicts, navigation
   metadata, titles, sync information, access-critical information (FR-015,
   FR-017).
2. **Never**: anything under an active offline intent (FR-016).
3. Large file content, least recently accessed first.
4. Old attachment content.
5. Synchronized page content not recently opened.

Everything in groups 3 to 5 shares one property that makes it safe to release:
the server can return it. That property, not age or size, is what admits
content to the evictable set — age and size only decide the order within it.

## Installation settings

| Setting | Default | Notes |
| --- | --- | --- |
| `max_file_bytes` | 2 GB | FR-008. Bounded by what the deployment can carry; the product does not promise more than the proxy and storage support. |
