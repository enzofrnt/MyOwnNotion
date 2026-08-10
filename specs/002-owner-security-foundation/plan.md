# Implementation Plan: Owner Security Foundation

**Branch**: `codex/spec-update`  | **Date**: 2026-08-10  | **Spec**: [spec.md](spec.md)

## Summary

Build the security boundary around the single owner and the canonical workspace
defined by feature 001. This plan is design-only: implementation, CI changes,
Compose changes, and release publication are pending the task phase.

The design has three independent security areas and two explicit recovery-kit
state axes:

1. Bootstrap-scoped provisional recovery establishes readiness without a
   session dependency. It keeps all pre-confirmation material attempt-scoped,
   gives one 15-minute download opportunity, and requires confirmation before
   readiness.
   Recovery-kit authorization and delivery are separate: `authorizationState`
   is `provisional`, `active`, `superseded`, `revoked`, or `rejected`, while
   `deliveryState` is `prepared`, `downloadable`, `download-consumed`,
   `confirmed`, or `expired`. The only valid pairs are exactly
   `provisional/prepared`, `provisional/downloadable`,
   `provisional/download-consumed`, `active/confirmed`,
   `superseded/confirmed`, `revoked/confirmed`, and `rejected/expired`;
   every other pair, including `provisional/expired`, is rejected.
2. Authenticated owner operations use a production Secure `__Host-mn_session`
   cookie and recent authentication. Replacement-kit management, passkey
   enrollment completion, credential removal/password changes, rotations, and
   owner-facing status operations are session+CSRF protected; mutations also
   require recent authentication. A named loopback-only development exception uses the separate
   non-`__Host-` `mn_dev_session` cookie only for local HTTP; it never weakens
   non-loopback behavior.
3. External deployment wrapping-key versions and workspace data-key generations
   are separate state machines. Wrapping rotation rewraps root keys; data-key
   rotation progressively re-encrypts records and chunks.

The migration is a staged, resumable state machine that keeps plaintext until
counts, digests, and feature-001 identities verify, then stops plaintext writes,
cuts reads over, and scrubs both SQL and blob remnants. Delivery is a complete
Compose topology and a pinned multi-platform GHCR release pipeline whose
publication job depends on the exact successful commit's complete quality gate.

## Product-canvas traceability and boundaries

This plan implements product-canvas sections 5, 8, 9, 28, 29, 34, and 36–41,
as named by [spec.md](spec.md). It preserves the permanent single-owner rule,
the feature-001 canonical identity authority, application encryption at rest,
offline recovery, local HTTP plus external reverse proxy, and reproducible
delivery. It does not reopen or edit `specs/001-content-foundations/`.

Feature 001 remains authoritative for `workspace`, canonical item, placement,
page document, logical file, file content, relationship, mutation, revision,
local projection, and outbox identities. Security tables reference those IDs;
they do not create replacements, shadow models, or a second workspace.

Excluded work remains public sharing, MCP, desktop/native clients, block-editor
behavior, backup scheduling/transfer, general restore orchestration, and
application implementation beyond the security foundation.

## Technical Context

**Language/Version**: TypeScript, Node.js `>=24.0.0 <25`, pnpm `10.33.3`

**Primary dependencies**: existing pnpm workspace; PostgreSQL 18; Fastify API;
React/Vite web; Drizzle migrations; Vitest; Playwright; Docker Compose; GHCR;
GitHub Actions; pinned external ShellCheck/shfmt versions already used by the
repository. New first-party source remains TypeScript/TSX.

**Storage**: PostgreSQL is authoritative for security metadata and encrypted
record envelopes. A durable filesystem/blob volume stores encrypted file
chunks. Both are mounted as durable Compose volumes. The deployment wrapping
key is supplied through a mounted secret and is never persisted with workspace
data.

**Cryptography**: AES-256-GCM authenticated envelopes with HKDF-SHA-256
per-record derivation; scrypt for passphrase-protected recovery-kit wrapping.
Envelope metadata includes entity type/ID, workspace ID, format, record
version, key generation, nonce, tag, and AAD digest. Exact parameters and
artifact shapes are normative in [security-artifacts.schema.json](contracts/security-artifacts.schema.json).

