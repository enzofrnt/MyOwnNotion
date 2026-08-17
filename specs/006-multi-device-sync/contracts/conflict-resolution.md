# Contract: Merge and Conflict Resolution

What merges without asking, what the owner is shown, and what a resolution
leaves behind. Implements FR-011 to FR-016.

## What is a conflict, and what is not

Feature 001's causal check already answers this, and this feature adds no second
detector — two detectors could disagree, and which answer an owner saw would
depend on which ran.

- **Behind**: the device's base revision is an ancestor of the current one. Not a
  conflict; the device catches up. This is already true today, and FR-011 is
  therefore a property to protect rather than to build.
- **Diverged**: the device's base and the current revision share an ancestor and
  neither descends from the other. A conflict, and only now.

## Automatic merge

```
mergeDocuments(ancestor, local, remote)
  → { kind: "merged", document }
  → { kind: "needs-owner", conflictedBlockIds, ancestor, local, remote }
```

Pure, total, and in the domain, because the outcome decides what happens to
someone's words and that deserves exhaustive testing without a browser.

**The rule, per block:**

| Ancestor | Local | Remote | Result |
| --- | --- | --- | --- |
| unchanged | changed | unchanged | local |
| unchanged | unchanged | changed | remote |
| — | changed | changed (differently) | **conflicted** |
| — | changed | changed (identically) | either; they agree |
| present | deleted | unchanged | deleted |
| present | deleted | changed | **conflicted** |
| absent | added | absent | kept |

The two conflicted rows are the interesting ones. "Both changed the same block"
is obvious. "One deleted, the other rewrote" is the case a naive merge gets
wrong: taking the deletion silently discards the rewrite, and taking the rewrite
silently resurrects something the owner removed. Both are intentions, and the
product cannot choose between them.

Block order is taken from the side that changed it; when both reordered, the
order is conflicted like any other change — an owner who arranged a page
deliberately would not want the other device's arrangement imposed.

## What the owner is shown

Three columns, because two are not enough: without the common state an owner
cannot tell which side changed what, and is reduced to comparing two documents
that both look plausible.

```
+---------------+---------------+---------------+
| On this       | Common        | On the other  |
| device        | state         | device        |
+---------------+---------------+---------------+
```

Per conflicted block, the owner may take the local side, take the remote side,
or keep both. Everything not conflicted is already merged and shown as such,
rather than presented as a decision — a screen that asked about every block
would train an owner to click through it.

Before committing they see the assembled result exactly as it will be saved
(FR-015). A confirmation that shows a summary instead of the document is one that
gets accepted without being read.

## What a resolution writes

One revision whose parents are **both** conflicting revisions:

```
parent_revision_ids: [localRevisionId, remoteRevisionId]
```

That single shape satisfies FR-016. Both sources stay reachable as ancestors, so
"the originals are kept" is a property of the lineage rather than a retention
rule someone must remember to honour, and the history shows a resolution for what
it is: the point where two lines of work rejoined.

Nothing is destroyed before the owner decides, and the resolution destroys
nothing either — it adds.

## Abandoning

Closing the screen without deciding leaves the conflict exactly as it was. A
conflict that expired or resolved itself after a while would be a version of the
owner's work discarded without anyone choosing to discard it, which is the
failure the durable conflict record exists to prevent.
