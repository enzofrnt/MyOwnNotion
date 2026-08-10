# Data Model: Owner Security Foundation

This model adds security ownership and protection metadata around feature 001.
It does not replace feature-001 entities or identities. Security migrations
must preserve every workspace, item, placement, relationship, mutation,
revision, revision-parent edge, file logical identity, and browser projection
identity exactly.

## Modeling rules

- IDs are UUIDv7-compatible UUIDs unless a field explicitly says opaque bytes.
- Timestamps are UTC metadata, not causal ordering; feature-001 parent edges
  remain the source of revision lineage.
- Protected payloads use the `mn.enc.v1` envelope in
  [security-artifacts.schema.json](./contracts/security-artifacts.schema.json).
- PostgreSQL stores envelope metadata/ciphertext and decrypts only in process
  memory after key authorization succeeds.
- Missing/corrupt protected payload is never treated as empty content; reads
  fail closed with a safe integrity/configuration problem.
- Plain routing metadata is limited to what existing singleton, foreign-key,
  lifecycle, and hierarchy transactions require. Names, documents, file
  content/metadata, snapshots, relationship details, and search payloads are
  protected.

## Entities

### InstallationSecurity

Singleton security lifecycle row.

| Field | Meaning and validation |
| --- | --- |
| `installation_id` | Stable UUID; one row per installation; recovery binding |
| `workspace_id` | FK to feature-001 singleton `workspaces.id`; never changed during recovery |
| `state` | `uninitialized`, `bootstrapping`, `ready`, or `recovery-required` |
| `schema_version` | Positive integer; checked before protected reads |
| `active_key_generation` | FK to current `EncryptionKeyGeneration`; one write generation |
| `recovery_epoch` | Monotonic integer; increments when recovery is replaced/revoked |
| `session_inactivity_days` | Integer 1--90; default 30 |
| `recent_authentication_minutes` | Integer 1--60; default 15 |
| `created_at`, `updated_at` | UTC metadata |

Transitions:

```text
uninitialized -> bootstrapping -> ready
       ^              |             |
       |              v             v
       +------- expiration     recovery-required -> ready
```

`ready` commits owner, first credential, initial key generation, recovery
metadata, and workspace linkage atomically.

### BootstrapAttempt

| Field | Meaning and validation |
| --- | --- |
| `id` | Opaque UUID returned to bootstrap client |
| `installation_id` | Singleton FK |
| `challenge_hash` | SHA-256 digest of one-time WebAuthn challenge; raw challenge is transient |
| `state` | `open`, `passkey-verified`, `completed`, `expired`, `cancelled` |
| `expires_at` | Maximum 15 minutes from creation |
| `request_fingerprint` | Coarse rate-limit/audit correlation, never raw credential/request |
| `created_at`, `completed_at` | UTC metadata |

At most one open attempt exists. Consuming it is required for completion; it
cannot authorize private content by itself.

### OwnerIdentity

| Field | Meaning and validation |
| --- | --- |
| `owner_id` | Stable UUID, unique singleton; not recreated by reset/recovery |
| `installation_id` | Unique FK to `InstallationSecurity` |
| `status` | `pending`, `active`, or `locked`; `active` required for private access |
| `created_at`, `last_authenticated_at` | UTC metadata |

There is intentionally no username, email, role, team, member, or second-owner
column. Hosting administrators are audit classifications, not owner identities.

### PasskeyCredential

| Field | Meaning and validation |
| --- | --- |
| `credential_id` | Unique opaque WebAuthn credential ID bytes |
| `owner_id` | Singleton-owner FK |
| `public_key` | Credential public-key bytes; never logged |
| `sign_count` | Non-negative authenticator counter, updated after verified assertion |
| `transports` | Validated WebAuthn transport list; optional |
| `backup_eligible`, `backup_state` | WebAuthn lifecycle flags |
| `label` | Owner display label, length-limited |
| `state` | `active` or `revoked` |
| `created_at`, `last_used_at`, `revoked_at` | UTC metadata |

At least one active passkey remains required except during administrative
recovery. Add/remove requires a recent owner authentication.

### PasswordCredential

| Field | Meaning and validation |
| --- | --- |
| `owner_id` | Unique singleton-owner FK |
| `scheme` | `scrypt` for V1 |
| `parameters` | `{N:131072,r:8,p:1,keyLength:32}` with bounded upgrades |
| `salt` | Random 16-byte salt |
| `verifier` | 32-byte one-way derived output |
| `version` | Password-policy version |
| `state` | `active` or `disabled` |
| `created_at`, `updated_at` | UTC metadata |