**Authentication**: WebAuthn passkeys are primary and password is an optional
alternative. Sessions are opaque, server-side, independently revocable,
CSRF-protected, and bound to an authorized device. The production cookie is
`__Host-mn_session; Secure; HttpOnly; SameSite=Strict; Path=/`, issued only
under HTTPS. The explicit development exception is
`MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1`, accepted only when both the trusted
request origin and bound listener are loopback HTTP. It uses the separate
opaque `mn_dev_session` cookie with `HttpOnly`, `SameSite=Strict`, and `Path=/`
but without `Secure`; it must never issue or accept `__Host-mn_session` over
HTTP. Any non-loopback HTTP request is rejected or redirected by deployment
policy and never receives the exception.

**Testing**: unit/property tests for state machines and crypto envelopes;
PostgreSQL integration and migration tests; OpenAPI/JSON Schema/admin contract
tests; Playwright responsive journeys; Compose startup/security tests; pinned
image/release verification; controlled-clock and fault-injection fixtures.

**Scale/Scope**: one installation, one owner, one canonical workspace; tests
must cover concurrent bootstrap, all listed protected categories, resumable
record/chunk operations, migration fault checkpoints, 20 bootstrap usability
trials with 5 operators, and 10 usability participants.

**Repository constraints**: preserve existing feature-001 artifacts and IDs;
use exact paths in the task list; keep all secrets out of source, images,
logs, `.env.example`, and ordinary configuration; keep local default ports on
`127.0.0.1`.

## Constitution Check — pre-design

| Principle | Design decision | Current repository evidence | Gate |
| --- | --- | --- | --- |
| I. Ownership/local resilience | One owner/workspace; encrypted local projection and documented export remain feature-001 identities | Feature-001 baseline is completed; security implementation is not yet present | PASS for design; implementation pending |
| II/VIII. Shared spec/product direction | This plan references the revised spec and product-canvas sections and does not edit feature 001 | Artifacts are on `codex/spec-update`; feature-001 files untouched | PASS |
| III. Incremental verification | Foundational → bootstrap → authenticated operations, with independent encryption/devices/recovery/migration/delivery increments and validation ledger | Tasks and current implementation do not yet provide all increments | PASS for plan; implementation pending |
| IV. Privacy/security | Application encryption, external mounted wrapping secret, offline kit, fail-closed reads, redaction, rotation and migration gates | Current code and Compose are feature-001 baseline and still lack this foundation | PASS for design; implementation pending |
| VI. Predictable access | Keyboard/focus/error-state Playwright journeys and explicit readiness/write-block states are planned | No security UI exists yet | PASS for plan; implementation pending |
| VII. Reproducibility/release | Frozen pnpm, complete Compose validation, branch/PR/main/tag gates, immutable multi-arch images, checksums and SBOM/provenance | Existing workflow lacks the complete stack and release publication topology | PASS for design; implementation/release evidence pending |

No design violation is accepted. The words “pending” and “blocked” above are
deliberate status statements: this plan does not claim that missing workflows,
Compose services, encrypted persistence, or release evidence already pass.

## Constitution Check — post-design

| Principle | Post-design evidence | Gate |
| --- | --- | --- |
| I. Ownership/local resilience | Bootstrap creates one owner/workspace; server and local projections are encrypted; feature-001 identities and export boundaries remain authoritative | PASS for design; implementation pending |
| II/VIII. Shared spec/product direction | The design traces to the product canvas and revised feature spec, keeps feature 001 as the identity authority, and records no cross-feature change | PASS |
| III. Incremental verification | The phase order gives each security axis an independently testable increment, with contract, unit/property, integration, and Playwright paths plus the validation ledger | PASS for plan; implementation pending |
| IV. Privacy/security | Production and loopback cookie names are separate; encryption uses an external mounted secret; recovery, redaction, rotation, migration, and fail-closed boundaries are explicit | PASS for design; implementation pending |
| V. Simple/modular architecture | Domain, database, blob, API, web, and client boundaries are explicit; no additional service or canonical identity authority is introduced | PASS |
| VI. Predictable experience | Bootstrap, recovery, readiness, write-block, error, keyboard/focus, and responsive browser journeys are planned | PASS for plan; implementation pending |
| VII. Reproducible toolchains/release | Existing `ci.yml` remains the single complete quality gate; planned `release.yml` publishes only after exact-SHA gate success, with Compose and artifact checks | PASS for design; implementation/release evidence pending |

