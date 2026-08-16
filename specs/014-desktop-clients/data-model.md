# Data Model: Applications Desktop Electron Windows et macOS

Les entités ci-dessous appartiennent au profil local de l’appareil et ne
remplacent aucune identité canonique du serveur.

## DesktopServerProfile

| Field | Type | Rules |
| --- | --- | --- |
| `profileId` | UUID | Stable within the local installation |
| `label` | string | Owner-visible, non-sensitive |
| `serverUrl` | URL | Normalized origin; HTTPS required for non-local origins |
| `protocolCompatibility` | enum | `unknown`, `compatible`, `read-only`, `incompatible` |
| `deviceId` | UUID/null | Existing authorized-device identity; never generated as a second owner |
| `lastReachability` | timestamp/null | Diagnostic metadata only |
| `lastSyncAt` | timestamp/null | Mirrors the existing synchronization status |
| `active` | boolean | At most one active profile per desktop session |

Transitions: `configured → checking → compatible → authenticated`; refusals
are `unreachable`, `insecure`, `incompatible`, `revoked`, or `reauthorization`.
Changing URL never silently reuses a device key for a different origin.

## DesktopLocalVault

| Field | Type | Rules |
| --- | --- | --- |
| `vaultId` | UUID | One vault per authorized device/profile lineage |
| `schemaVersion` | integer | Monotonic, migration-controlled |
| `keyState` | enum | `missing`, `available`, `locked`, `unavailable`, `revoked` |
| `storageLimitBytes` | integer/null | Default 5 GiB; null means configured unlimited |
| `projection` | encrypted records | Uses client-core schema and identities |
| `outbox` | encrypted records | Never evicted or deleted automatically while unsynchronized |
| `conflicts` | encrypted records | Retained until explicit resolution/export |
| `lastMigration` | migration ref/null | Recovery evidence for interrupted upgrades |

The vault is readable only when key policy allows it. A failed migration must
leave either the prior valid schema or a resumable checkpoint; it must never
fall back to plaintext.

## DeviceKeyEnvelope

| Field | Type | Rules |
| --- | --- | --- |
| `keyId` | UUID | Stable device-key identity |
| `algorithm` | enum | `os-protected-envelope-v1` |
| `ciphertext` | bytes | Produced by the platform secure store; never logged |
| `createdAt` | timestamp | Diagnostic metadata |
| `revokedAt` | timestamp/null | Set on revoke/withdrawal; no silent recreation |

The raw local encryption key is not a persisted field and never crosses the
server API. The main process may handle it only transiently while wrapping or
unwrapping. The renderer may receive the bytes only long enough to import them
into a non-extractable WebCrypto key; it must not expose, log, or persist them.

## NativeCapabilityRequest

| Field | Type | Rules |
| --- | --- | --- |
| `requestId` | UUID | Correlates one renderer request and response |
| `capability` | enum | `choose-file`, `save-file`, `open-external`, `get-key-state`, `wrap-key`, `unwrap-key`, `window-state` |
| `arguments` | object | Schema-validated and capability-specific |
| `result` | object/error | Redacted, no raw IPC error leakage |

Only the allowlisted local renderer may issue requests. The server URL is not
enough to authorize a native capability.

## UpdateState

`idle → checking → available → deferred → downloading → downloaded →
installing → restarted`.

Failure states are `unavailable`, `invalid-manifest`, `incompatible`,
`download-failed`, `install-failed`, and `rollback-required`. An update cannot
enter `installing` while a local migration or unsafe outbox state is active
without an explicit owner decision and a preserved recovery checkpoint.

## WindowState

`bounds`, `isMaximized`, `lastRoute`, and `lastProfileId` are non-sensitive
preferences. They are written atomically and validated against platform bounds;
content, session cookies, keys and tokens do not belong here.
