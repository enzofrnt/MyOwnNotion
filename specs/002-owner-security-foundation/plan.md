# Implementation Plan: Owner Security Foundation

**Branch**: `codex/spec-update` (current branch; this planning run does not switch branches)
**Date**: 2026-08-10
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-owner-security-foundation/spec.md`

## Summary

Deliver the security boundary for the one installation and its existing
feature-001 canonical workspace. The design adds a transactional first-run
claim, passkey and password authentication, opaque revocable sessions,
owner-managed authorized devices, application-level encryption for server and
browser-local persisted data, an external deployment key, encrypted offline
recovery kits, resumable key rotation, administrative recovery commands, and
redacted security auditing. Feature 001 remains the sole owner of canonical
content identities and domain rules; this feature changes only the persistence
protection and authorization envelopes around those records.

The design uses the existing TypeScript monorepo, Fastify API,
PostgreSQL/Drizzle store, Dexie client store, OpenAPI-first contracts,
Vitest/Testcontainers/Playwright checks, Node.js 24, and pnpm 10.33.3. It
introduces no application code in this planning phase and does not create or
switch a branch.

## Product direction and dependencies

- Product-canvas scope: sections 5 (single owner and administrator boundary),
  8 (authentication and sessions), 9 (authorized devices), 28 (encryption and
  key management), 29 (security and privacy), and 34 (administrative commands).
- Feature dependency: [001-content-foundations](../001-content-foundations/spec.md)
  supplies the canonical workspace, items, placements, relationships, files,
  revisions, mutations, export model, and browser projection.
- Explicit exclusions: public sharing, MCP, desktop/native clients, block
  editing, backup scheduling/transfer/general retention, update rollback, and
  application implementation.
- The feature-001 model is not duplicated or redefined. Stable IDs, causal
  revision identity, hierarchy semantics, file logical identity, outbox
  identity, and the workspace singleton remain authoritative.

## Technical Context

**Language/Version**: TypeScript 5.9.x in strict mode, Node.js 24 LTS, browser
TypeScript/TSX only; exact pnpm release `10.33.3` from root metadata and the
committed `pnpm-lock.yaml`.

**Primary Dependencies**: Existing Fastify 5, Drizzle ORM 0.44.x, PostgreSQL
18, React 19, Vite, Dexie, TypeBox, Biome, Vitest, fast-check, Testcontainers,
and Playwright. Add `@simplewebauthn/server` 13.3.2 to `apps/api` and
`@simplewebauthn/browser` 13.3.0 to `apps/web`, with versions recorded in the
lockfile. Use Node `node:crypto` and browser Web Crypto rather than a second
general-purpose cryptography library.

**Storage**: PostgreSQL remains authoritative for installation/security
metadata and protected canonical content. Existing feature-001 rows migrate to
encrypted payload columns or encrypted blob adapters while retaining canonical
IDs and routing metadata required for transactional queries. Dexie/IndexedDB
stores encrypted browser projection, local files, indexes, outbox, conflicts,
and cursors. The deployment key is read from a Compose secret file, with an
explicit loopback-only development fallback, never from the repository or DB.

**Testing**: Vitest unit/property tests for crypto envelopes, state machines,
redaction, and command parsing; PostgreSQL/Testcontainers migration and
concurrency tests; OpenAPI and JSON-Schema contract tests; fault-injection
tests at every bootstrap, recovery, and rotation checkpoint; Playwright
desktop/mobile journeys with WebAuthn virtual authenticators; existing pnpm
toolchain, format, lint, type, migration, build, Compose, and security checks.

**Target Platform**: Self-hosted Linux server through Docker Compose, loopback
HTTP by default and external HTTPS reverse proxy for non-local exposure; current
supported evergreen browsers.

**Project Type**: TypeScript monorepo with one Fastify API, one responsive web
client, domain/database/blob/client-core/contracts packages, and layered tests.
No new service or worker is introduced by this plan.

**Performance Goals**: Preserve feature-001's 150 ms p95 common-operation target
where encryption is included. Scrypt work must be bounded and observable
without blocking the event loop. Rotation is resumable and reports progress;
it does not claim instant completion.

**Constraints**: Exactly one owner and one workspace; no second account or
role. Session inactivity is 30 days by default and configurable from 1 to 90
days. Sensitive operations require authentication within 15 minutes. Secrets
and private content never appear in logs. Encryption fails closed, uses
authenticated integrity, identifies format and generation, and avoids exposing
all plaintext during rotation. Local encrypted state remains durable offline;
revocation cannot promise remote erasure from an unreachable device.

**Scale/Scope**: One installation, up to 10 authorized devices in the V1
reference fixture, and feature-001 fixtures up to 100,000 pages, 1,000,000
blocks, 100,000 relationships, 50,000 files, and 500 GB represented by real or
sparse test data. Security acceptance includes concurrent bootstrap,
invalid/corrupt credentials and keys, revoked devices/sessions/kits,
interrupted rotations, and compatible recovery without changed canonical IDs.

## Constitution Check

*GATE: Passed before Phase 0 research and re-checked after Phase 1 design.*

| Principle | Gate | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | One owner/workspace is enforced; recovery is offline-storable; browser-local content/outbox remain available while disconnected | Pass |
| II. One Spec, Any Agent | Traceability, research, design, contracts, and validation remain in this feature directory; feature-001 remains canonical | Pass |
| III. Incremental, Verifiable Delivery | Each story has focused unit, property, integration, contract, fault-injection, and Playwright scenarios | Pass |
| IV. Privacy and Security by Default | Authenticated application encryption, external key material, sessions, CSRF, rate limits, audit redaction, recovery, and rotation are explicit | Pass |
| V. Simple, Modular Architecture | One API, one web app, one database, and existing packages; no microservice, queue, or public identity provider | Pass |
| VI. Accessible and Predictable Experience | Bootstrap, auth, recovery readiness, device revocation limits, rotation progress, and integrity failures have explicit states and responsive journeys | Pass |
| VII. Reproducible Toolchains and Enforced Quality | Existing Node/pnpm lockfile, Biome, strict types, tests, migrations, Compose checks, builds, and security gates are retained | Pass |
| VIII. Canonical Product Direction | Canvas scope, dependency, V1 boundary, and exclusions are recorded without roadmap expansion | Pass |

No exception is required. All clarifications are resolved in `research.md`,
all protected state has a named owner and failure behavior in `data-model.md`,
and every external operation is represented in `contracts/` and `quickstart.md`.

## Project Structure

### Documentation (this feature)

```text
specs/002-owner-security-foundation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── security-api.openapi.yaml
│   ├── security-artifacts.schema.json
│   └── admin-cli.md
├── checklists/requirements.md
└── tasks.md                 # generated later by speckit-tasks
```

### Source Code (repository root)

```text
apps/api/src/{routes,plugins,admin,security}/
apps/web/src/{features/auth,features/devices,features/security,services}/
packages/domain/                       # platform-independent security rules
packages/contracts/                    # shared security DTOs
packages/database/src/{schema/security,repositories/security}/
packages/database/migrations/          # reviewed forward migrations
packages/client-core/src/{local-store,security}/
packages/blob-store/                   # encrypted adapter over existing contract
tests/{contract,e2e,fixtures}/
```

**Structure Decision**: Extend existing package boundaries. Security/domain
rules remain independent of Fastify, React, Drizzle, and browser APIs.
PostgreSQL owns installation/security metadata and encrypted canonical payloads;
the API is the only server application boundary; the browser owns only its
encrypted projection and device-local key handle. No authentication, KMS, or
backup service is introduced.

## Design Decisions

1. **Bootstrap**: A singleton installation-security row has
   `uninitialized`, `bootstrapping`, `ready`, and `recovery-required` states.
   Bootstrap start locks it, validates the external deployment key, and creates
   a 15-minute server-side attempt. Completion writes owner, first passkey,
   optional password, recovery metadata, and workspace readiness atomically.
   Interrupted attempts expire without leaving a usable partial owner;
   concurrent claims resolve to one success through a row lock and unique
   constraints.
2. **Passkeys/passwords**: WebAuthn uses discoverable credentials,
   `userVerification: required`, exact configured origin/RP ID/challenge checks,
   sign-counter updates, and `attestation: none`. Passwords are NFC-normalized,
   12--1024 UTF-8 bytes, and stored only as versioned asynchronous scrypt
   (`N=2^17`, `r=8`, `p=1`, random 16-byte salt, 32-byte output).
3. **Sessions/CSRF**: Generate 32-byte opaque tokens, store SHA-256 digests,
   and issue an HttpOnly `__Host-` cookie with `Path=/`, `SameSite=Strict`, and
   `Secure` for HTTPS. A loopback HTTP development exception is explicit.
   Bind sessions to devices, use a per-session synchronizer token in
   `X-CSRF-Token`, and require Origin/Referer checks for unsafe JSON methods.
4. **Devices/local state**: A browser device has owner-visible activity and
   storage fields plus an optional non-exportable P-256 public key. Every sync
   checks active session/device state. Dexie payloads are AES-GCM encrypted
   with a non-exportable Web Crypto key; lack of a protected key blocks local
   reads without deleting ciphertext or pending work.
5. **Server encryption**: A random 32-byte external deployment key wraps one
   random 32-byte workspace root key per generation using AES-256-GCM. HKDF
   derives domain-separated record keys; AES-256-GCM envelopes use random
   12-byte nonces, 16-byte tags, and AAD containing entity/workspace/generation
   identity. Large files use authenticated 4 MiB chunks and an encrypted
   manifest. Content-revealing payloads are encrypted; feature-001 IDs and
   routing metadata needed for constraints remain stable.
6. **Recovery**: A versioned JSON kit contains installation/kit identity,
   recovery epoch, scrypt parameters, and AES-GCM ciphertext of wrapped keys.
   A separate passphrase is supplied only through protected prompt/stdin/file,
   never argv. Replacing a kit increments the epoch, revokes prior IDs, and
   includes only supported historical generations in the new kit.
7. **Rotation**: Persist `planned -> prepared -> rewrapping -> committing ->
   complete` (or resumable `failed`) with cursor, counts, generations, reason,
   and digest. New writes switch only after prepared metadata commits; one
   record/chunk is checkpointed at a time; old generations stay decrypt-only
   until compatibility/recovery policy completes.
8. **Administration/audit**: A local Compose CLI provides help, fixed exit
   codes, JSON/text output, dry-run and explicit confirmation. It covers
   password reset, session revocation, integrity/key checks, rotation,
   recovery/repair, compatibility, and redacted diagnostics. Audit records are
   append-only, allowlisted, and recursively reject secrets/private content.
9. **Migration safety**: Reviewed forward migrations add security tables and
   encrypted payload columns before removing plaintext. Every failure leaves a
   complete prior state or resumable state; no feature-001 identity is
   regenerated.

## Data ownership and contracts

See [data-model.md](./data-model.md),
[contracts/security-api.openapi.yaml](./contracts/security-api.openapi.yaml),
[contracts/security-artifacts.schema.json](./contracts/security-artifacts.schema.json),
and [contracts/admin-cli.md](./contracts/admin-cli.md). These are inputs for
`speckit-tasks`; they contain no application implementations.

## Complexity Tracking

No constitution violations or unjustified architecture layers are present.
