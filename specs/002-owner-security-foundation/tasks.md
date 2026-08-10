# Tasks: Owner Security Foundation

**Input**: Design documents from `specs/002-owner-security-foundation/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, and the contracts under `specs/002-owner-security-foundation/contracts/`.

**Scope guard**: This task list adds the security boundary around feature-001. It MUST preserve the canonical workspace, item, placement, relationship, file, revision, mutation, and browser-projection identities defined by `specs/001-content-foundations/`; it MUST NOT introduce a second owner, account, role, or workspace.

**Test policy**: Tests are mandatory for this feature. Unit, property, integration, contract, migration/fault-injection, Compose/security, and Playwright coverage below are acceptance work, not optional follow-up.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare the existing pnpm TypeScript monorepo and test harness for the security feature without introducing a new service or toolchain.

- [ ] T001 Update the exact WebAuthn dependency versions and security test scripts in `apps/api/package.json`, `apps/web/package.json`, `package.json`, and `pnpm-lock.yaml`, using `@simplewebauthn/server` 13.3.2 and `@simplewebauthn/browser` 13.3.0.
- [ ] T002 [P] Add security source and test project entries to the existing exports and workspace configuration in `packages/domain/src/index.ts`, `packages/contracts/src/index.ts`, `packages/database/src/index.ts`, `packages/client-core/src/index.ts`, `packages/blob-store/src/index.ts`, `vitest.workspace.ts`, and `tsconfig.json`.
- [ ] T003 [P] Add feature fixture, contract, integration, property, and Playwright test path conventions to `tests/fixtures/security.ts`, `tests/contract/security-api.contract.spec.ts`, `tests/e2e/global-setup.ts`, `vitest.workspace.ts`, and `playwright.config.ts` without changing the existing feature-001 projects.
- [ ] T004 [P] Extend the safe development environment contract for the external deployment secret, loopback-only fallback, API host, and secret-file fixture in `.env.example`, `.gitignore`, `compose.yaml`, and `compose.override.yaml`.
- [ ] T005 [P] Add the official API/web Compose services, health dependencies, local HTTP bindings, and secret-file mounts required by the plan in `compose.yaml` and `compose.override.yaml`, keeping all published ports explicitly bound to `127.0.0.1`.
- [ ] T006 [P] Add security-specific repository commands and aggregate quality-gate wiring in `package.json`, `.github/workflows/ci.yml`, and `scripts/ci/check-toolchain.ts` for unit, property, integration, contract, e2e, migration, Compose, and security checks.
- [ ] T007 [P] Record the feature's dependency on feature-001 and its product-canvas scope without copying feature requirements into agent files in `specs/002-owner-security-foundation/tasks.md` and `specs/002-owner-security-foundation/validation.md`.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared contracts, configuration, persistence boundaries, redaction, and test fixtures. No user-story implementation may begin until this phase is complete.

- [ ] T008 Define shared security request, response, problem, session, device, recovery, rotation, and audit DTO schemas in `packages/contracts/src/security-api.ts` to match `specs/002-owner-security-foundation/contracts/security-api.openapi.yaml`.
- [ ] T009 [P] Define versioned encrypted-envelope, recovery-kit, and rotation-manifest runtime schemas in `packages/contracts/src/security-artifacts.ts` to match `specs/002-owner-security-foundation/contracts/security-artifacts.schema.json`.
- [ ] T010 [P] Define platform-independent security entity types, lifecycle states, safe error codes, and single-owner invariants in `packages/domain/src/security/types.ts`, `packages/domain/src/security/errors.ts`, and `packages/domain/src/security/invariants.ts` from `specs/002-owner-security-foundation/data-model.md`.
- [ ] T011 [P] Add property tests for singleton ownership, session/device/key/recovery revocation, safe state transitions, and canonical identity preservation in `packages/domain/tests/security-invariants.property.spec.ts` and `packages/domain/tests/security-canonical-identities.property.spec.ts`.
- [ ] T012 Implement deployment-key loading, secret-file permissions, explicit loopback development fallback, configuration validation, and safe failure codes in `apps/api/src/security/deployment-key.ts` and `apps/api/src/security/security-config.ts`.
- [ ] T013 [P] Implement recursive forbidden-field detection and redacted problem, audit, command, and logger serialization in `packages/domain/src/security/redaction.ts` and `apps/api/src/plugins/errors.ts`.
- [ ] T014 [P] Add unit and property coverage proving that passwords, passkeys, cookies, CSRF tokens, recovery passphrases/kits, encryption keys, private content, and integration tokens cannot cross the redaction boundary in `packages/domain/tests/redaction.property.spec.ts` and `apps/api/tests/redaction.spec.ts`.
- [ ] T015 Add the shared security request context, correlation ID handling, and authentication hook interfaces in `apps/api/src/context.ts`, `apps/api/src/security/request-context.ts`, and `apps/api/src/security/authentication-hook.ts`.
- [ ] T016 Create the reviewed forward migration for installation security, bootstrap attempts, owner credentials, sessions, devices, key generations, recovery kits, rotations, audit events, rate limits, and encrypted feature-001 payload columns in `packages/database/migrations/0003_owner_security_foundation.sql` and `packages/database/src/schema/security/index.ts`.
- [ ] T017 Register the security tables and encrypted payload columns alongside—not instead of—the feature-001 schema in `packages/database/src/schema/index.ts`, preserving every existing primary key, foreign key, workspace singleton, revision edge, mutation ID, logical file ID, and browser projection ID.
- [ ] T018 [P] Add migration integration coverage from an empty database and from a feature-001 fixture, including rollback/failure assertions and exact identity snapshots, in `packages/database/tests/migrations.integration.spec.ts` and `packages/database/tests/security-migration.integration.spec.ts`.
- [ ] T019 [P] Build reusable disposable installation, deployment-key, feature-001 canonical-content, WebAuthn virtual-authenticator, and clock-control fixtures in `tests/fixtures/security.ts`, `packages/database/tests/helpers/security-db.ts`, and `tests/e2e/helpers.ts`.
- [ ] T020 Add shared security repository interfaces and transaction helpers for atomic state changes, idempotent retries, row locking, and fail-closed reads in `packages/database/src/repositories/security/repository-types.ts`, `packages/database/src/repositories/security/transaction.ts`, and `packages/database/src/index.ts`.
- [ ] T021 [P] Add the OpenAPI, JSON Schema, and shared-runtime-schema validation harness for this feature in `tests/contract/security-api.contract.spec.ts`, `tests/contract/security-artifacts.contract.spec.ts`, and `packages/contracts/tests/security-schema.spec.ts`.
- [ ] T022 [P] Add baseline security assertions for cookie, CSRF, redacted problem, HTTP method, and canonical feature-001 route protection requirements in `tests/contract/security-api.contract.spec.ts` and `tests/contract/openapi.spec.ts`.
- [ ] T023 Implement the shared private-route authorization adapter and safe readiness gate interfaces used by all existing content routes in `apps/api/src/security/private-route-guard.ts`, `apps/api/src/plugins/security.ts`, and `apps/api/src/app.ts`.
- [ ] T024 [P] Add the foundational security test command documentation and expected failure semantics to `specs/002-owner-security-foundation/quickstart.md` and `specs/002-owner-security-foundation/contracts/admin-cli.md` only where implementation behavior requires clarification.

## Phase 3: User Story 4 - Protect Data and Maintain Recovery Material (Priority: P1)

**Goal**: Encrypt server and browser-local protected data with authenticated, versioned envelopes, keep deployment key material external, and provide an exportable encrypted recovery kit whose readiness is explicit.

**Independent Test**: Seed representative feature-001 content and local pending work, inspect PostgreSQL/blob/IndexedDB persistence for absence of usable plaintext, fail reads with missing/wrong/corrupt key material, export and validate a recovery kit, and restore access with a valid kit without changing canonical identities.

### Tests for User Story 4

- [ ] T025 [P] [US4] Add contract tests for recovery-kit listing, one-time creation, offline confirmation, rotation views, redacted audit responses, envelope formats, and safe problem responses in `tests/contract/security-recovery.contract.spec.ts` and `tests/contract/security-artifacts.contract.spec.ts`.
- [ ] T026 [P] [US4] Add unit and property tests for AES-256-GCM envelopes, HKDF domain separation, random nonce/salt requirements, AAD binding, key-generation authorization, tamper detection, and chunked 4 MiB blob manifests in `packages/domain/tests/security-envelope.property.spec.ts` and `packages/domain/tests/encrypted-blob-manifest.spec.ts`.
- [ ] T027 [P] [US4] Add unit and property tests for external-key wrapping, asynchronous scrypt password/recovery derivation, recovery-kit format/version/installation binding, passphrase handling, epoch revocation, and historical-generation compatibility in `packages/domain/tests/recovery-kit.property.spec.ts` and `packages/domain/tests/key-wrapping.spec.ts`.
- [ ] T028 [P] [US4] Add PostgreSQL/Testcontainers integration tests proving that page names/documents, relationship metadata, revision snapshots, file metadata/bytes, and search payloads are encrypted while allowed routing metadata and feature-001 identities remain stable in `packages/database/tests/encrypted-content.integration.spec.ts`.
- [ ] T029 [P] [US4] Add migration and fault-injection tests for missing, malformed, wrong, revoked, and unauthorized deployment keys plus flipped ciphertext, tag, AAD, format, and generation values in `packages/database/tests/encryption-fault-injection.integration.spec.ts` and `apps/api/tests/encryption-read-faults.integration.spec.ts`.
- [ ] T030 [P] [US4] Add unit and IndexedDB integration tests for non-exportable local AES-GCM keys, encrypted items/files/indexes/outbox/conflict payloads, locked-key behavior, storage limits, and preservation of ciphertext and pending work during reauthorization in `packages/client-core/tests/local-encryption.spec.ts` and `packages/client-core/tests/local-encryption.integration.spec.ts`.
- [ ] T031 [P] [US4] Add Playwright coverage for responsive recovery readiness, kit export/format metadata, offline-local encryption state, protected-storage failure, and honest recovery/error messaging in `tests/e2e/security-recovery.spec.ts` across the configured desktop and mobile projects.

### Implementation for User Story 4

- [ ] T032 [P] [US4] Implement versioned AES-256-GCM envelopes, HKDF-derived record keys, external deployment-key wrapping, authenticated chunk manifests, and key-generation authorization in `packages/domain/src/security/crypto.ts`, `packages/domain/src/security/envelopes.ts`, `packages/domain/src/security/key-generations.ts`, and `packages/domain/src/security/blob-manifests.ts`.
- [ ] T033 [P] [US4] Implement the encrypted blob-store adapter and preserve content-addressed logical file identity, digest lineage, and immutable blob semantics in `packages/blob-store/src/encrypted-blob-store.ts`, `packages/blob-store/src/content-store.ts`, and `packages/blob-store/src/index.ts`.
- [ ] T034 Implement security repositories for installation state, key generations, protected record envelopes, and redacted integrity failures in `packages/database/src/repositories/security/installation-security-repository.ts`, `packages/database/src/repositories/security/key-generation-repository.ts`, `packages/database/src/repositories/security/protected-record-repository.ts`, and `packages/database/src/repositories/security/integrity-repository.ts`.
- [ ] T035 [US4] Migrate feature-001 content persistence and export handling to encrypt payload-bearing fields while retaining only approved routing metadata and every canonical identity in `packages/database/src/repositories/item-reader.ts`, `packages/database/src/repositories/revision-repository.ts`, `packages/database/src/repositories/relationship-repository.ts`, `packages/database/src/repositories/file-repository.ts`, `apps/api/src/routes/export.ts`, and `apps/api/src/routes/snapshots.ts`.
- [ ] T036 [US4] Implement browser-local key state, encrypted Dexie payload serialization, durable local-key failure states, and schema versioning without deleting existing feature-001 projection, cursor, mutation, or conflict identities in `packages/client-core/src/security/local-encryption.ts`, `packages/client-core/src/security/local-key-state.ts`, `packages/client-core/src/local-store/schema.ts`, and `packages/client-core/src/local-store/local-repository.ts`.
- [ ] T037 [US4] Implement encrypted recovery-kit creation, one-time artifact delivery, header inspection, offline confirmation, epoch tracking, and kit metadata persistence in `apps/api/src/security/recovery-kit-service.ts`, `packages/database/src/repositories/security/recovery-kit-repository.ts`, and `apps/api/src/routes/security-recovery.ts`.
- [ ] T038 [US4] Add recovery-kit DTOs, download handling, readiness state, and fail-closed error mapping to `packages/contracts/src/security-api.ts`, `apps/api/src/routes/security-recovery.ts`, `apps/api/src/plugins/errors.ts`, and `apps/api/src/app.ts`.
- [ ] T039 [US4] Implement responsive security/recovery settings, kit export confirmation, format/install binding display, and protected-storage failure states in `apps/web/src/features/security/recovery-kit-panel.tsx`, `apps/web/src/features/security/security-settings.tsx`, `apps/web/src/services/security-api.ts`, `apps/web/src/app.tsx`, and `apps/web/src/styles.css`.
- [ ] T040 [US4] Wire external deployment-key loading, encrypted content stores, browser security state, and fail-closed readiness into the API and web application composition in `apps/api/src/app.ts`, `apps/api/src/context.ts`, `apps/web/src/services/local-content.ts`, and `apps/web/src/services/storage-manager.ts`.
- [ ] T041 [US4] Add server and client security audit events for encryption failures, recovery-kit creation/replacement/confirmation, local-key loss, and readiness changes using the allowlisted event model in `packages/database/src/repositories/security/audit-repository.ts`, `apps/api/src/security/audit-service.ts`, and `packages/domain/src/security/audit.ts`.
- [ ] T042 [US4] Verify representative encrypted persistence, recovery-kit export separation, missing-key failure, tamper failure, and feature-001 identity preservation against the complete scenarios in `specs/002-owner-security-foundation/quickstart.md` and record results in `specs/002-owner-security-foundation/validation.md`.

**Checkpoint**: All protected server/local payloads fail closed, a valid encrypted recovery kit can be exported and confirmed, and no feature-001 canonical identity changes.

## Phase 4: User Story 1 - Establish the Sole Owner Securely (Priority: P1)

**Goal**: Complete a single transactional first-run claim with a passkey, optional password, initial protected state, and confirmed recovery readiness; reject concurrent, repeated, interrupted, or invalid-key claims.

**Independent Test**: Start from an empty migrated database with a valid external key, complete virtual-passkey bootstrap and recovery confirmation, verify one owner/one device/ready state, then repeat and race the claim and test expiry/invalid-key paths.

### Tests for User Story 1

- [ ] T043 [P] [US1] Add contract tests for `getInstallationSecurityStatus`, `startBootstrap`, `getBootstrapPasskeyOptions`, `completeBootstrapPasskey`, and `completeBootstrap` in `tests/contract/bootstrap.contract.spec.ts` against `specs/002-owner-security-foundation/contracts/security-api.openapi.yaml`.
- [ ] T044 [P] [US1] Add domain property tests for bootstrap state transitions, one-open-attempt invariant, 15-minute expiry, one-time challenge consumption, and atomic readiness prerequisites in `packages/domain/tests/bootstrap-state.property.spec.ts`.
- [ ] T045 [P] [US1] Add database concurrency and singleton integration tests for competing bootstrap starts/completions, repeated claims, interrupted completion, owner/workspace uniqueness, and preserved feature-001 workspace identity in `packages/database/tests/bootstrap-concurrency.integration.spec.ts`.
- [ ] T046 [P] [US1] Add fault-injection coverage at bootstrap start, passkey verification, recovery-kit creation, readiness commit, transaction retry, and deployment-key validation boundaries in `apps/api/tests/bootstrap-fault-injection.integration.spec.ts`.
- [ ] T047 [P] [US1] Add the fresh-install, interrupted-bootstrap, concurrent-claim, invalid-key, and responsive accessibility journey in `tests/e2e/bootstrap.spec.ts`, using Playwright virtual WebAuthn authenticators across desktop and mobile projects.

### Implementation for User Story 1

- [ ] T048 [US1] Implement singleton bootstrap state transitions, attempt expiry, one-time challenge storage, coarse rate limiting, and atomic owner/workspace readiness operations in `packages/domain/src/security/bootstrap.ts`, `packages/database/src/repositories/security/bootstrap-repository.ts`, and `packages/database/src/repositories/security/installation-security-repository.ts`.
- [ ] T049 [US1] Implement discoverable WebAuthn registration with exact origin/RP ID/challenge/user-handle checks, required user verification, `attestation: none`, and sign-count persistence in `apps/api/src/security/webauthn-service.ts`, `apps/api/src/security/bootstrap-service.ts`, and `packages/database/src/repositories/security/passkey-repository.ts`.
- [ ] T050 [US1] Implement transactional bootstrap completion that creates exactly one owner, first passkey, optional password credential, authorized initial device, initial key generation, recovery metadata, and ready workspace linkage in `apps/api/src/security/bootstrap-service.ts`, `packages/database/src/repositories/security/owner-repository.ts`, and `packages/database/src/repositories/security/device-repository.ts`.
- [ ] T051 [US1] Implement installation-status and bootstrap endpoints with safe uninitialized/bootstrapping/ready/recovery-required responses and no owner or key disclosure in `apps/api/src/routes/bootstrap.ts`, `apps/api/src/routes/installation.ts`, `apps/api/src/app.ts`, and `packages/contracts/src/security-api.ts`.
- [ ] T052 [US1] Implement the first-run bootstrap UI, passkey ceremony, optional password setup, recovery-kit handoff, readiness confirmation, expiry/resume messaging, and accessible keyboard/focus states in `apps/web/src/features/auth/bootstrap-page.tsx`, `apps/web/src/features/auth/passkey-client.ts`, `apps/web/src/features/security/recovery-kit-panel.tsx`, `apps/web/src/services/security-api.ts`, and `apps/web/src/app.tsx`.
- [ ] T053 [US1] Add redacted bootstrap success/failure/rate-limit audit events and ensure interrupted attempts never authorize feature-001 private routes in `apps/api/src/security/audit-service.ts`, `apps/api/src/security/private-route-guard.ts`, `apps/api/src/routes/bootstrap.ts`, and `apps/api/src/plugins/logging.ts`.
- [ ] T054 [US1] Validate the complete bootstrap quickstart including status, virtual passkey, recovery confirmation, repeat/race, interruption/expiry, and missing/malformed/unauthorized deployment-key cases in `specs/002-owner-security-foundation/quickstart.md` and `specs/002-owner-security-foundation/validation.md`.

**Checkpoint**: A fresh installation has exactly one owner and workspace, cannot be claimed twice, and becomes usable only after authentication and recovery readiness are committed together.

## Phase 5: User Story 2 - Authenticate and Control Sessions (Priority: P1)

**Goal**: Support passkey-only and password-alternative login with hashed opaque sessions, CSRF protection, inactivity/recent-authentication policy, rate limits, and immediate one/all-session revocation.

**Independent Test**: Authenticate with passkey alone and password, compare invalid-attempt responses, advance the clock through inactivity/recent-authentication limits, then revoke one and all sessions and verify access and renewal stop.

### Tests for User Story 2

- [ ] T055 [P] [US2] Add contract tests for passkey options/completion, password authentication/change, passkey list/enrollment/revocation, current session, session list/revocation, and revoke-all operations in `tests/contract/auth-sessions.contract.spec.ts`.
- [ ] T056 [P] [US2] Add unit and property tests for NFC password normalization, scrypt parameter bounds, opaque-token digesting, cookie attributes, session expiry, recent-authentication gates, CSRF synchronizer tokens, origin checks, and rate-limit buckets in `packages/domain/tests/authentication.property.spec.ts`, `packages/domain/tests/session.property.spec.ts`, and `packages/domain/tests/csrf.property.spec.ts`.
- [ ] T057 [P] [US2] Add API/database integration tests for passkey/password authentication, uniform unknown-credential errors, configured 1/90-day bounds, 30-day default inactivity, 15-minute sensitive-operation gates, CSRF rejection, and one/all-session revocation in `apps/api/tests/authentication.integration.spec.ts` and `packages/database/tests/session-revocation.integration.spec.ts`.
- [ ] T058 [P] [US2] Add fault-injection and log-capture tests for failed WebAuthn/password attempts, rate-limit threshold behavior, sign-counter errors, token-digest lookup failures, and session revocation races in `apps/api/tests/authentication-fault-injection.integration.spec.ts` and `apps/api/tests/logging.spec.ts`.
- [ ] T059 [P] [US2] Add Playwright passkey-only, password-alternative, session settings, recent-authentication prompt, CSRF-safe mutation, inactivity-expiry, and one/all-session revocation journeys in `tests/e2e/authentication.spec.ts` across configured desktop/mobile browser projects.

### Implementation for User Story 2

- [ ] T060 [US2] Implement versioned asynchronous scrypt password credentials with NFC normalization, bounded derivation concurrency, timing-safe comparison, and disabled/changed credential states in `packages/domain/src/security/passwords.ts`, `apps/api/src/security/password-service.ts`, and `packages/database/src/repositories/security/password-repository.ts`.
- [ ] T061 [US2] Implement opaque 32-byte session tokens, SHA-256 token/CSRF digests, inactivity expiry, recent-authentication tracking, device binding, revocation, and no-renewal behavior in `packages/domain/src/security/sessions.ts`, `apps/api/src/security/session-service.ts`, and `packages/database/src/repositories/security/session-repository.ts`.
- [ ] T062 [US2] Implement WebAuthn authentication and recent-authenticated passkey enrollment/revocation using `@simplewebauthn/server` in `apps/api/src/security/webauthn-service.ts`, `apps/api/src/security/authentication-service.ts`, and `packages/database/src/repositories/security/passkey-repository.ts`.
- [ ] T063 [US2] Implement cookie, CSRF, Origin/Referer, unsafe-method, session/device-state, and private-route enforcement in `apps/api/src/security/session-cookie.ts`, `apps/api/src/security/csrf.ts`, `apps/api/src/security/private-route-guard.ts`, `apps/api/src/plugins/security.ts`, and `apps/api/src/app.ts`.
- [ ] T064 [US2] Implement authentication/session endpoints matching all operation IDs in the contract in `apps/api/src/routes/authentication.ts`, `apps/api/src/routes/sessions.ts`, `apps/api/src/routes/passkeys.ts`, `apps/api/src/app.ts`, and `packages/contracts/src/security-api.ts`.
- [ ] T065 [US2] Protect all feature-001 content, mutation, sync, export, snapshot, and file routes with the shared session/device guard while preserving their request/response contracts in `apps/api/src/routes/items.ts`, `apps/api/src/routes/page-documents.ts`, `apps/api/src/routes/files.ts`, `apps/api/src/routes/relationships.ts`, `apps/api/src/routes/revisions.ts`, `apps/api/src/routes/mutation-batch.ts`, `apps/api/src/routes/changes.ts`, `apps/api/src/routes/export.ts`, and `apps/api/src/routes/snapshots.ts`.
- [ ] T066 [US2] Implement responsive authentication, passkey management, password alternative, session inventory, revocation controls, recent-authentication prompts, and uniform error states in `apps/web/src/features/auth/login-page.tsx`, `apps/web/src/features/auth/passkey-client.ts`, `apps/web/src/features/auth/session-settings.tsx`, `apps/web/src/services/security-api.ts`, and `apps/web/src/app.tsx`.
- [ ] T067 [US2] Add redacted audit events for authentication success/failure, credential changes, CSRF refusal, session expiry, one-session revocation, and revoke-all in `apps/api/src/security/audit-service.ts`, `packages/database/src/repositories/security/audit-repository.ts`, and `apps/api/src/security/rate-limit-service.ts`.
- [ ] T068 [US2] Validate the authentication/session quickstart and confirm feature-001 canonical APIs reject unauthenticated, expired, revoked, cross-device, and CSRF-invalid access in `specs/002-owner-security-foundation/quickstart.md`, `tests/contract/openapi.spec.ts`, and `specs/002-owner-security-foundation/validation.md`.

**Checkpoint**: Passkey-only and password-alternative access work through the same sole-owner boundary, and all selected sessions stop authorizing or renewing immediately after revocation.

## Phase 6: User Story 3 - Manage Authorized Devices (Priority: P2)

**Goal**: Give the owner an attributable device inventory with editable metadata, protected local-key capability, synchronization authorization, revocation, and an explicit remote-erasure limitation.

**Independent Test**: Authorize two browser devices, inspect all required fields, rename and change a storage limit, revoke one device, replay its old proof/session, and confirm it cannot reconnect or receive new content while canonical identities remain unchanged.

### Tests for User Story 3

- [ ] T069 [P] [US3] Add contract tests for device listing, update, revocation, device schema fields, CSRF requirements, and revocation problem responses in `tests/contract/devices.contract.spec.ts`.
- [ ] T070 [P] [US3] Add unit and property tests for device-name/limit validation, device lifecycle, reauthorization receiving a new ID, session/device binding, and revocation denial decisions in `packages/domain/tests/devices.property.spec.ts`.
- [ ] T071 [P] [US3] Add database integration tests for two-device inventory, activity/sync updates, rename/limit changes, concurrent revocation, old-session/key rejection, and unchanged feature-001 workspace/content identities in `packages/database/tests/devices.integration.spec.ts`.
- [ ] T072 [P] [US3] Add fault-injection coverage for device revocation during session renewal, synchronization authorization, local-key proof, and new-data delivery in `apps/api/tests/device-revocation-fault-injection.integration.spec.ts`.
- [ ] T073 [P] [US3] Add Playwright responsive device-management coverage for inventory fields, rename/limit updates, revoke confirmation, revoked state, keyboard access, and the unreachable-device remote-erasure warning in `tests/e2e/devices.spec.ts`.

### Implementation for User Story 3

- [ ] T074 [US3] Implement authorized-device entity validation, activity/sync accounting, local-storage-limit rules, key-protection capability states, and revocation decisions in `packages/domain/src/security/devices.ts` and `packages/database/src/repositories/security/device-repository.ts`.
- [ ] T075 [US3] Implement owner-visible device inventory, update, revocation, and active-device authorization checks in `apps/api/src/routes/devices.ts`, `apps/api/src/security/device-service.ts`, `apps/api/src/security/private-route-guard.ts`, and `packages/contracts/src/security-api.ts`.
- [ ] T076 [US3] Bind sessions and feature-001 synchronization/change delivery to active device state and reject revoked-device session renewal, device proof, key use, and new-data delivery in `apps/api/src/routes/changes.ts`, `apps/api/src/routes/mutation-batch.ts`, `apps/api/src/security/session-service.ts`, and `apps/api/src/security/device-service.ts`.
- [ ] T077 [US3] Implement device settings, local usage/limit reporting, key-protection capability display, revoke confirmation, and the remote-erasure limitation in `apps/web/src/features/devices/device-list.tsx`, `apps/web/src/features/devices/device-settings.tsx`, `apps/web/src/features/devices/revocation-warning.tsx`, `apps/web/src/services/security-api.ts`, and `apps/web/src/app.tsx`.
- [ ] T078 [US3] Preserve existing browser-local feature-001 device/projection/mutation identities when a device is renamed, limited, revoked, or reauthorized in `packages/client-core/src/security/device-binding.ts`, `packages/client-core/src/local-store/schema.ts`, `apps/web/src/services/local-content.ts`, and `packages/client-core/tests/local-store.contract.spec.ts`.
- [ ] T079 [US3] Add redacted audit events for device authorization, rename, storage-limit change, revocation, rejected reconnect, and remote-erasure limitation display in `apps/api/src/security/audit-service.ts`, `packages/database/src/repositories/security/audit-repository.ts`, and `apps/web/src/features/devices/revocation-warning.tsx`.
- [ ] T080 [US3] Validate the device and local-encryption quickstart scenarios and record that revocation controls future authorization but cannot guarantee erasure from an unreachable device in `specs/002-owner-security-foundation/quickstart.md` and `specs/002-owner-security-foundation/validation.md`.

**Checkpoint**: The owner can identify and revoke every authorized device, and revoked devices cannot authorize future access or data delivery without claiming that unreachable ciphertext was erased.

## Phase 7: User Story 5 - Rotate Keys and Recover Administratively (Priority: P2)

**Goal**: Provide observable, resumable scheduled/emergency key rotation, recovery-kit replacement/revocation, compatible administrative recovery, integrity/key checks, redacted diagnostics, and explicit destructive-operation safeguards.

**Independent Test**: Run scheduled and emergency rotations with injected interruptions, verify generation and recovery-kit revocation behavior, run administrative checks with missing keys, and recover a compatible installation without changing feature-001 identities.

### Tests for User Story 5

- [ ] T081 [P] [US5] Add contract tests for rotation start/status, recovery-kit replacement/import/inspect, compatibility, integrity/key checks, password/session administration, repair, diagnostics, fixed exit codes, JSON/text output, dry-run, and confirmation behavior in `tests/contract/admin-cli.contract.spec.ts`, `tests/contract/security-rotation.contract.spec.ts`, and `specs/002-owner-security-foundation/contracts/admin-cli.md`.
- [ ] T082 [P] [US5] Add unit and property tests for the planned/prepared/rewrapping/committing/complete/failed rotation state machine, monotonic generations, checkpoint digests, idempotent cursors, conflict refusal, and decrypt-only compatibility policy in `packages/domain/tests/key-rotation.property.spec.ts`.
- [ ] T083 [P] [US5] Add CLI parser and redaction tests for help, validation, protected stdin/Tty/file-descriptor input, JSON/text envelopes, correlation IDs, exit codes 0/2/3/4/5/6/7, and forbidden output fields in `apps/api/tests/admin-cli.spec.ts` and `packages/domain/tests/admin-command-redaction.property.spec.ts`.
- [ ] T084 [P] [US5] Add integration tests for scheduled/emergency rotation, new-write generation switching, old-generation decrypt-only behavior, kit epoch replacement, malformed/wrong/cross-installation/superseded/revoked kit rejection, and compatible recovery preserving all feature-001 IDs in `packages/database/tests/key-rotation.integration.spec.ts` and `packages/database/tests/administrative-recovery.integration.spec.ts`.
- [ ] T085 [P] [US5] Add fault-injection tests before preparation, after preparation, at every record/chunk checkpoint, during commit, after completion, during recovery import, and during integrity repair in `apps/api/tests/key-rotation-fault-injection.integration.spec.ts` and `apps/api/tests/administrative-recovery-fault-injection.integration.spec.ts`.
- [ ] T086 [P] [US5] Add Playwright coverage for rotation progress/failure/resume, recovery-kit replacement/revocation, recovery readiness, integrity failure messaging, and accessible responsive security settings in `tests/e2e/security-rotation.spec.ts`.

### Implementation for User Story 5

- [ ] T087 [US5] Implement resumable rotation domain transitions, deterministic checkpoint/cursor processing, digest validation, one-active-operation conflict rules, old-generation compatibility, and revoked-generation denial in `packages/domain/src/security/key-rotation.ts`, `packages/database/src/repositories/security/key-rotation-repository.ts`, and `packages/database/src/repositories/security/protected-record-repository.ts`.
- [ ] T088 [US5] Implement owner key-rotation start/status endpoints with scheduled/emergency mode, recent-authentication gate, dry-run support, progress DTOs, and safe conflict/failure responses in `apps/api/src/routes/security-rotation.ts`, `apps/api/src/security/key-rotation-service.ts`, and `packages/contracts/src/security-api.ts`.
- [ ] T089 [US5] Implement recovery-kit replacement, epoch advancement, prior-kit revocation/supersession, compatible historical-generation selection, header inspection, and passphrase-protected import in `apps/api/src/security/recovery-kit-service.ts`, `packages/database/src/repositories/security/recovery-kit-repository.ts`, and `apps/api/src/routes/security-recovery.ts`.
- [ ] T090 [US5] Implement administrative command dispatch, protected input sources, fixed exit codes, JSON/text output, dry-run/confirmation policy, and command help in `apps/api/src/admin/security-cli.ts`, `apps/api/src/admin/command-parser.ts`, `apps/api/src/admin/command-output.ts`, `apps/api/src/admin/security-commands.ts`, and `apps/api/src/app.ts`.
- [ ] T091 [US5] Implement `security status`, password reset, session revocation, key check, integrity verify, rotate, rotation inspect, recovery inspect/import, repair, compatibility, and redacted diagnostics exactly as specified in `apps/api/src/admin/security-commands.ts`, `apps/api/src/security/integrity-service.ts`, `apps/api/src/security/administrative-recovery-service.ts`, and `specs/002-owner-security-foundation/contracts/admin-cli.md`.
- [ ] T092 [US5] Implement recovery of locked/damaged/replaced compatible installations without owner recreation or feature-001 ID regeneration in `apps/api/src/security/administrative-recovery-service.ts`, `packages/database/src/repositories/security/installation-security-repository.ts`, `packages/database/src/repositories/security/owner-repository.ts`, and `packages/database/src/repositories/security/integrity-repository.ts`.
- [ ] T093 [US5] Implement append-only redacted audit events for key generation changes, rotation checkpoints/failures, kit replacement/revocation/import, integrity failures, administrative recovery, repair, and diagnostics in `packages/domain/src/security/audit.ts`, `apps/api/src/security/audit-service.ts`, and `packages/database/src/repositories/security/audit-repository.ts`.
- [ ] T094 [US5] Add rotation/recovery progress, replacement-kit status, compatible-recovery messaging, safe integrity failure, and accessible confirmation UI in `apps/web/src/features/security/key-rotation-panel.tsx`, `apps/web/src/features/security/recovery-kit-panel.tsx`, `apps/web/src/features/security/security-settings.tsx`, and `apps/web/src/services/security-api.ts`.
- [ ] T095 [US5] Validate every administrative command with `--help`, valid/invalid input, JSON output, missing key, captured logs, dry-run, confirmation, and failure exit status, then record measured results in `specs/002-owner-security-foundation/quickstart.md` and `specs/002-owner-security-foundation/validation.md`.

**Checkpoint**: Rotation and recovery are resumable and auditable, revoked material cannot authorize new access, and no destructive administrative change occurs without dry-run or explicit confirmation.

## Phase 8: Polish & Cross-Cutting Quality Gates

**Purpose**: Close integration, documentation, security, performance, Compose, migration, and release-quality obligations across all stories.

- [ ] T096 [P] Extend the existing feature-001 route, repository, export, and browser projection tests to assert authenticated access, encrypted payload handling, and unchanged canonical IDs in `apps/api/tests/files.contract.spec.ts`, `apps/api/tests/page-documents.contract.spec.ts`, `apps/api/tests/mutations.contract.spec.ts`, `apps/api/tests/relationships.contract.spec.ts`, `apps/api/tests/revisions.contract.spec.ts`, `apps/api/tests/reconciliation.contract.spec.ts`, `packages/database/tests/atomicity.integration.spec.ts`, `packages/database/tests/file-placements.integration.spec.ts`, `packages/database/tests/revision-retention.integration.spec.ts`, `packages/client-core/tests/local-store.contract.spec.ts`, `packages/client-core/tests/outbox.spec.ts`, `packages/client-core/tests/reconciliation.spec.ts`, `tests/e2e/hierarchy.spec.ts`, `tests/e2e/files.spec.ts`, `tests/e2e/relationships.spec.ts`, `tests/e2e/revision-restore.spec.ts`, and `tests/e2e/offline-reconciliation.spec.ts`.
- [ ] T097 [P] Add end-to-end security regression coverage for responsive keyboard/focus behavior, safe error copy, private-content non-disclosure, session/device/recovery readiness indicators, and all changed interactive flows in `tests/e2e/accessibility.spec.ts`, `tests/e2e/bootstrap.spec.ts`, `tests/e2e/authentication.spec.ts`, `tests/e2e/devices.spec.ts`, and `tests/e2e/security-recovery.spec.ts`.
- [ ] T098 [P] Add Compose/security tests for secret-file mounting, absence of deployment keys from argv/logs/image layers/`.env`, loopback-only ports, healthchecks, UTC configuration, least-privilege services, and real stack startup in `tests/contract/compose-security.spec.ts`, `compose.yaml`, `compose.override.yaml`, and `.env.example`.
- [ ] T099 [P] Add security scan and shell/toolchain checks for dependency lock integrity, no forbidden package manager artifacts, no secret literals, redacted logs, Compose configuration, and container image configuration in `scripts/ci/check-toolchain.ts`, `scripts/ci/check-shell.ts`, `.github/workflows/ci.yml`, and `.github/rulesets/main.json`.
- [ ] T100 [P] Add encryption-inclusive performance and resource tests for common feature-001 operations, asynchronous scrypt concurrency, encrypted blob chunks, and resumable rotation progress against the plan's targets in `tests/performance/owner-security.perf.spec.ts` and `tests/fixtures/security.ts`.
- [ ] T101 [P] Add a complete migration/fault-injection matrix from empty and feature-001 fixtures, asserting complete prior state or resumable state after every persistence boundary in `packages/database/tests/migrations.integration.spec.ts`, `packages/database/tests/security-migration.integration.spec.ts`, `apps/api/tests/bootstrap-fault-injection.integration.spec.ts`, and `apps/api/tests/key-rotation-fault-injection.integration.spec.ts`.
- [ ] T102 [P] Update the official environment, Compose, external-secret, local HTTP, reverse-proxy, recovery-kit, rotation, and administrative-operation documentation in `.env.example`, `compose.yaml`, `compose.override.yaml`, `specs/002-owner-security-foundation/quickstart.md`, and `specs/002-owner-security-foundation/contracts/admin-cli.md`.
- [ ] T103 Run and fix the complete local quality gate—`pnpm toolchain:check`, `pnpm format:check`, `pnpm lint:ci`, `pnpm shell:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:property`, `pnpm test:integration`, `pnpm test:contract`, `pnpm db:test-migrations`, `pnpm test:e2e`, and `pnpm build`—with results recorded in `specs/002-owner-security-foundation/validation.md` and workflow parity maintained in `.github/workflows/ci.yml`.
- [ ] T104 Verify the official Compose stack starts with the documented secret fixture, the API/web health checks pass, the database migrates from empty and feature-001 states, and the image/security checks pass in `tests/contract/compose-security.spec.ts`, `compose.yaml`, `compose.override.yaml`, and `specs/002-owner-security-foundation/validation.md`.
- [ ] T105 Review all implementation and test diffs for accidental feature-001 identity/model duplication, second-owner paths, plaintext persistence, secret logging, unsafe admin mutation, branch changes, and unrelated worktree modifications in `specs/002-owner-security-foundation/tasks.md`, `specs/002-owner-security-foundation/validation.md`, and the repository worktree.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; establishes package, Compose, and test-harness prerequisites.
- **Foundational (Phase 2)**: Depends on Setup and blocks every story; establishes schemas, migrations, fixtures, redaction, route-guard interfaces, and contract validation.
- **User Story 4 (Phase 3, P1)**: First story after the foundation because bootstrap readiness and all later stories depend on authenticated application encryption, external key handling, and recovery-kit primitives.
- **User Story 1 (Phase 4, P1)**: Depends on foundational persistence and US4 encryption/recovery services; establishes the sole owner and initial authorized device.
- **User Story 2 (Phase 5, P1)**: Depends on US1's owner/passkey/device records and US4's protected persistence; its session guard then protects feature-001 routes.
- **User Story 3 (Phase 6, P2)**: Depends on US2's sessions and US4's local-key state; it extends device authorization and synchronization denial.
- **User Story 5 (Phase 7, P2)**: Depends on US2 session/recent-authentication controls, US3 device revocation, and US4 encrypted generations/recovery artifacts.
- **Polish (Phase 8)**: Depends on all required stories and validates the complete quickstart, quality gate, Compose/security contract, and release readiness.

### User Story Dependencies

```text
Foundational
    ↓