No post-design exception or unresolved clarification remains. Pending gates are
implementation and evidence statuses, not design violations.

## Architecture and data ownership

The API owns security decisions; the domain package owns pure state transitions,
policy calculations, envelope metadata validation, redaction, and migration
checkpoint rules; database repositories own transactions and durable cursors;
the blob store owns encrypted chunks; the web client owns presentation and
encrypted local storage adapters. Feature-001 repositories remain the source of
canonical IDs and are called through security-aware guards/adapters.

Required implementation boundaries:

- `packages/domain/src/security/`: pure bootstrap, auth, recovery, rotation,
  migration, redaction, policy, and envelope rules.
- `packages/database/src/schema/security/` and
  `packages/database/src/repositories/security/`: security tables, singleton
  installation guard, epoch/generation state, checkpoints, audit, and
  transaction boundaries.
- `packages/blob-store/src/encryption/`: encrypted chunk envelope and
  content-addressed encrypted storage; plaintext source cleanup is owned by
  migration orchestration.
- `packages/contracts/src/security-api.ts` and
  `tests/contract/security-api.spec.ts`: generated/runtime request and response
  validation for the OpenAPI contract.
- `apps/api/src/security/`, `apps/api/src/routes/`, and the protected local CLI
  adapter: service orchestration, route guards, bootstrap exception, cookie
  policy, local administrator command dispatch, and safe state transitions. No
  hosting-administrator bearer scheme or admin-only remote route is part of the
  API contract. Owner API status/rotation operations remain session+CSRF
  protected; hosting-admin migration/recovery/rotation commands are local CLI
  only, and the local CLI never creates a browser/API session.
- `apps/web/src/features/security/` and `apps/web/src/services/security-api.ts`:
  accessible bootstrap, recovery, authentication, devices, rotation, and
  migration status experiences.
- `packages/client-core/src/security/` and `packages/client-core/src/local-store/`:
  device-bound local encryption without changing feature-001 local identities.

All security records carry `installation_id` and, where applicable,
`workspace_id`. Foreign keys or repository-level assertions must prove that
these match the one feature-001 workspace. Hosting-administrator recovery may
adopt source IDs only through the local CLI, only into an empty/uninitialized
target, and commits adoption and device-trust reset atomically.

## Bootstrap and recovery design

### Bootstrap-scoped provisional recovery

Bootstrap uses a signed/opaque `bootstrap_attempt_id` and a database lock or
serializable singleton transaction. It has no session cookie dependency. The
following table is canonical for every design artifact and contract:

| Attempt state | Scope and committed counts | Allowed transition / result |
| --- | --- | --- |
| `started` | Attempt only; no owner/workspace rows; `0/0`; installation `uninitialized` | Start one serialized attempt; credential challenge may run |
| `credential-verified` | Attempt-scoped verified credential material only; no owner/workspace rows; `0/0` | Valid credential verification; provisional records may be prepared |
| `recovery-prepared` | Attempt-scoped pending credential, kit, and download capability; no owner/workspace rows; `0/0` | Prepare one provisional kit and one 15-minute opportunity |
| `download-consumed` | Same attempt-scoped material; no owner/workspace rows; `0/0` | One successful download consumption; offline confirmation is still required |
| `confirmed` | Atomic promotion commits the sole owner credential and owner, binds the existing feature-001 workspace, activates/confirms the kit, sets installation `ready`, and changes counts to `1/1` | Only successful download consumption plus explicit offline confirmation |
| `abandoned` | Attempt-scoped records only; no owner/workspace rows; `0/0` | Expired/cancelled attempt that is not eligible for confirmation |
| `rejected` | Attempt-scoped rejected/expired material only; no owner/workspace rows; `0/0` | Invalid, expired, replayed, or otherwise refused attempt; regeneration remains attempt-scoped |

