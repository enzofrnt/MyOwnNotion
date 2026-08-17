# Contract: Local Availability and Offline Intent

What a device promises to hold, what it may release, and what it must say about
either. Implements FR-014 to FR-019.

## Offline intent

Server-side, carried on the item (research decision 6).

```
POST /v1/items/{itemId}/offline
{ "offline": true }
```

The state is named, not toggled — the offline outbox replays, and a toggle
replayed an even number of times lands on the answer the owner did not give.
The same reasoning as `item.favourite` in feature 003.

Applies to a page, a folder, or a file (FR-016). A folder's intent is inherited
by everything beneath it and resolved at read time, so moving a branch cannot
leave a stale marking behind.

## Local availability

Never sent to the server. Each device answers for itself, and no device's
answer is authoritative for another.

| State | Means | Shown as |
| --- | --- | --- |
| `present` | Content held on this device. | Nothing special; it just opens. |
| `offloaded` | This device had it and released it. | Marked, with the space it would take to bring back. |
| `never-fetched` | This device has never held it. | Marked as available from the server. |

`offloaded` and `never-fetched` are kept distinct deliberately. Collapsed into
"not here" they read the same, and they are not the same: one says the device
made room, the other says the owner has not opened this yet. An owner deciding
whether something is safe needs the difference.

None of the three ever reads as "missing". A file the server holds is not lost
because this laptop has not fetched it, and saying so would be the single most
damaging sentence this feature could put on screen.

## Budget

```
GET  /v1/devices/self/storage        (local only — never leaves the device)
{ "limitBytes": 5368709120, "usedBytes": …, "persisted": true,
  "measuredAt": "…", "breakdown": [ … ] }
```

`limitBytes: null` means unlimited. Unlimited is the absence of a limit, not a
large number standing in for one.

`breakdown` is what FR-019 requires: not a total, but what is holding the
space, so an owner can act on it rather than only watch it.

## Eviction

Runs when measured usage exceeds the limit. Two groups are untouchable:

1. unsynchronized changes, unresolved conflicts, navigation metadata, titles,
   sync information, access-critical information (FR-015, FR-017);
2. anything under an active offline intent (FR-016).

Everything else is ordered by least-recently-accessed within: large file
content, then old attachment content, then synchronized page content not
recently opened.

**The admission rule is recoverability, not size or age.** Content enters the
evictable set because the server can return it; size and age only decide the
order once it is in. Stated this way round because the tempting shortcut —
"evict the biggest thing" — is exactly how an unsynchronized change gets
released.

Eviction keeps title and metadata and drops content (FR-018), and is recorded
so the owner can see what happened and why the limit was reached. Automatic,
never silent.

## Retrieval

Opening offloaded or never-fetched content fetches it, and says so while it
does. Offline, it states that the content is not on this device and that the
connection is what is missing — never that the content is gone.