### Session

Raw cookie value is never stored.

| Field | Meaning and validation |
| --- | --- |
| `session_id` | UUID for UI/audit, not bearer material |
| `token_digest` | SHA-256 digest of 32-byte random cookie token; unique |
| `owner_id`, `device_id` | Singleton-owner and authorized-device FKs |
| `auth_method` | `passkey`, `password`, or `admin-recovery` |
| `csrf_token_digest` | SHA-256 digest of per-session synchronizer token |
| `issued_at`, `last_seen_at`, `expires_at` | Expiry is last activity plus configured inactivity period |
| `recent_auth_at` | Sensitive-operation gate |
| `state` | `active`, `revoked`, or `expired` |
| `revoked_at`, `revoke_reason` | UTC and safe code |

### AuthorizedDevice

| Field | Meaning and validation |
| --- | --- |
| `device_id` | Stable UUID; reauthorization receives a new ID |
| `owner_id` | Singleton-owner FK |
| `name` | 1--120 Unicode characters |
| `platform` | Controlled value such as `web-linux`, `web-macos`, `web-ios`, `unknown` |
| `client_type` | `web` in this feature; native values reserved for later specs |
| `device_public_key` | Optional non-exportable Web Crypto P-256 public key |
| `key_protection` | `platform-secure-storage`, `browser-non-exportable`, or `unavailable` |
| `authorized_at`, `last_activity_at`, `last_sync_at` | UTC metadata |
| `state` | `active`, `revoked`, or `pending` |
| `local_storage_limit_bytes` | Positive configurable limit; no silent truncation |
| `local_usage_bytes` | Last verified device report |
| `revoked_at`, `revoke_reason` | UTC and safe code |

Revocation blocks session creation/renewal, synchronization, device proof, and
key use. It cannot erase unreachable local ciphertext.

### EncryptionKeyGeneration

| Field | Meaning and validation |
| --- | --- |
| `generation` | Positive monotonic integer, unique per installation |
| `installation_id` | Singleton FK |
| `algorithm` | `AES-256-GCM+HKDF-SHA-256` for V1 |
| `wrapped_root_key` | `mn.wrap.v1` envelope under external deployment key; never plaintext |
| `deployment_key_reference` | Non-secret configured secret name/version |
| `state` | `active-write`, `decrypt-only`, `revoked`, or `failed` |
| `created_at`, `activated_at`, `revoked_at` | UTC metadata |
| `compatibility_until` | UTC/null historical-restore policy boundary |

Only one generation is `active-write`. Revoked generations cannot authorize new
access; decrypt-only is allowed only by explicit rotation/recovery policy.

### ProtectedRecordEnvelope

| Field | Meaning and validation |
| --- | --- |
| `format` | `mn.enc.v1` |
| `entity_type`, `entity_id` | Canonical type and stable ID, AAD-bound |
| `workspace_id` | AAD-bound singleton workspace ID |
| `key_generation` | Authorized `EncryptionKeyGeneration` |
| `record_version` | Positive replacement/re-encryption version |
| `salt` | Random HKDF salt, 16 bytes |
| `nonce` | Random 12-byte AES-GCM nonce |
| `ciphertext`, `tag` | Ciphertext and 16-byte authentication tag |
| `aad_digest` | SHA-256 of canonical AAD |

Bad AAD, generation, tag, format, or key authorization is an integrity/config
failure, never empty JSON.

Feature-001 mappings:

| Feature-001 data | Security treatment | Identity/routing preserved |
| --- | --- | --- |
| `items.name` | Encrypted envelope | item ID, kind, lifecycle, revision ID |
| `page_documents.body` | Encrypted document payload | page ID, format/version |
| `revisions.snapshot` | Encrypted snapshot | revision ID and parent edges |
| relationship details/metadata | Encrypted payload | relationship ID and required scope/endpoints |
| file bytes/content metadata | Encrypted chunked blob + manifest | logical file/item/content IDs and digest lineage |
| search/index payloads | Encrypted index payload; no plaintext term index | index scope/version |
| browser projection/outbox/conflicts | Client-local encrypted envelopes | UUIDs, mutation IDs, cursors, causal headers |

### RecoveryKitRecord

Server metadata for an exported artifact, whose bytes remain outside workspace
storage by default.

