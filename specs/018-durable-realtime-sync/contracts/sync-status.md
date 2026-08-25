# Contract: Truthful synchronization status

## Separation of concerns

The visible status combines durable work states but does not confuse them with
transport diagnostics.

~~~text
content status                         connection diagnostic
├── not saved locally                  ├── connecting
├── saved on this device / pending     ├── live
├── synchronizing                      ├── local (offline)
├── synchronized                       ├── revoked
└── attention needed                   └── update required
~~~

`live` can coexist with pending work. `local` can coexist with content safely
saved on the device. Neither determines the other.

## Derived content states

Evaluate in this order:

1. **`local-save-failed`** when the last requested gesture failed before local
   durable commit. Label: `Not saved on this device`.
2. **`needs-attention`** when an open operational ambiguity, current workspace
   decision or quarantined historical recovery exists. Label:
   `Needs attention (n)`.
3. **`syncing`** when a durable row is `sending`, a page catch-up is active or
   file bytes are in flight. Label: `Synchronizing…`.
4. **`saved-local`** when durable local rows or files remain unconfirmed.
   Connected label: `Saved on this device · n to sync`. Offline label:
   `Saved on this device · will sync when online`.
5. **`synced`** only when every workspace/page/file queue is empty, all durable
   frontiers are confirmed and no active decision exists. Label: `Synced`.

An interrupted `sending` row counts as pending until its owner lock recovers it.
The interface must not briefly display `Synced` between reconnect and this
recovery pass.

## Counts

`pendingCount` includes:

- workspace outbox `pending`, `sending` and recoverable `blocked` rows;
- page update `pending`, `sending` and recoverable `blocked` rows;
- legacy offline branches not converted;
- legacy sync recoveries `pending` or `converting`;
- file requirements not durably completed.

`attentionCount` includes:

- open operational page ambiguities;
- active non-page workspace conflicts;
- quarantined historical recoveries.

`conflictCount`, where legacy components still require the field, is an alias
for active owner decisions only. It excludes:

- network failures and reconnect attempts;
- `storagePersisted === false`;
- historical page replacement rows being recovered;
- protocol or device refusals;
- transient server errors;
- items already converted or archived.

## Connection diagnostics

- `connecting`: no extra alarming copy during the first normal handshake.
- `live`: omitted from the compact content label; available to diagnostics.
- `local`: append `Offline` only when useful; explicitly say changes remain on
  this device if pending.
- `revoked`: blocking callout `This device is no longer authorized` with sign-in
  or recovery action.
- `needs-update`: blocking callout `Update this app before it can synchronize`.

A socket timeout is initially `local`, not `conflict`. Repeated failures can be
shown in diagnostics with retry timing.

## Persistent-storage diagnostic

`navigator.storage.persist()` returning false means the browser may evict local
data under storage pressure. It does not mean a save failed, a server rejected a
write or two versions conflict.

- Remove it from the workspace conflict sentence and compact status.
- Show a neutral warning in Settings → Storage/Diagnostics.
- Explain that current content remains available now, but browser eviction
  protection was not granted.
- Offer browser-specific guidance without claiming the application can force
  the permission.
- If local writes actually fail, use `local-save-failed`; do not infer failure
  from the persistence hint.

## Examples

| Situation | Content label | Diagnostic |
| --- | --- | --- |
| Clean and socket ready | `Synced` | `Live` |
| Clean and offline | `Synced` | `Offline` |
| Three durable edits offline | `Saved on this device · will sync when online` | `Offline` |
| Two batches in flight | `Synchronizing…` | `Live` |
| One delete/edit ambiguity | `Needs attention (1)` | `Live` |
| Five old page conflicts converting | `Saved on this device · 5 to sync` | `Recovering older drafts` |
| One old payload unprovable | `Needs attention (1)` | `Older draft available to export` |
| Persistence hint denied, no work | `Synced` | Settings warning only |
| Device revoked with pending work | `Saved on this device · 1 to sync` | Blocking revoked callout |

## Accessibility

- Compact label uses text, not color alone.
- State changes are announced through an existing polite live region only when
  the semantic state changes; heartbeats and every keystroke do not announce.
- The detail trigger is keyboard reachable and preserves focus on close.
- `needs-attention` links directly to the first unresolved decision or recovery.
- Motion or spinner is decorative and respects reduced-motion preference.
