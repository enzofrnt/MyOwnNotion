# Data Model: Links and Knowledge Graph

## Canonical editor document version 3

The existing `myownnotion.document+json` envelope advances to `formatVersion: 3`. Its root and block structure remain compatible with version 2. Inline text may additionally carry a wiki-link mark:

| Field | Meaning | Validation |
| --- | --- | --- |
| `type` | Mark discriminator | Exactly `wikiLink` |
| `attrs.targetItemId` | Stable target page identity | UUID; differs from the source page |
| `attrs.occurrenceId` | Stable identity of this inline occurrence | UUID; unique inside one document |

Marks may combine with bold, italic, strike, or code only when the editor schema permits the combination. Unknown attributes, invalid identifiers, duplicate occurrence identities, self-links, and links on non-text nodes are rejected before acceptance.

Versions 1 and 2 normalize to the in-memory editor document without inventing links. Saving a valid edit writes version 3.

## Wiki Link Occurrence

One author-visible occurrence inside the source page document.

| Attribute | Meaning |
| --- | --- |
| `occurrenceId` | Stable occurrence UUID |
| `sourceItemId` | Owning page identity, supplied by the envelope context |
| `targetItemId` | Target page UUID |
| `label` | Text carrying the mark; author-editable, not an identity key |

Lifecycle is derived from the accepted document: present, removed, or restored by a later revision.

## Knowledge Relationship projection

The existing relationship table stores the current typed projection.

| Attribute | Value for wiki links |
| --- | --- |
| `id` | `occurrenceId` |
| `sourceItemId` | Source page |
| `targetItemId` | Target page |
| `relationType` | `link:references` |
| `metadata.label` | Current occurrence label for diagnostics/export |
| `createdRevisionId` | Revision that first accepted or reactivated the occurrence |
| `removedRevisionId` | Revision that removed it, or null while active |

### Reconciliation rules

1. Extract and validate all wiki-link marks from the proposed version-3 document.
2. Reject duplicate occurrence IDs, self-links, missing targets, non-page targets, and purged targets before any write.
3. Retain active rows whose occurrence ID and endpoints match.
4. Insert new rows for new occurrence IDs.
5. Mark absent active rows as removed by the same page revision.
6. Reactivate a previously removed row only when its source and target still match the restored occurrence.
7. Any validation or storage error rolls back the document, relationships, revision, mutation, and change envelope together.

Explicit non-wiki relationship types are never changed by document reconciliation.

## Backlink and outgoing summaries

Summaries are derived by joining active `link:references` occurrences with the local item projection and grouping by ordered source-target pair.

| Attribute | Meaning |
| --- | --- |
| `sourceItemId` | Source page |
| `targetItemId` | Target page |
| `occurrenceCount` | Number of active occurrences for the pair |
| `sourceName` / `targetName` | Current local display name when available |
| `sourceAvailability` / `targetAvailability` | active, trashed, or unavailable |

## Graph model

### Graph Node

| Attribute | Meaning |
| --- | --- |
| `id` | Stable page UUID |
| `label` | Current page name or an explicit unavailable label |
| `availability` | active, trashed, or unavailable |
| `incomingCount` | Active visible incoming occurrence count |
| `outgoingCount` | Active visible outgoing occurrence count |
| `selected` | Presentation selection only |

### Graph Edge

| Attribute | Meaning |
| --- | --- |
| `id` | Stable ordered key `sourceItemId→targetItemId` |
| `sourceItemId` | Directed source |
| `targetItemId` | Directed target |
| `occurrenceCount` | Aggregated active occurrences |

Local mode retains the selected page and directly connected nodes, then filters edges to those visible nodes. Global mode retains every active page participating in an active wiki relationship. The accessible list and SVG receive the exact same model.

## Local projection and synchronization

- Verified snapshots replace local items, placements, and relationships transactionally while preserving outbox/conflicts.
- Incremental page changes replace the active wiki-link relationship set only for the changed source page.
- Offline page replacement writes the document row, relationship rows, revision header, and outbox record in one Dexie transaction.
- Conflict capture retains the optimistic document and relationship projection together for recovery.

## Export and revision behavior

- Canonical export includes version-3 documents and active/removed relationship metadata already covered by the export contract.
- A page revision snapshot retains the complete version-3 document; restoring it re-derives the wiki-link relationship projection in the restore transaction.
- Endpoint lifecycle changes never rewrite target identities in historical documents or active references.