`uninitialized` is the installation state before `started`; every
pre-confirmation attempt state, including `credential-verified`,
`recovery-prepared`, `download-consumed`, `abandoned`, and `rejected`, remains
`0/0`. There is no combined recovery-confirmation state. Pending credential material is
stored only under the attempt and is promoted into the sole committed owner
credential inside the same serializable confirmation transaction; a crash
rolls back both promotion and owner/workspace creation.

The provisional artifact is generated only after credential verification. It has
`authorizationState=provisional`, then `deliveryState=prepared`,
`downloadable`, and `download-consumed`; one download token, one successful
stream, and a 15-minute absolute download window measured by the injected
clock. Download consumption is atomic with token invalidation. Lost or expired
unconfirmed material becomes `authorizationState=rejected` and
`deliveryState=expired` before it is regenerated; it cannot mark the
installation ready. `POST /v1/bootstrap/{attemptId}/recovery/regenerate`
accepts only the valid capability for the same credential-verified attempt,
only after `rejected/expired`, and creates a fresh provisional delivery without
reviving the old delivery or creating owner/workspace rows. A concurrent claim gets a safe conflict response. A
crashed attempt resumes from the persisted safe state or rolls back to
uninitialized; it never exposes a ready owner without confirmed recovery.

`POST /v1/bootstrap/{attemptId}/recovery/confirm` returns the explicit
`confirmed/ready/1/1` result: `bootstrapState=confirmed`,
`installationState=ready`, `ownerCount=1`, `workspaceCount=1`,
`authorizationState=active`, and `deliveryState=confirmed`.

The bootstrap endpoints are deliberately outside session authentication but
require the bootstrap attempt capability and loopback/trusted-origin policy.
They are defined in [security-api.openapi.yaml](contracts/security-api.openapi.yaml).

Installation status is state-dependent, not a free combination of fields:
`uninitialized` and `bootstrap-in-progress` require `ownerCount=0` and
`workspaceCount=0`; `ready`, `recovery-required`, `migration-in-progress`, and
`degraded` require `ownerCount=1` and `workspaceCount=1`. The API contract
encodes these branches with state/count constraints.

### Session-protected recovery and replacement

After readiness, kit replacement requires a recent-authenticated owner session
and CSRF token. Owner API status/rotation operations use the same session+CSRF
boundary; hosting-admin migration/recovery/rotation commands are local CLI
only.
The existing kit remains `authorizationState=active` and
`deliveryState=confirmed` while a replacement is prepared. The replacement
progresses through `provisional` plus its delivery states; only the confirmation
transaction atomically advances the recovery epoch, makes the replacement
`active/confirmed`, and marks the old kit `superseded/confirmed`. A prior epoch,
revoked kit, wrong lineage, or malformed artifact is rejected. Active confirmed
kits do not expire by age; `expired` applies only to an unconfirmed delivery.

Administrative import through the protected local CLI requires a valid
passphrase, source-lineage match,
encrypted source data, an empty/uninitialized target, and a transaction that
adopts source installation/owner/workspace/content/history/file/mutation IDs.
The target is marked active only after integrity and identity verification.
All previously authorized devices become `reauthorization-required`; no
device trust is inherited.

## Key separation and policy state

There are two independent policies and manifests:

- `WrappingKeyPolicy` tracks the external deployment wrapping-key version. A
  due or emergency operation unwraps and rewraps workspace root keys only. It
  does not rewrite records or chunks.
- `DataKeyPolicy` tracks the workspace data-key generation. A scheduled or
  emergency operation creates a new generation, uses it for new writes when
  allowed, and progressively rewrites record envelopes and file chunks with
  resumable cursors.

Each policy exposes exactly `pre-due`, `due`, `overdue-within-grace`, `emergency`, `write-block`,
`in-progress`, `complete`, or `failed` plus `due_at`, `last_completed_at`,
`current_generation`, `write_block_at`, and `next_action`. Startup and daily
checks persist an audit/status event. Reads of valid existing ciphertext remain
available in due/overdue-within-grace/emergency/write-block states. New protected writes are
refused at `write_block_at`: scheduled defaults to `due_at + 7 calendar days`;
emergency is `due_at` with zero grace. Owner-facing authenticated API operations
and the protected local CLI may start either operation; conflict rules allow at
most one operation per policy. There is no remote hosting-administrator API
alternative.

