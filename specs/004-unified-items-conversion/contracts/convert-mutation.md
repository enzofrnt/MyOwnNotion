# Contract: the `item.convert` mutation

**Requirements**: FR-004 to FR-014 | **Research**: [decision 2](../research.md)

The named operation that changes an item's kind. It exists as a command in its
own right, rather than as a field update, because FR-014 requires its guarantees
to hold for every caller — including a script, a direct API call, and a client
that has not been written yet.

## Command

```jsonc
{
  "type": "item.convert",
  "itemId": "01924f8e-…",
  "targetKind": "folder",          // "page" | "folder"
  "baseRevisionId": "01924f8e-…",
  "confirmedDestruction": true     // required when the page holds content
}
```

Enqueued through the same outbox as every other mutation, so it works offline
and reconciles by the existing rules.

## Outcomes

| Situation | Result |
|-----------|--------|
| folder → page | accepted, no confirmation needed |
| page → folder, page has no content | accepted; the interface may say there was nothing to lose |
| page → folder, page has content, `confirmedDestruction: true` | accepted; content and its attachments removed |
| page → folder, page has content, flag absent or false | **refused**, `conversion.confirmation-required` |
| target kind already current | accepted as a no-op |
| item is a file, or target is `file` | refused, `conversion.file-not-convertible` |
| item is not active | refused, `item.not-active` |
| `baseRevisionId` is stale | refused by the existing causal-base rule |

The no-op case is deliberate rather than lax. An offline command may be replayed
after a restart, and a retried conversion that has already happened must
succeed quietly instead of failing on the second attempt.

## Guarantees

**Identity survives.** Same item id, same revision lineage, same references. A
conversion is never a delete followed by a create — if it were, every guarantee
feature 001 makes about identity would be void for the one operation most likely
to need them.

**Every hierarchy child survives, in both directions, without exception.** Not
"usually", not "unless it is a file": the placements are not touched at all,
because the schema no longer denormalises anything that a conversion changes.
This is the guarantee that stopped being a promise and became a structural
property — see [decision 1](../research.md).

**The destructive direction is refused without confirmation, in the domain.**
Not in the route, not in the component. A caller that skips the flag receives
`conversion.confirmation-required` whatever path it took.

**Everything happens in one transaction.** The kind change, the page-document
deletion and the envelope deletion commit together or not at all. There is no
moment when an item is a folder that still owns a document, and none when a
document is gone but the item is still a page.

**A revision is produced.** The state before the conversion is restorable by the
existing history mechanism, for as long as snapshots are retained.

## Error codes

| Code | Meaning |
|------|---------|
| `conversion.confirmation-required` | The page holds content and the command did not confirm its destruction |
| `conversion.file-not-convertible` | The item is a file, or the target kind is `file` |
| `item.not-found` / `item.not-active` | Existing codes, unchanged |

`conversion.confirmation-required` is a refusal, not a prompt. The server does
not ask; it declines, and the client is responsible for asking the owner and
resubmitting. That keeps the decision with the person and the enforcement with
the data.

## What the interface must add

The confirmation named by FR-010 must state **what** is destroyed — the
editorial content and the attachments bound to it — and that recovery is
possible only within the retention window. It must not quote a number that
could drift from the actual policy; it refers to the window, and the window is
defined by feature 001.