US4 Protect data/recovery ──┐
                            ├──> US1 Bootstrap ──> US2 Auth/sessions ──> US3 Devices ──┐
                            └────────────────────────────────────────────────────────────┤
                                                                                         └──> US5 Rotation/admin recovery ──> Polish
```

- **US4** is independently testable with a seeded feature-001 installation and is the security prerequisite for bootstrap.
- **US1** must complete before authentication journeys can use a real owner, but it must not redefine feature-001 identities.
- **US2** depends on US1 for owner credentials and on US4 for protected session/security metadata.
- **US3** depends on US2 for session/device authorization and on US4 for local encrypted state.
- **US5** depends on all preceding security state machines and must preserve the same owner, workspace, and feature-001 canonical IDs during recovery.

### Within Each User Story

- Contract, unit, property, integration, fault-injection, and Playwright tests are written before the corresponding implementation tasks and must fail for the missing behavior.
- Domain rules and schemas precede repositories/services; repositories/services precede routes/CLI; API behavior precedes web journeys.
- A story is complete only when its independent test criteria pass, its audit/redaction behavior is covered, and the checkpoint is verified.

## Parallel Execution Examples

### User Story 4

```text
Parallel: T025, T026, T027, T028, T029, T030, T031
Then: T032/T033 (crypto and blob adapters) in parallel with T034 (security repositories)
Then: T035/T036, followed by T037–T042
```

### User Story 1

```text
Parallel: T043, T044, T045, T046, T047
Then: T048 and T049 in parallel
Then: T050/T051, followed by T052/T053/T054
```

### User Story 2

```text
Parallel: T055, T056, T057, T058, T059
Then: T060, T061, and T062 in parallel
Then: T063/T064/T065, followed by T066–T068
```

### User Story 3

```text
Parallel: T069, T070, T071, T072, T073
Then: T074 and T075 in parallel
Then: T076/T077/T078/T079, followed by T080
```

### User Story 5

```text
Parallel: T081, T082, T083, T084, T085, T086
Then: T087/T088, T089/T090, and T093 in parallel where repository boundaries permit
Then: T091/T092/T094/T095
```

## Implementation Strategy

### MVP First

The smallest useful release is **Foundational + US4 + US1**: protected persistence and recovery material plus a complete single-owner bootstrap. Stop at the US1 checkpoint and verify a fresh installation, one-owner invariant, recovery readiness, fail-closed key behavior, and preserved feature-001 identities before expanding the authenticated content surface.

### Incremental Delivery

1. Complete Setup and Foundational; run migration, contract, unit, and property checks.
2. Complete US4; validate encrypted persistence, local encryption, recovery-kit export, and fail-closed reads.
3. Complete US1; validate fresh-install bootstrap and deliver the owner-security MVP.
4. Complete US2; protect all existing feature-001 routes and deliver revocable authentication sessions.
5. Complete US3; deliver attributable device management and revocation semantics.
6. Complete US5; deliver rotation, compatible recovery, and administrative operations.
7. Complete Polish; run the full quickstart, Compose/security checks, Playwright matrix, migration/fault matrix, and CI-equivalent quality gate.

### Independent Test Criteria by Story

- **US1**: Valid fresh-install bootstrap produces exactly one owner/workspace/device and ready state; repeated/concurrent/interrupted/invalid-key claims never create a usable second or partial owner.
- **US2**: Passkey-only and password-alternative authentication succeed; inactivity, recent-authentication, CSRF, rate limiting, one-session revocation, and revoke-all behavior are enforced without disclosure.
- **US3**: Two devices are inventoried with all required metadata; rename/limit changes preserve identities; revoked devices cannot renew, sync, or receive data; unreachable local erasure is described honestly.
- **US4**: Every listed server/local protected category has no usable persisted plaintext; invalid/tampered key/envelope cases fail closed; valid recovery export/import works without colocating secrets or changing feature-001 IDs.
- **US5**: Scheduled/emergency rotation completes or resumes across every injected checkpoint; replacement/revoked kits are enforced; admin commands are redacted, deterministic, confirmation-safe, and compatible recovery preserves canonical identities.

## Notes

- `[P]` means the task touches a distinct file boundary and has no dependency on incomplete work within its phase.
- Story labels map to the five user stories in `specs/002-owner-security-foundation/spec.md`; setup, foundational, and polish tasks intentionally have no story label.
- All task lines use the required checklist format: checkbox, sequential ID, optional `[P]`, required story label in story phases, and at least one exact repository file path.
- Do not switch branches, rewrite existing uncommitted changes, or introduce a second dependency/toolchain while implementing these tasks.