## Staged plaintext migration state machine

Migration state is durable and monotonic, with idempotent checkpoint cursors:

```text
prepare-destinations
  → capture-boundary
  → backfill
  → verify
  → stop-plaintext-writes
  → encrypted-read-cutover
  → scrub-plaintext
  → complete
```

`capture-boundary` is implemented as dual-write or an equivalent durable change
capture boundary. Each source record/blob retains its feature-001 ID. Every
checkpoint stores source cursor, destination cursor, counts, digest, and fault
boundary. Verification compares counts, deterministic digests, and all
canonical content/history/file/mutation IDs. Source SQL columns and blob files
remain until verification and cutover gates pass; cleanup is separately
resumable and only then drops/scrubs plaintext. Fault tests inject failures
before backfill, during backfill, after verification, after write stop, during
read cutover, and during cleanup. Recovery returns to the last safe state and
never reports `complete` early.

## Compose, local operation, and release design

The official `compose.yaml` will contain `api`, `web`, `postgres`, and durable
`file-store` storage, with health checks and startup dependencies. API and web
ports bind to `127.0.0.1`; production uses the `__Host-mn_session` Secure cookie behind the
administrator's HTTPS reverse proxy. `.env.example` documents trusted proxy,
public origin, request/body/file-size limits, database URL, image selection,
and mounted secret paths without secret values. `compose.override.yaml` is a
local-build override using loopback HTTP and the explicitly named development
cookie exception. `docs/deployment/reverse-proxy.md` will show nginx, Caddy,
and Traefik examples that set HTTPS/public-origin/trusted-proxy headers without
making a proxy part of the official stack.

Images are built by `docker/api.Dockerfile` and `docker/web.Dockerfile` for
`linux/amd64` and `linux/arm64`, with pinned base image digests and locked
dependencies. The existing `.github/workflows/ci.yml` is updated in place as
the single quality-gate workflow. It exposes `workflow_call`, triggers directly
on every `pull_request`, directly on pushes to branches other than `main`, and
directly through `workflow_dispatch` for diagnostics (with no direct `main` or
version-tag push trigger). A manual diagnostic invocation runs the quality gate
only and has no publication job or publication permission. Direct and reusable
invocations execute the same aggregate `quality-gate` job; there is one logical
gate and no duplicate gate.

`.github/workflows/release.yml` triggers directly on pushes to `main` and on
version-tag candidates. The tag eligibility guard must accept only the strict
pattern `^v[0-9]+\.[0-9]+\.[0-9]+$`. Its first job is the reusable-workflow job
`quality-gate`, using `./.github/workflows/ci.yml`; the local call therefore
uses the caller commit. The reusable workflow exports `candidate_sha` equal to
the called workflow's `github.sha`, which is the caller SHA, and release
verifies `candidate_sha == github.sha` in its own run. Every publication job
depends on that first job and is eligible only when the gate result is
successful and the SHA check passes. Missing, skipped, cancelled, failed,
stale, or different-SHA gate evidence blocks every publication job. Main
produces a commit-SHA tag; version tags produce `vMAJOR.MINOR.PATCH` images.
Both produce checksums, an SBOM, provenance/attestation equivalent, and release
artifacts. Thus `main` and version tags execute CI once through `release.yml`,
without a second CI execution or an indirect workflow trigger; pull requests
and non-main branch pushes execute `ci.yml` directly. The required branch/PR
check context is the single `ci.yml / quality-gate` check. Workflow permissions are
minimal: contents read, packages write only in publication, attestations write
only in attestation steps, and id-token write only when provenance requires it.

The aggregate gate has separately evidenced blocking jobs. The implementation
must use pinned full-commit SHAs for third-party actions; the planned commands
and policies are:

| Gate job | Planned command/action | Blocking policy | Required artifact |
| --- | --- | --- | --- |
| `dependency-vulnerability-audit` | `pnpm audit --audit-level=high --prod` | Any high/critical vulnerability, command failure, or unavailable audit blocks | `dependency-audit.json` |
| `secret-scan` | `pnpm security:secrets` (or a full-SHA-pinned scanner action) | Any detected secret or scanner failure blocks | `secret-scan.sarif` |
| `static-security-analysis` | `pnpm security:static` (or full-SHA-pinned CodeQL/Semgrep action) | Any high-confidence security finding or analyzer failure blocks | `static-security.sarif` |
| `container-vulnerability-scan` | `trivy image --severity HIGH,CRITICAL --exit-code 1` after image build and before publication | Any high/critical image finding or scan failure blocks; never runs after publication | `container-scan.sarif` |
| `license-policy` | `pnpm security:licenses` | Any denied license, missing attribution, or policy-check failure blocks | `license-policy.json` |

