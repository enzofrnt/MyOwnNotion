# Data Model: Files and Durable Storage

## Existing canonical entities retained

### Logical File (`items` + `logical_files`)

- `itemId`: stable UUID, item kind `file`.
- `workspaceId`, `name`, `lifecycle`, `currentRevisionId`, timestamps: unchanged canonical item fields.
- `contentId`: current immutable content identity.
- `mediaType`, `originalName`, `byteLength`: validated presentation metadata.
- Active hierarchy and attachment placements continue to resolve one logical identity.

State transitions remain `active → trashed → active|purged`. Content replacement moves only `contentId` and `currentRevisionId`; it never rewrites an accepted object.

### Content Object (`file_contents`)

- `id`: stable UUID.
- `sha256`: exactly 32 verified bytes.
- `byteLength`: integer from 0 through 268,435,456.
- `storageKey`: private opaque adapter locator, unique and never returned by a public contract.
- `verifiedAt`: non-null only after persisted-byte re-read succeeds.
- `referenceCount`: physical reuse accounting, not a logical ownership count.

No schema migration is needed for S3 storage. Existing filesystem keys remain valid until an explicit migration replaces each locator after cross-adapter verification.

### Attachment Placement (`placements`)

- Existing kind `attachment`, stable placement UUID, logical file target, owning page, order key, creation/removal revisions.
- Adding an existing file creates one new placement and one file revision; it never creates a new logical file or content object.

## Derived read models

### File Content Descriptor

- `itemId`, `revisionId`, `contentId`.
- `name`, `mediaType`, `byteLength`, lowercase SHA-256 hex.
- `disposition`: `inline` only for the safe raster allow-list, otherwise `attachment`.
- `cacheEligibility`: true only when active, verified, and no larger than 16 MiB.
- `storageKey`: server-internal field omitted from every response DTO and log.

Validation requires an active file, current revision equality, verified content, matching logical and physical byte length, and safe filename normalization.

### File Revision Cache Entry

- Cache key: same-origin file-content URL containing stable file and revision UUIDs.
- Response metadata: media type, length, digest, disposition, cache timestamp.
- Payload: exact successful full response only; range responses are never cached.
- Admission: at most 16 MiB; eviction at 24 entries or 30 days; purge on browser quota failure.

This is a disposable projection. Canonical metadata remains in Dexie and canonical bytes remain on the server/object store.

## Operational entities

### Integrity Audit Finding

- `kind`: `referenced`, `missing`, `mismatched`, `temporary`, or `unreferenced`.
- `safeId`: HMAC-derived run-local identifier, never the storage key or filename.
- Expected and observed byte length/digest match booleans.
- No file bytes, filename, object locator, page content, or relationship metadata.

An audit is read-only and produces bounded counts plus optional findings up to a configured report limit.

### Backup Manifest

- `manifestVersion`: `1`.
- `product`: `myownnotion`.
- `createdAt`, `sourceRevision`, `databaseSchemaVersions`, `toolVersions`.
- `database`: relative dump filename, format, byte length, SHA-256.
- `objects`: sorted records of `contentId`, encrypted-manifest storage locator, byte length, SHA-256.
- `counts`: workspaces, items, placements, revisions, relationships, page documents, logical files, content objects.
- `status`: `staged` while local, `complete` only after repository verification.

The manifest is private encrypted backup content. Operator-facing reports expose counts and snapshot identity but never the object list.

### Backup Run Status

- `operationId`, `startedAt`, `finishedAt`.
- `state`: `running`, `succeeded`, or `failed`.
- `snapshotId`: present only after a complete restic snapshot exists.
- Safe counts and `failureCode`; no free-form captured stderr.
- Stored atomically as bounded JSON in the operations-state volume.

Transitions: `running → succeeded|failed`. Advisory and repository locks permit only one backup/restore mutation at a time.

### Restore Guard

- Persistent `.restore-in-progress` marker with operation UUID and start time only.
- Created immediately before target mutation and removed only after database/object verification.
- API startup treats presence as a hard not-ready condition.

### Restore Run

- Selected complete snapshot identity and manifest digest.
- Preflight states: repository opened, snapshot tagged complete, compatibility valid, staging verified, targets empty.
- Apply states: guard written, database restored, objects restored, cross-verification complete.
- Terminal state: `succeeded` removes the guard; `failed` preserves guard and safe failure code.

Restore does not automatically clean partial targets. The operator must inspect and explicitly recreate empty targets before retrying.

## Streaming state machine

1. `receiving`: bounded request stream writes an opaque temporary object and computes incoming length/digest.
2. `persisted`: adapter completed the write but canonical metadata does not yet reference it.
3. `verified`: independent full read reproduces length/digest.
4. `reused` or `registered`: byte-equal candidate is reused and temporary object removed, or the new object becomes a registered content object.
5. `accepted`: logical file, placement, revision, mutation, change row, and content reference commit.
6. `abandoned`: any pre-accept failure leaves no logical reference and schedules/removes only the known temporary object.

No transition repairs a digest or silently swaps bytes.
