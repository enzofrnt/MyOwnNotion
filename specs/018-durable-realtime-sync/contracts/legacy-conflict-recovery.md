# Contract: Legacy page-conflict recovery

## Purpose

Recover work left by the historical `page.document.replace` path without
letting those rows block or mislabel the operational page protocol. This is a
data-preservation migration, not a conflict auto-dismissal.

## Scope

Included sources:

- sealed outbox conflict whose `commandType` is `page.document.replace`;
- interrupted outbox row of the same type when the target page is already
  operational;
- retained local revision and document referenced by those rows.

Excluded sources continue through their existing owner decision flow:

- database definition and entry conflicts;
- item hierarchy or conversion conflicts;
- active page ambiguities created by the operational model.

## Local schema v9

Add `legacySyncRecoveries`:

~~~text
mutationId, pageId, status, [pageId+status], capturedAt
~~~

The row contains only routing fields defined in `data-model.md`. The sealed
`conflicts` row remains the payload holder until conversion. The Dexie upgrade
callback creates the store only; it performs no decryption and deletes nothing.

## Classification

After the local device key is unlocked, scan historical page conflicts in
stable order.

### Already represented

A row can be archived when its local revision or canonical digest is already
proven by the installed operational checkpoint/projection. In one transaction:

1. verify the exact identity/digest;
2. mark recovery `converted`;
3. delete the old conflict;
4. retain the operational state unchanged.

A title match, page ID alone or newest timestamp is never sufficient evidence.

### Convertible semantic intent

Requirements:

- readable local payload and page document;
- readable base revision/document or another cryptographically verified base;
- target still represents a page;
- stable block identities and supported canonical schema;
- no prior recovery for the page currently `converting`.

Algorithm:

1. Normalize base and local documents to canonical v3.
2. Derive semantic changes by stable block/cell identity: insert, move, text
   replacement with context, mark/property change, and delete.
3. Verify replaying those commands on the base reproduces the local canonical
   digest exactly.
4. Persist a sealed `LegacyOfflineBranchRecord` with the source `mutationId`
   before updating recovery to `converting`.
5. Submit through `LegacyBranchService.convert()` against the current server
   head. The service decides compatible replay and durable ambiguities.
6. Verify and install the returned active checkpoint.
7. In one IndexedDB transaction, mark the branch converted, remove the source
   conflict and mark recovery `converted`.

If replay does not reproduce the exact local digest, conversion is refused and
the source is quarantined. A lossy “best effort” diff is forbidden.

### Quarantine

Use one bounded safe reason code:

- `legacy-recovery.payload-unreadable`
- `legacy-recovery.base-unavailable`
- `legacy-recovery.schema-unsupported`
- `legacy-recovery.diff-unprovable`
- `legacy-recovery.item-not-page`
- `legacy-recovery.integrity-failed`

The sealed conflict remains. Diagnostics provide page identity where safe,
capture time, reason, local text preview only after user-triggered decryption,
and export of the complete local document. Quarantine does not block editing
the current operational page.

## Multiple rows for one page

- Sort by `capturedAt`, then `mutationId`.
- Hold the existing cross-context page-write lock.
- Process at most one `converting` row per page.
- After each successful conversion, synchronize and use its durable frontier as
  the basis for the next row.
- If two historical rows describe identical canonical intent, the second may
  archive only after an exact digest/operation identity proof.
- A quarantined earlier row does not authorize discarding later rows; each is
  independently recoverable.

## Crash recovery

| Durable observation after restart | Action |
| --- | --- |
| No recovery row, conflict exists | Create `pending` routing row |
| `pending`, no branch | Reclassify and construct exact branch |
| `converting`, branch editing/sending | Resume same branch/request IDs |
| `converting`, branch converted and active checkpoint exists | Finish atomic conflict removal |
| `converted`, conflict still exists | Verify operational proof, then remove conflict |
| `quarantined`, conflict exists | Leave recoverable; retry only when missing proof can change or owner requests |
| Recovery references missing conflict before conversion proof | Raise local integrity diagnostic; never invent success |

Every transition is idempotent. `attemptCount` cannot trigger expiration or
deletion.

## Status accounting

- `Outbox.conflicts()` remains capable of reading every retained row.
- `activeConflicts()` excludes page rows owned by a recovery record and returns
  only current decisions.
- `quarantinedRecoveryCount()` is reported separately as work needing attention.
- `pending` and `converting` rows contribute to pending synchronization, not to
  conflict count.
- `storagePersisted` never influences either count.

## Removal condition

Compatibility code may be removed only after:

- all supported local schema fixtures migrate;
- no supported released client can create `page.document.replace` for the body
  of an operational page;
- export/recovery remains possible for every quarantined fixture;
- a separate migration explicitly defines what happens to remaining rows.