Each job emits its result for the exact candidate SHA. The aggregate
`quality-gate` uses `always()` and fails when any required job is failed,
missing, skipped, cancelled, stale, or lacks its declared artifact. Manual
`workflow_dispatch` diagnostics may collect these artifacts but have no
publication path or package-write permission. Release publication cannot start
unless all five security jobs and the remaining quality jobs are successful.

Rollback evidence records current and prior immutable image refs/digests,
pre/post persisted-data digests, Compose image selection, pre/post health,
rollback result, candidate SHA, raw artifact, reviewer, and date. This is
image-selection validation for a compatible prior image, not full update
orchestration. The plan does not claim these services, Dockerfiles, workflows,
or evidence exist yet; their creation is implementation work in `tasks.md`.

## Verification matrix

The canonical evidence fields, column names, run metadata, and status
vocabulary are in [validation.md](validation.md). That ledger has one row for
every FR-001 through FR-035 and one row for every SC-001 through SC-010; no
grouped requirement row or five-row rotation matrix is authoritative. Its seven
canonical column names — `Requirement/criterion`, `Command or test path`,
`Candidate SHA`, `Controlled clock/configuration`, `Raw evidence/artifact`,
`Reviewer/date`, `Status` — override any other naming, and its run-metadata
block must be complete before any row leaves `pending`. The FR rows use the
following one-to-one paths:

