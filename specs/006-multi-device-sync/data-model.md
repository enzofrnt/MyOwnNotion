# Data Model: Multi-Device Synchronization

Most of what this feature needs already exists. The additions are small on
purpose: a second ordering authority would be the most damaging thing this
feature could introduce, because the order an owner sees would then depend on
which one answered.

## Already present (features 001 to 003)

| Table | Role |
| --- | --- |
| `changes` | The ordered feed. One row per accepted mutation with a monotonic workspace-local sequence, the revisions it produced, and the items it touched. **This is the ordering authority, and this feature adds none.** |
| `revisions` | Content lineage, with `parent_revision_ids` — which is what makes "diverged" distinguishable from "behind". |
| `mutations` | Accepted mutation identities, so a replay returns the prior result. |
| `authorized_devices` | Devices and their state, from feature 002. |
| `conflicts` (local) | Conflicts retained durably on the device, from feature 001. |

The change feed already reports compaction when a cursor is older than the
retained window, and the client already rebuilds from a snapshot in that case.
Catch-up (FR-005, FR-006) is therefore a transport concern rather than a new
mechanism.

## Addition 1 — Nothing, for live delivery

Deliberately. A device subscribing to notifications needs no stored state: it
already knows its cursor, and the notification tells it the stream advanced.
Recording subscriptions server-side would mean maintaining rows whose lifetime is
a TCP connection, and a row that outlives its connection is a device the server
believes is listening when it is not.

The one thing worth writing down is that this is a decision, not an omission.

## Addition 2 — Conflict resolution, as a revision with two parents

No new table. A resolution is a revision whose `parent_revision_ids` holds
**both** conflicting revisions.

| Field | Value for a resolution |
| --- | --- |
| `parent_revision_ids` | `[localRevisionId, remoteRevisionId]` |
| `snapshot` | The document the owner assembled |

This is what satisfies FR-016 without extra machinery: both sources remain
reachable as ancestors, so "keeps the original versions" is a property of the
lineage rather than a retention policy someone has to honour. It also makes the
history readable — a resolution looks like what it is, a place where two lines
of work rejoined.

**Why not a `resolutions` table**: it would hold what the lineage already
expresses, and the two could disagree. The revision graph is the record.

## Addition 3 — Device attribution on a revision

| Field | Type | Notes |
| --- | --- | --- |
| `authored_by_device_id` | UUID, nullable | Which device produced this revision (FR-022). |

Nullable because revisions written before this feature have no device to name,
and inventing one would put a false statement in the history. A history entry
that says "device unknown" is honest; one that guesses is worse than silence.

**Never the session identifier**, and never anything derived from key material
(FR-023). The device identity is already an opaque value the owner sees in their
device list, which is exactly the granularity the history needs.

## Addition 4 — Protocol version, as a constant rather than a row

The supported protocol version and the compatibility window are code, not data:
they change when the software changes, and storing them would allow a deployment
whose declared version disagrees with what it actually speaks.

| Constant | Meaning |
| --- | --- |
| `PROTOCOL_VERSION` | What this server speaks. |
| `MINIMUM_WRITE_VERSION` | The oldest client version whose writes are still safe. |
| `MINIMUM_READ_VERSION` | The oldest client version whose reads are still safe. |

Two thresholds rather than one, because that is what makes read-only mode
expressible (FR-020): a client between the two may read and not write.

## The merge, as a pure function

Not stored at all. Merging takes three document states — common ancestor, local,
remote — and returns either a merged document or the blocks that need the owner.

```
mergeDocuments(ancestor, local, remote) →
  | { merged: BlockDocument }                    // no block changed on both sides
  | { conflicted: BlockId[], ... }               // these blocks need a decision
```

Pure because the outcome decides what happens to an owner's words, and that is
worth being able to test exhaustively without a browser or a database — the same
reason the eviction rule lives in the domain.

**The rule**: a block changed on only one side takes that side. A block changed
on both sides is conflicted. A block added on one side is kept; a block deleted
on one side and edited on the other is conflicted, because "I deleted this" and
"I rewrote this" are both intentions and the product cannot pick between them.

## What history must show

| Field | Source |
| --- | --- |
| Date | `revisions.accepted_at` |
| Device | `revisions.authored_by_device_id`, resolved to its display name |
| Nature | The mutation's command type, already recorded |

All three exist or are added above. Nothing here needs a new event log: the
revision graph plus the mutation record already say when, what and — with this
feature — where from.