| Field | Meaning and validation |
| --- | --- |
| `kit_id` | UUID embedded in artifact and used for revocation |
| `installation_id` | Cross-installation import binding |
| `recovery_epoch` | Must equal current non-revoked epoch on import |
| `format_version` | Supported artifact version |
| `supported_generations` | Generation IDs included for historical compatibility |
| `state` | `active`, `revoked`, or `superseded` |
| `created_at`, `revoked_at` | UTC metadata |
| `artifact_digest` | Digest of exported bytes, not a secret |

The DB stores no recovery passphrase or decrypted artifact payload.

### KeyRotationOperation

| Field | Meaning and validation |
| --- | --- |
| `operation_id` | UUID/idempotency key |
| `installation_id` | Singleton FK |
| `mode` | `scheduled` or `emergency` |
| `from_generation`, `to_generation` | Existing and prepared generations |
| `phase` | `planned`, `prepared`, `rewrapping`, `committing`, `complete`, `failed` |
| `cursor` | Opaque deterministic record/chunk cursor |
| `processed_count`, `total_count` | Non-negative progress |
| `audit_reason` | Bounded safe text/code; no content/secret |
| `checkpoint_digest` | Integrity digest of metadata/cursor |
| `created_at`, `updated_at`, `completed_at` | UTC metadata |

At most one non-terminal rotation is active. Reopening resumes or returns to
the last complete phase.

### SecurityAuditEvent

Append-only redacted event.

| Field | Meaning and validation |
| --- | --- |
| `event_id` | UUIDv7 |
| `installation_id`, `owner_id`, `session_id`, `device_id` | Safe nullable references |
| `event_type` | Auth, credential, device, session, recovery, key, integrity, or admin |
| `outcome` | `success`, `failure`, `refused`, or `started` |
| `actor_class` | `owner`, `hosting-admin`, or `system` |
| `correlation_id` | Request/command correlation UUID |
| `safe_code` | Stable redacted reason code |
| `metadata` | Strict allowlist of numeric/enumerated fields |
| `occurred_at` | UTC |

### AuthRateLimitBucket

| Field | Meaning and validation |
| --- | --- |
| `bucket_id` | HMAC-derived opaque identity; no raw IP |
| `operation` | `bootstrap`, `passkey`, or `password` |
| `failure_count` | Non-negative bounded counter |
| `window_started_at`, `locked_until` | UTC |
| `last_failure_code` | Safe enum/code |

## Local browser entities

Feature-001 `BrowserLocalState`, projection, outbox, conflict, revision-header,
and cursor identities remain. Their payload-bearing fields become encrypted
`mn.enc.v1` records in Dexie.

### LocalDeviceKeyState

| Field | Meaning |
| --- | --- |
| `device_id` | Server `AuthorizedDevice.device_id` |
| `key_handle` | Non-exportable Web Crypto/IndexedDB key reference, never raw bytes |
| `protection_capability` | `platform-secure-storage`, `browser-non-exportable`, or `unavailable` |
| `key_version` | Local encryption format version |
| `created_at`, `last_verified_at` | UTC/ISO metadata |
| `state` | `available`, `locked`, `lost`, or `reauthorization-required` |

### LocalEncryptedRecord

| Field | Meaning |
| --- | --- |
| `record_id` | Existing item/revision/mutation/conflict identity |
| `record_type` | Existing local table/payload type |
| `envelope` | Authenticated encrypted payload; no plaintext fallback |
| `updated_at` | Local metadata |

Unavailable local keys block local reads and keep ciphertext/outbox rows intact;
reauthorization never deletes pending operations automatically.

## Cross-entity invariants

1. Exactly one installation, owner, and feature-001 workspace exists.
2. A session references an active owner/device; revocation is checked before
   private reads, writes, sync, or renewal.
3. Bootstrap completion, first owner/passkey, initial generation, recovery
   metadata, and readiness commit together or not at all.
4. Envelope entity/workspace/generation identity matches its row and AAD.
5. No active write uses a revoked generation; revoked generation/device/
   session/passkey/kit cannot authorize new access.
6. A rotation checkpoint is fully committed or absent; retry is idempotent and
   never overwrites a newer record version.
7. Recovery never alters feature-001 canonical IDs, parents, placements,
   logical file identities, or local mutation IDs.
8. Audit/diagnostic serialization recursively rejects forbidden fields.
9. No state change is exposed as GET; destructive admin commands require
   dry-run or explicit confirmation.