| Requirement | Planned verification path |
| --- | --- |
| FR-001 | `packages/database/tests/security-owner.integration.spec.ts` |
| FR-002 | `apps/api/tests/bootstrap.contract.spec.ts` and `packages/database/tests/bootstrap-concurrency.integration.spec.ts` |
| FR-003 | `apps/api/tests/authentication.contract.spec.ts` |
| FR-004 | `apps/api/tests/authentication.contract.spec.ts` |
| FR-005 | `apps/api/tests/authentication.contract.spec.ts` and `tests/e2e/authentication.spec.ts` |
| FR-006 | `packages/database/tests/session.integration.spec.ts` |
| FR-007 | `apps/api/tests/session-revocation.integration.spec.ts` |
| FR-008 | `apps/api/tests/devices.contract.spec.ts` |
| FR-009 | `packages/database/tests/device-management.integration.spec.ts` |
| FR-010 | `tests/e2e/devices.spec.ts` |
| FR-011 | `packages/database/tests/security-crypto.integration.spec.ts` |
| FR-012 | `packages/client-core/tests/local-encryption.integration.spec.ts` |
| FR-013 | `tests/contract/compose-security.spec.ts` |
| FR-014 | `packages/domain/tests/encryption.property.spec.ts` |
| FR-015 | `packages/database/tests/recovery-kit.integration.spec.ts` |
| FR-016 | `apps/api/tests/bootstrap-fault-injection.integration.spec.ts` |
| FR-017 | `packages/database/tests/key-rotation.integration.spec.ts` |
| FR-018 | `packages/domain/tests/recovery-artifact.property.spec.ts` |
| FR-019 | `packages/database/tests/administrative-recovery.integration.spec.ts` |
| FR-020 | `tests/contract/admin-cli.contract.spec.ts` |
| FR-021 | `tests/contract/admin-cli.contract.spec.ts` |
| FR-022 | `packages/database/tests/security-audit.integration.spec.ts` |
| FR-023 | `packages/domain/tests/redaction.property.spec.ts` |
| FR-024 | `packages/domain/tests/security-canonical-identities.property.spec.ts` |
| FR-025 | `packages/domain/tests/rotation-policy.clock.spec.ts` |
| FR-026 | `apps/api/tests/key-rotation-policy.integration.spec.ts` |
| FR-027 | `apps/api/tests/key-rotation-write-block.integration.spec.ts` |
| FR-028 | `packages/database/tests/security-migration.integration.spec.ts` |
| FR-029 | `apps/api/tests/security-migration-fault-injection.integration.spec.ts` |
| FR-030 | `tests/contract/compose-security.spec.ts` |
| FR-031 | `tests/contract/compose-security.spec.ts` |
| FR-032 | `tests/contract/release-artifacts.spec.ts` |
| FR-033 | `tests/contract/release-gates.spec.ts` |
| FR-034 | `tests/contract/release-gates.spec.ts` |
| FR-035 | `tests/contract/security-api.spec.ts` |
| SC-001 | `packages/database/tests/bootstrap-concurrency.integration.spec.ts`, `apps/api/tests/bootstrap-fault-injection.integration.spec.ts`, `tests/e2e/bootstrap.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-002 | `specs/002-owner-security-foundation/validation.md` |
| SC-003 | `apps/api/tests/authentication.contract.spec.ts`, `packages/database/tests/session.integration.spec.ts`, `apps/api/tests/session-revocation.integration.spec.ts`, `apps/api/tests/devices.contract.spec.ts`, `tests/e2e/authentication.spec.ts`, `tests/e2e/devices.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-004 | `apps/api/tests/encryption-read-faults.integration.spec.ts`, `packages/database/tests/encryption-fault-injection.integration.spec.ts`, `packages/database/tests/security-migration.integration.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-005 | `packages/database/tests/recovery-kit.integration.spec.ts`, `packages/database/tests/administrative-recovery.integration.spec.ts`, `apps/api/tests/administrative-recovery-fault-injection.integration.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-006 | `packages/domain/tests/wrapping-key-rotation.property.spec.ts`, `packages/domain/tests/data-key-rotation.property.spec.ts`, `packages/database/tests/key-rotation.integration.spec.ts`, `apps/api/tests/key-rotation-fault-injection.integration.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-007 | `tests/contract/compose-security.spec.ts`, `tests/contract/release-gates.spec.ts`, `tests/contract/release-artifacts.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-008 | `tests/e2e/bootstrap.spec.ts`, `tests/e2e/authentication.spec.ts`, `tests/e2e/devices.spec.ts`, `tests/e2e/security-rotation.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-009 | `packages/domain/tests/rotation-policy.clock.spec.ts`, `specs/002-owner-security-foundation/validation.md` |
| SC-010 | `packages/domain/tests/migration-state.property.spec.ts`, `packages/database/tests/security-migration.integration.spec.ts`, `apps/api/tests/security-migration-fault-injection.integration.spec.ts`, `specs/002-owner-security-foundation/validation.md` |

### Dedicated verification paths and why they exist

Three rows above name test surfaces that were deliberately kept rather than
repointed onto an existing test, because each covers behavior the other
scheduled tests do not reach. Each is now scheduled by its own task, in the
phase that owns the behavior, and the ledger row for that requirement cannot
leave `pending` until that test runs:

| Requirement | Dedicated file | Scheduled by | Why an existing test does not cover it |
| --- | --- | --- | --- |
| FR-022 | `packages/database/tests/security-audit.integration.spec.ts` | T012 (foundational) | Audit was otherwise only written, never asserted. Nothing else reads back the allowlisted event set, both recovery state-axis transitions, or redaction of persisted audit rows. Its repository is implemented in the same phase by T020. |
| FR-026 | `apps/api/tests/key-rotation-policy.integration.spec.ts` | T075 (US5) | `packages/domain/tests/rotation-policy.clock.spec.ts` covers pure state calculation only. Startup evaluation, the at-least-daily automatic check, status/startup warnings, and explicit triggers are API-level behavior. |
| FR-027 | `apps/api/tests/key-rotation-write-block.integration.spec.ts` | T076 (US5) | The domain clock test cannot prove that a protected write is actually refused inside a transaction at `write_block_at` while reads and resumable progress stay available. |

Two further rows were repointed instead, because a scheduled test already owns
the behavior and a second file would duplicate it: FR-004/FR-005 now resolve to
`apps/api/tests/authentication.contract.spec.ts`, which already contracts the
credential-management endpoints, and FR-018 now resolves to
`packages/domain/tests/recovery-artifact.property.spec.ts`.

## Phase plan and dependency order

The task list uses the following order. Each phase has a contract/test slice so
content encryption, devices, recovery/rotation, migration, and delivery remain
independently testable increments after their prerequisites.

1. **Setup**: package boundaries, pinned toolchain, test clocks/fixtures,
   Compose skeleton, Dockerfile/release metadata scaffolding.
2. **Foundational**: shared crypto/envelope, redaction, audit, singleton
   installation guard, external secret reader, security schema/repositories,
   migration/rotation primitives, contract validators, and `validation.md`.
3. **US1 Bootstrap**: provisional recovery flow with no session dependency,
   passkey bootstrap verification, recovery readiness, owner/workspace binding,
   and one-time 15-minute download consumption.
4. **Authentication/session-protected operations**: passkey enrollment
   completion, password alternative, secure cookie/CSRF/session policy, recent
   auth, revocation, and protected route guards.
5. **Content encryption**: server/local envelopes, encrypted file chunks,
   safe reads, generation-aware writes, and feature-001 integration without ID
   changes. This increment is independently testable after foundational/auth.
6. **Devices**: inventory, limits, revocation, reauthorization, and local key
   binding. Independently testable against authenticated fixtures.
7. **Recovery and rotation**: authenticated kit replacement/download/confirm,
   recovery import, wrapping-key rewrap, data-key progressive rotation, policy
   states, owner API or protected local CLI triggers, and atomic supersession.
8. **Migration**: staged plaintext migration, capture boundary, verification,
   encrypted-read cutover, scrub/drop, and all fault checkpoints.
9. **Delivery and release**: complete Compose, reverse-proxy docs, pinned
   multi-platform images, GHCR publication, SHA/version tags, checksums,
   SBOM/provenance, exact-commit gate topology, and release evidence.
10. **Convergence**: run analysis and close all remaining task/evidence gaps;
    do not edit feature-001 artifacts.

Within each phase: contracts and state-machine tests precede implementation;
domain rules precede repositories/services; services precede routes/CLI; API
contracts precede web journeys. The phase is not complete until its checkpoint
and `validation.md` entry are updated.

## Risks and mitigations

- **Bootstrap/session deadlock**: keep bootstrap capability endpoints and
  provisional recovery state separate from session middleware.
- **Key-axis coupling**: distinct manifests and repositories; rotation tests
  assert wrapping rewrap does not alter record ciphertext and data-key rotation
  does not require a wrapping-key event.
- **Premature plaintext deletion**: source-retention gate and fault-injection
  tests at each migration state.
- **Identity drift**: feature-001 IDs are copied/referenced and compared in
  recovery tests; no new canonical identity factory is allowed in security
  services.
- **Cookie insecurity in local development**: an explicit, fail-closed
  loopback predicate controls issuance/acceptance of the separate
  `mn_dev_session` cookie; non-loopback HTTP is rejected and production keeps
  `__Host-mn_session` Secure.
- **False release success**: the aggregate `quality-gate` in `ci.yml` uses
  `always()` and fails any non-success dependency; `release.yml` verifies the
  exact SHA and refuses stale or absent evidence without adding a duplicate
  required gate.

## Implementation handoff

No implementation code is changed by this planning update, and `tasks.md` is
not edited by it. This pass corrected four design defects found by
cross-artifact analysis: the malformed functional-requirement ledger separator,
the missing canonical column vocabulary and run-metadata block in
[validation.md](validation.md), the prose success-criterion rows that now carry
exact paths, and the malformed bootstrap table in
[admin-cli.md](contracts/admin-cli.md).

`tasks.md` has since been regenerated against this plan and now agrees with it:
each dedicated verification path above is scheduled by its own task in the
phase that owns the behavior, every verification path named in this plan and in
[validation.md](validation.md) resolves to a scheduled task, and the ledger
tasks describe the evidence rows using only the seven canonical column names
and the run-metadata block defined in [validation.md](validation.md). No
outstanding reconciliation between this plan and the task list remains.

Implement only on `codex/spec-update` in the dependency order above.
Record all measured results in [validation.md](validation.md); an empty or
pending ledger is not evidence of completion.
