# Research: Owner Security Foundation

**Date**: 2026-08-10
**Scope**: Resolve every security, cryptographic, dependency, and integration
unknown needed to plan bootstrap, authentication, sessions, devices,
encryption, recovery, rotation, and administrative commands.

## Sources

- [Web Authentication Level 3](https://www.w3.org/TR/webauthn-3/)
- [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server)
- [SimpleWebAuthn passkey guidance](https://simplewebauthn.dev/docs/advanced/passkeys)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)
- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [Node.js crypto API](https://nodejs.org/api/crypto.html)
- [RFC 5869 HKDF](https://www.rfc-editor.org/rfc/rfc5869)
- [RFC 5116 authenticated encryption](https://www.rfc-editor.org/rfc/rfc5116)
- [NIST key-management guidance](https://csrc.nist.gov/projects/key-management/key-management-guidelines)

## Decisions

### Web authentication

**Decision**: Use WebAuthn passkeys through `@simplewebauthn/server` 13.3.2
and `@simplewebauthn/browser` 13.3.0, with exact resolved pnpm entries.
Registration/authentication are server-challenged one-time ceremonies. Require
discoverable credentials and user verification; verify exact configured origin,
RP ID, challenge, user handle, credential ID, signature, and sign counter. Use
`attestation: none`.

**Rationale**: The W3C relying-party model supplies phishing-resistant public
key authentication without receiving a password. User verification makes the
passkey-alone path appropriate for the sole owner; attestation is unnecessary
authenticator-identity collection for this product.

**Alternatives considered**: Password-only auth fails the required passkey path;
a custom public-key ceremony would recreate browser and relying-party security;
hardware-attestation allowlists would unnecessarily reduce portability.

### Password and recovery derivation

**Decision**: Use Node's asynchronous scrypt with `N=2^17`, `r=8`, `p=1`, a
random 16-byte salt, and 32-byte output for the password verifier and recovery
passphrase. Store scheme/parameters for future upgrades; NFC-normalize input;
never log or persist it; bound concurrent derivations and benchmark locally.

**Rationale**: OWASP recommends Argon2id first and scrypt when Argon2id is not
available. Node 24 provides scrypt without a native addon, keeping the pinned
toolchain smaller while matching OWASP's minimum scrypt settings.

**Alternatives considered**: Argon2id native addons add platform complexity;
fast SHA-256 is unsuitable for password guessing; reversible password storage
is never acceptable; PBKDF2 is reserved for a future policy requiring it.

### Sessions and CSRF

**Decision**: Generate 32-byte opaque tokens, store SHA-256 digests, and issue
an HttpOnly `__Host-` cookie with `Path=/`, `SameSite=Strict`, and `Secure` for
HTTPS. Reject non-loopback HTTP outside explicit development mode. Bind to a
device, track inactivity/revocation, and use a per-session synchronizer token
in `X-CSRF-Token`; require exact Origin or trusted Referer checks for unsafe
methods and JSON content types.

**Rationale**: Opaque hashed tokens support immediate revocation and reduce
database-copy impact. SameSite is defense in depth, not the sole CSRF control.
HttpOnly avoids ordinary script token reads; no token is accepted in a URL.

**Alternatives considered**: JWTs add complexity without value in one
installation; JavaScript-readable bearer tokens amplify XSS; SameSite alone
does not satisfy the CSRF guidance.

### Server authenticated encryption

**Decision**: Use AES-256-GCM with 12-byte nonces, 16-byte tags, canonical AAD,
and a versioned envelope. A random external deployment key wraps one random
workspace root key per generation. HKDF-SHA-256 derives domain-separated record
keys from the root and random record salts. Large blobs use authenticated 4 MiB
chunks and an encrypted manifest.

**Rationale**: AES-GCM exists in Node and browser Web Crypto and supplies
confidentiality plus integrity. HKDF provides purpose/record separation. The
hierarchy supports rotation and recovery without a single direct data key.

**Alternatives considered**: CBC plus a separate MAC is composition-prone; one
static database key weakens rotation; asymmetric encryption per row is
unnecessary; zero-knowledge server encryption is excluded by the product
canvas because the server is allowed to decrypt canonical content.

### External deployment key

**Decision**: Supply a random 32-byte deployment key through
`/run/secrets/myownnotion_deployment_key`. A loopback-only development fallback
may read an explicit variable; production refuses plaintext `.env` use where a
secret file is available. The key is never persisted, logged, imaged, or put in
a recovery kit.

**Rationale**: The external key is a separate failure domain from encrypted
data and can be rotated operationally. It maps to the constitution's external
key-custody requirement without adding a V1 KMS dependency.

**Alternatives considered**: Deriving it from the owner password makes data
availability depend on optional/changeable auth; storing it in PostgreSQL or
`.env` violates the security boundary; a remote KMS is a later deployment
adapter, not a V1 prerequisite.

### Browser-local encryption

**Decision**: Encrypt all persisted local content/files/indexes/outbox/conflict
payloads before Dexie writes. Use a non-exportable AES-256-GCM Web Crypto key
retained in the strongest available platform/browser protected store. Record
`platform-secure-storage`, `browser-non-exportable`, or `unavailable`; block
protected local reads if unavailable. Reauthorization can create a new key and
resync without deleting old ciphertext.

**Rationale**: The web platform lacks one universal OS keystore. A
non-exportable CryptoKey plus an explicit limitation is the strongest portable
path and avoids claiming protection against an already-compromised open browser.

**Alternatives considered**: Plain Dexie or host encryption violates the
application-level requirement; an exportable key beside ciphertext defeats the
boundary; password-only derivation makes offline use depend on auth entry.

### Recovery kit

**Decision**: Export versioned JSON containing installation/kit ID, recovery
epoch, creation time, supported generations, scrypt parameters/salt, and
AES-GCM ciphertext of wrapped keys. The separate passphrase is entered at
export/import through a prompt or protected stdin/file, never argv. Kit
replacement increments the epoch, revokes prior IDs, and includes supported
historical generations in the new kit.

**Rationale**: JSON is durable and inspectable for format/binding without
revealing keys. A separate passphrase means password reset does not silently
unlock the recovery artifact. Historical compatibility remains explicit.

**Alternatives considered**: Unencrypted export, deployment-key-only export,
and colocating the kit with workspace data all collapse required recovery
boundaries. Password-derived server encryption would make auth changes threaten
data availability.

### Rotation

**Decision**: Persist `planned -> prepared -> rewrapping -> committing ->
complete`, with resumable `failed`, old/new generations, cursor, counts, audit
reason, and checkpoint digest. Commit new generation metadata before switching
new writes; process one record/chunk at a time; keep old generation decrypt-only
until compatibility/recovery policy completes; reject conflicting rotations.

**Rationale**: Per-checkpoint state survives crashes without a full plaintext
copy or a giant transaction and makes the transition observable.

**Alternatives considered**: One transaction risks locks and unrecoverable
interruption; immediate old-key deletion loses partially rewrapped data; a
dedicated worker is unnecessary for V1 and can drive the same state machine
later.

### Administrative commands

**Decision**: Provide a Compose-local admin command with built-in help,
deterministic exit codes, JSON/text output, dry-run, explicit confirmation,
and secret input only through protected file/stdin. Cover password reset,
session revocation, integrity/key checks, rotation, recovery/repair,
compatibility, and redacted diagnostics.

**Rationale**: The hosting administrator is an operational actor, not a second
application account. A local command avoids a powerful remote endpoint while
remaining automatable and testable.

**Alternatives considered**: Remote unauthenticated recovery is an attack
surface; undocumented SQL/SSH procedures are not reproducible; interactive-only
commands cannot support CI or scripted recovery.

## Resolved clarification inventory

| Unknown | Resolution |
| --- | --- |
| Passkey protocol/library | WebAuthn Level 3 semantics; SimpleWebAuthn 13.3.x, exact lock entries |
| Password algorithm | Node async scrypt, OWASP minimum parameters, versioned record |
| Session representation | Random opaque token, SHA-256 digest, HttpOnly `__Host-` cookie |
| CSRF | Per-session synchronizer token plus SameSite and Origin/Referer checks |
| Server encryption | AES-256-GCM, HKDF-separated record keys, encrypted blob chunks |
| External secret | 32-byte deployment key from Compose secret file |
| Local encryption | Web Crypto non-exportable AES key and explicit capability state |
| Recovery artifact | Versioned JSON, scrypt + AES-GCM, separate passphrase, epoch revocation |
| Rotation | Persisted resumable dual-generation state machine |
| Admin interface | Local Compose command with fixed help, exit codes, dry-run, confirmation, redaction |
