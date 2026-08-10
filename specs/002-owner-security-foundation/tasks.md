# Tasks: Owner Security Foundation

**Input**: Design documents from `specs/002-owner-security-foundation/`

**Prerequisites**: `.specify/memory/constitution.md`, `docs/product/product-canvas.md`, `docs/product/roadmap.md`, `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `validation.md`, `contracts/admin-cli.md`, `contracts/security-api.openapi.yaml`, and `contracts/security-artifacts.schema.json`.

**Scope guard**: Preserve feature-001 canonical identities and models from `specs/001-content-foundations/`; do not edit feature-001 specification artifacts, create a second owner/account/workspace, or add excluded public-sharing, MCP, desktop, backup, or editor behavior.

**Ownership guard**: Feature 002 owns the baseline Compose/env contract, external reverse-proxy boundary, CI quality gate, GHCR publication, and immutable release foundation in FR-030–FR-035. Feature 007 retains only final V1 release-readiness hardening and validation; do not duplicate this baseline in feature 007.

**V1 administration boundary**: Hosting-administrator operations are the protected local CLI in `contracts/admin-cli.md` only. Do not schedule or implement remote administrator HTTP routes, bearer capabilities, API tokens, or any other administrator transport; owner-facing security API operations remain session-cookie plus CSRF protected.

**Test policy**: Tests, fault injection, contract checks, browser journeys, deployment checks, and validation evidence are mandatory. Test tasks precede the implementation they verify; `pending` evidence is never a pass.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the pinned TypeScript/pnpm workspace, test harness, and delivery scaffolding without changing feature-001 artifacts.

- [X] T001 Pin Node.js `>=24.0.0 <25` and pnpm `10.33.3`, add security test/build scripts, and preserve the committed lockfile in `package.json` and `pnpm-lock.yaml` (FR-033, FR-035).
- [X] T002 [P] Register the security package entry points and TypeScript project references in `packages/domain/src/index.ts`, `packages/contracts/src/index.ts`, `packages/database/src/index.ts`, `packages/client-core/src/index.ts`, `packages/blob-store/src/index.ts`, `tsconfig.json`, and `vitest.workspace.ts` (FR-011, FR-012, FR-024, FR-033, FR-035).
- [X] T003 Add controlled-clock, disposable-installation, mounted-secret, feature-001 identity-fixture, virtual-WebAuthn, and fault-injection harness entry points in `tests/fixtures/security.ts`, `packages/database/tests/helpers/security-db.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/helpers.ts`, and `playwright.config.ts`; fixtures must preserve feature-001 IDs without editing its specification artifacts (FR-001, FR-002, FR-006, FR-014, FR-017, FR-025, FR-027, FR-029, SC-001, SC-006, SC-009, SC-010).
- [X] T004 [P] Add the secret-free environment contract, mounted-secret paths, `127.0.0.1` loopback ports, trusted-origin settings, image selection, and ignored local secret fixtures in `.env.example`, `.gitignore`, `compose.yaml`, and `compose.override.yaml` (FR-013, FR-030, FR-031, FR-032).
- [X] T005 Add pinned API and web image build scaffolding for `linux/amd64` and `linux/arm64` with locked dependencies and non-secret build inputs in `docker/api.Dockerfile` and `docker/web.Dockerfile` (FR-032, FR-034).
- [X] T006 Add the security command/test inventory and exact local-checks→pull-request→`main` gate script names in `package.json`, `scripts/ci/check-toolchain.ts`, and `docs/development.md`, including unit, property, integration, contract, migration, e2e, build, Compose, and release-gate checks (FR-033, FR-035).
- [X] T007 Record feature-002 ownership of baseline Compose/env/CI/GHCR/immutable-release work, feature-007’s final-hardening-only boundary, feature-001 identity preservation, excluded boundaries, and the no-edit guard in `specs/002-owner-security-foundation/validation.md` (FR-001, FR-024, FR-030, FR-032, FR-033, FR-034, FR-035).

**Checkpoint**: The pinned workspace, test fixtures, secret-free configuration, and image-build inputs are present; no feature-001 artifact has been edited.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build and test crypto, redaction, singleton state, persistence, contracts, and policy primitives before any user-story flow. No user-story implementation may begin until this phase passes.

### Foundational tests first

- [X] T008 [P] Add OpenAPI 3.1, JSON Schema 2020-12, `$ref`, cookie, problem-code, and protected-local-CLI contract tests in `tests/contract/security-api.spec.ts`, `tests/contract/security-artifacts.schema.spec.ts`, `tests/contract/admin-cli.contract.spec.ts`, and `packages/contracts/tests/security-schema.spec.ts` (FR-020, FR-021, FR-023, FR-035).
- [ ] T009 [P] Add failing crypto-envelope, recovery-artifact, rotation-manifest, and migration-checkpoint contract fixtures in `packages/domain/tests/encryption.property.spec.ts`, `packages/domain/tests/recovery-artifact.property.spec.ts`, `packages/domain/tests/rotation-manifest.property.spec.ts`, and `packages/domain/tests/migration-state.property.spec.ts` (FR-011, FR-014, FR-015, FR-017, FR-028).
- [X] T010 [P] Add failing tests for singleton installation/workspace ownership, canonical identity preservation, safe problem codes, and redaction invariants in `packages/domain/tests/security-owner-device.property.spec.ts`, `packages/domain/tests/security-canonical-identities.property.spec.ts`, and `packages/domain/tests/redaction.property.spec.ts` (FR-001, FR-023, FR-024).
- [X] T011 [P] Add failing persistence tests for serializable transactions, idempotent cursors, installation/workspace scoping, safe failure, and forward migration registration in `packages/database/tests/security-owner.integration.spec.ts`, `packages/database/tests/security-crypto.integration.spec.ts`, and `packages/database/tests/migrations.integration.spec.ts` (FR-001, FR-014, FR-024, FR-029).
- [X] T012 [P] Add failing audit-persistence tests asserting the allowlisted security-event set, both recovery state-axis transitions (download, consumption, confirmation, replacement, revocation, rejection, expiry), rotation/migration/integrity/administrative events, and redaction of every persisted audit row (no content, credentials, tokens, bootstrap capabilities, CSRF tokens, kits, or key material) in `packages/database/tests/security-audit.integration.spec.ts` (FR-022, FR-023, FR-035).

### Foundational implementation

- [X] T013 Define shared security DTOs, safe problem envelopes, cookie metadata, response-only `X-Bootstrap-Capability` and `X-CSRF-Token` handling, explicit pending-credential/bootstrap-confirmation response types, nullable device timestamp mapping types, and runtime request/response validators in `packages/contracts/src/security-api.ts` to match `specs/002-owner-security-foundation/contracts/security-api.openapi.yaml` (FR-002, FR-003, FR-006, FR-008, FR-015, FR-019, FR-025, FR-028, FR-035).
- [X] T014 Define versioned `mn.enc.v1`, pending-bootstrap-credential, recovery-kit, rotation-manifest, and migration-checkpoint schemas in `packages/contracts/src/security-artifacts.ts` to match `specs/002-owner-security-foundation/contracts/security-artifacts.schema.json`; encode exactly the seven recovery pairs `provisional/prepared`, `provisional/downloadable`, `provisional/download-consumed`, `active/confirmed`, `superseded/confirmed`, `revoked/confirmed`, and `rejected/expired`, with no mixed recovery `state` field (FR-014, FR-015, FR-016, FR-017, FR-028).
- [X] T015 Implement AES-256-GCM envelopes, HKDF-SHA-256 per-record derivation, AAD/digest validation, nonce rules, scrypt recovery wrapping, and generation authorization in `packages/domain/src/security/crypto.ts`, `packages/domain/src/security/envelopes.ts`, and `packages/domain/src/security/recovery-artifacts.ts` (FR-011, FR-013, FR-014, FR-015, FR-018).
- [X] T016 Implement external deployment-key loading, mounted-secret permission checks, unavailable/invalid-key safe failure, and explicit loopback configuration validation in `apps/api/src/security/deployment-key.ts` and `apps/api/src/security/security-config.ts` (FR-013, FR-014, FR-023, FR-035).
- [X] T017 Implement forbidden-field traversal, redacted diagnostics/audit serialization, safe error mapping, correlation IDs, and allowlisted security events in `packages/domain/src/security/redaction.ts`, `packages/domain/src/security/audit.ts`, `apps/api/src/plugins/errors.ts`, and `apps/api/src/security/audit-service.ts` (FR-022, FR-023, FR-035).
- [X] T018 Implement platform-independent entity states, committed installation-count invariants (`ownerCount=0`/`workspaceCount=0` for uninitialized/bootstrap-in-progress and `ownerCount=1`/`workspaceCount=1` for ready/recovery states), policy state vocabulary, due/write-block calculations, and canonical identity manifest hashing in `packages/domain/src/security/types.ts`, `packages/domain/src/security/invariants.ts`, `packages/domain/src/security/rotation-policy.ts`, and `packages/domain/src/security/identity-manifest.ts` (FR-001, FR-018, FR-024, FR-025, FR-026, FR-027).
- [X] T019 Add the security schema and reviewed forward migration for installation, attempt-scoped pending credential material, owner credentials, bootstrap attempts, sessions, devices, epochs, keys, policies, envelopes, migration checkpoints, rate limits, and audit rows in `packages/database/src/schema/security/index.ts`, `packages/database/src/schema/index.ts`, and `packages/database/migrations/0004_owner_security_foundation.sql`; enforce no committed owner/workspace rows and `0/0` before confirmation (FR-001, FR-011, FR-014, FR-017, FR-022, FR-024, FR-028).
- [X] T020 Implement serializable transaction helpers, singleton installation guards, scoped repositories, idempotency keys, fail-closed repository errors, and the shared append-only audit repository that every later phase writes through, in `packages/database/src/repositories/security/repository-types.ts`, `packages/database/src/repositories/security/transaction.ts`, `packages/database/src/repositories/security/installation-repository.ts`, and `packages/database/src/repositories/security/audit-repository.ts`; the audit repository must persist the allowlisted event set with installation/workspace scoping and redacted payloads so that T012 passes inside Phase 2 (FR-001, FR-014, FR-019, FR-022, FR-023, FR-024, FR-029).
- [X] T021 Implement shared request context, safe authentication-hook interfaces, and private-route readiness interfaces in `apps/api/src/security/request-context.ts`, `apps/api/src/security/authentication-hook.ts`, `apps/api/src/security/private-route-guard.ts`, and `apps/api/src/app.ts` (FR-002, FR-006, FR-007, FR-024).
- [ ] T022 Add the contract-validation runner and exact artifact links used by later story checks in `tests/contract/security-api.spec.ts`, `tests/contract/security-artifacts.schema.spec.ts`, and `tests/contract/admin-cli.contract.spec.ts` for the local CLI only (FR-020, FR-021, FR-035).
- [ ] T023 Run the foundational contract, crypto, redaction, migration, and repository tests; record raw commands, candidate SHA, fixture IDs, and pass/fail/blocked status in `specs/002-owner-security-foundation/validation.md`, keeping unrun rows `pending` (FR-013, FR-014, FR-023, FR-024, FR-035).

**Checkpoint**: Crypto/state primitives, contracts, scoped persistence, redaction, and validation evidence rules pass before bootstrap or session-dependent work starts.

## Phase 3: User Story 1 — Establish the Sole Owner Securely (Priority: P1)

**Goal**: Establish exactly one owner and one feature-001 workspace through a session-free bootstrap capability, then require a one-time 15-minute provisional recovery download and offline confirmation before readiness.

**Independent Test**: From an empty installation with a valid mounted key, complete bootstrap with a virtual passkey, consume and confirm the provisional kit, then race/replay/interruption-test claims and invalid-key paths.

### Tests for User Story 1 (write first and make them fail)

- [ ] T024 [P] [US1] Add OpenAPI contract tests for installation status, session-free bootstrap start, credential verification, one-time download, regeneration, and offline confirmation in `apps/api/tests/bootstrap.contract.spec.ts` against `specs/002-owner-security-foundation/contracts/security-api.openapi.yaml` (FR-001, FR-002, FR-015, FR-016).
- [ ] T025 [P] [US1] Add bootstrap state-machine property tests for no-session capability scope, one open attempt, `0/0` before the atomic ownership/workspace commit, `1/1` only in initialized states, 15-minute expiry, one download, replay rejection, same verified `attemptId` plus browser-held capability on regeneration, rejection/expiry of the old material without resurrection, interruption recovery, and readiness prerequisites in `packages/domain/tests/bootstrap-state.property.spec.ts` (FR-001, FR-002, FR-015, FR-016, FR-024, SC-001).
- [ ] T026 [P] [US1] Add serializable concurrency and identity tests for repeated/concurrent claims, committed `ownerCount=0`/`workspaceCount=0` before the atomic commit, `ownerCount=1`/`workspaceCount=1` only after it, restart checkpoints, and no partial owner in `packages/database/tests/bootstrap-concurrency.integration.spec.ts` (FR-001, FR-002, FR-024, SC-001).
- [ ] T027 [P] [US1] Add bootstrap fault-injection tests at credential verification, kit creation, download consumption, confirmation, retry, and unavailable-key boundaries in `apps/api/tests/bootstrap-fault-injection.integration.spec.ts` (FR-002, FR-013, FR-014, FR-015, FR-016).
- [ ] T028 [P] [US1] Add responsive Playwright bootstrap journeys using virtual WebAuthn for fresh, concurrent, repeated, interrupted, expired/lost provisional-kit, invalid-key, keyboard, and focus states in `tests/e2e/bootstrap.spec.ts` (FR-001, FR-002, FR-015, FR-016, SC-001).

### Implementation for User Story 1

- [ ] T029 [US1] Implement the session-free bootstrap state machine with attempt-scoped pending credential material, committed-count states (`0/0` until one atomic ownership/workspace promotion and `1/1` for every initialized state), attempt capability hashing, same-attempt capability verification for regeneration, origin/device binding, one-time download window, old-kit rejection/expiry without resurrection, and atomic confirmation in `packages/domain/src/security/bootstrap.ts` and `packages/database/src/repositories/security/bootstrap-repository.ts` (FR-001, FR-002, FR-015, FR-016, FR-024, SC-001).
- [ ] T030 [US1] Implement bootstrap WebAuthn challenge creation and credential verification with origin/RP ID/user-verification/sign-count checks without issuing a session cookie in `apps/api/src/security/bootstrap-webauthn-service.ts` and `apps/api/src/security/webauthn-service.ts` (FR-002, FR-003, FR-023).
- [ ] T031 [US1] Implement attempt-scoped persistence of `PendingBootstrapCredentialMaterial`, provisional kit metadata, and the browser-held capability; implement the single serializable promotion transaction that only after consumed download plus explicit offline confirmation creates the owner credential/owner, binds the canonical feature-001 workspace, creates the initial device/key generation, activates/confirms the kit, sets `ready`, and changes counts from `0/0` to `1/1` in `apps/api/src/security/bootstrap-service.ts`, `packages/database/src/repositories/security/bootstrap-repository.ts`, `packages/database/src/repositories/security/owner-repository.ts`, and `packages/database/src/repositories/security/workspace-binding-repository.ts` (FR-001, FR-002, FR-015, FR-024, SC-001).
- [ ] T032 [US1] Implement safe installation-status, bootstrap, credential-verification, download, regeneration, and explicit offline-confirmation routes with no session dependency; return pending progress at `0/0` and the browser-held bootstrap capability only in response body/headers, accept it only through `X-Bootstrap-Capability` with the same verified `attemptId`, return the explicit `BootstrapConfirmationResult` (`confirmed/ready/1/1`, `active/confirmed`), reject a different attempt or any old `rejected/expired` kit, and never place capability or kit material in a URL, log, or persistent plaintext in `apps/api/src/routes/installation.ts`, `apps/api/src/routes/bootstrap.ts`, and `apps/api/src/app.ts` (FR-001, FR-002, FR-015, FR-016, FR-023, FR-035).
- [ ] T033 [US1] Implement first-run owner/bootstrap UI with passkey ceremony, optional password handoff, recovery-kit download/confirmation, expiry/resume messaging, and accessible responsive states in `apps/web/src/features/auth/bootstrap-page.tsx`, `apps/web/src/features/auth/passkey-client.ts`, `apps/web/src/features/security/recovery-kit-panel.tsx`, and `apps/web/src/services/security-api.ts` (FR-002, FR-004, FR-015, FR-016, SC-008).
- [ ] T034 [US1] Add bootstrap rate-limit and audit events for claim conflicts, credential verification, kit creation/download/confirmation/regeneration, and interrupted attempts in `apps/api/src/security/rate-limit-service.ts`, `apps/api/src/security/audit-service.ts`, and `packages/database/src/repositories/security/audit-repository.ts` (FR-022, FR-023).
- [ ] T035 [US1] Execute exactly 20 clean-install trials with at least 5 representative operators `O01`–`O05`, recording start/end clocks, duration, credential verification, one download, offline confirmation, `authorizationState=active`, `deliveryState=confirmed`, `ownerCount=1`, `workspaceCount=1`, and raw failures in `specs/002-owner-security-foundation/validation.md`; accept SC-002 only when at least 19 trials finish within 300 seconds and every operator has a trial (SC-002).
- [ ] T036 [US1] Run the independent bootstrap matrix and record `ownerCount=0`/`workspaceCount=0` before the atomic commit, `ownerCount=1`/`workspaceCount=1` for every initialized state (`recovery-required`, `ready`, `migration-in-progress`, `degraded`), same-attempt capability regeneration, old-kit rejection/expiry, concurrent/repeated/interrupted counts, invalid-key results, and candidate evidence in `specs/002-owner-security-foundation/validation.md`; do not replace `pending` with `pass` without raw evidence (FR-001, FR-002, FR-013, FR-014, FR-015, FR-016, SC-001).

**Checkpoint**: US1 is complete and validated without a session: exactly one owner/workspace exists, readiness requires confirmed offline recovery, and no bootstrap path creates a usable partial or second owner.

## Phase 4: User Story 2 — Authenticate and Control Sessions (Priority: P1)

**Goal**: Add passkey-only and password-alternative authentication, production and loopback cookie policies, recent-authentication, inactivity expiry, CSRF, rate limits, and revocation.

**Dependency**: Starts only after the US1 checkpoint; no session-dependent owner flow may be used to complete bootstrap.

**Independent Test**: Sign in by passkey alone and by password alternative, test controlled-clock bounds and recent authentication, then revoke one/all sessions and verify access and renewal stop.

### Tests for User Story 2 (write first and make them fail)

- [ ] T037 [P] [US2] Add contract tests for the exact owner endpoints `POST /v1/auth/passkeys/enrollment/options`, `POST /v1/auth/passkeys/enrollment/complete`, `GET /v1/auth/passkeys`, `DELETE /v1/auth/passkeys/{credentialId}`, `PUT /v1/auth/password`, passkey/password login, session listing/revocation, session+CSRF+recent-auth requirements, redacted responses, and safe authentication failures in `apps/api/tests/authentication.contract.spec.ts` (FR-003, FR-004, FR-005, FR-006, FR-007, FR-023, FR-035).
- [ ] T038 [P] [US2] Add controlled-clock unit/property tests for 1–90 day inactivity, default 30-day expiry, 1–60 minute recent-authentication, default 15-minute sensitive-operation reauthentication, and rate-limit transitions in `packages/domain/tests/session-policy.clock.spec.ts` (FR-006, FR-007).
- [ ] T039 [P] [US2] Add production cookie tests requiring `__Host-mn_session; Secure; HttpOnly; SameSite=Strict; Path=/` under HTTPS and rejecting it over HTTP, plus distinct `mn_dev_session` loopback-only HTTP exception tests in `apps/api/tests/session-cookie.policy.spec.ts` and `apps/api/tests/loopback-cookie-exception.spec.ts` (FR-006, FR-023).
- [ ] T040 [P] [US2] Add session/revocation integration tests for passkey-only login, password alternative, wrong-credential indistinguishability, one-session revoke, revoke-all, renewal denial, CSRF failure, and non-loopback HTTP refusal in `packages/database/tests/session.integration.spec.ts` and `apps/api/tests/session-revocation.integration.spec.ts` (FR-003, FR-004, FR-006, FR-007, FR-023).
- [ ] T041 [P] [US2] Add responsive Playwright authentication journeys for passkey-only login, password alternative, reauthentication prompts, session management, revocation, safe errors, keyboard/focus, and cookie behavior in `tests/e2e/authentication.spec.ts` (FR-003, FR-004, FR-005, FR-006, FR-007).

### Implementation for User Story 2

- [ ] T042 [US2] Implement the exact passkey credential-management endpoints `POST /v1/auth/passkeys/enrollment/options`, `POST /v1/auth/passkeys/enrollment/complete`, `GET /v1/auth/passkeys`, and selected `DELETE /v1/auth/passkeys/{credentialId}` with owner-session attribution, CSRF validation, recent-authentication on enrollment/completion and selected removal, redacted list/response fields, and no remote administrator API in `apps/api/src/security/webauthn-service.ts`, `apps/api/src/security/passkey-service.ts`, `apps/api/src/routes/authentication.ts`, and `packages/database/src/repositories/security/passkey-repository.ts` (FR-003, FR-005, FR-006, FR-023, FR-035).
- [ ] T043 [US2] Implement `PUT /v1/auth/password` for setting and changing the password alternative, require owner session+CSRF+recent authentication, preserve passkey-only login, use versioned password hashing, keep password reset out of the owner API, and return indistinguishable redacted credential failures in `apps/api/src/security/password-service.ts`, `apps/api/src/routes/authentication.ts`, and `packages/database/src/repositories/security/password-repository.ts` (FR-004, FR-005, FR-006, FR-023).
- [ ] T044 [US2] Implement opaque server-side sessions, inactivity expiry, recent-authentication checks, device binding, independent revocation, renewal denial, and controlled-clock policy evaluation in `apps/api/src/security/session-service.ts`, `packages/database/src/repositories/security/session-repository.ts`, and `packages/domain/src/security/session-policy.ts` (FR-006, FR-007).
- [ ] T045 [US2] Implement CSRF protection using the browser-returned `X-CSRF-Token` value only as the CSRF request header, never in a URL, log, or persistent plaintext, plus the production `__Host-mn_session` versus loopback-only `mn_dev_session` issuance/acceptance predicate in `apps/api/src/security/cookie-policy.ts`, `apps/api/src/security/csrf.ts`, and `apps/api/src/security/authentication-hook.ts` (FR-006, FR-007, FR-023).
- [ ] T046 [US2] Implement authentication/session routes, browser-returned CSRF response handling, owner-visible redacted session and credential inventories, one-session revoke, revoke-all, recent-authentication failures, and rate-limited safe errors in `apps/api/src/routes/authentication.ts`, `apps/api/src/routes/sessions.ts`, and `apps/api/src/app.ts` (FR-003, FR-004, FR-005, FR-006, FR-007, FR-022, FR-023).
- [ ] T047 [US2] Implement responsive sign-in, credential-management, recent-authentication, session-inventory, and revocation UI states in `apps/web/src/features/auth/login-page.tsx`, `apps/web/src/features/security/session-panel.tsx`, `apps/web/src/features/security/security-settings.tsx`, and `apps/web/src/services/security-api.ts` (FR-003, FR-004, FR-005, FR-006, FR-007, SC-008).
- [ ] T048 [US2] Record authentication successes/failures, method changes, rate limits, session revocations, and cookie-policy refusals through the redacted audit path in `apps/api/src/security/audit-service.ts` and `packages/database/src/repositories/security/audit-repository.ts` (FR-022, FR-023).
- [ ] T049 [US2] Run the authentication/session evidence matrix and update `specs/002-owner-security-foundation/validation.md` with exact passkey/password counts, expiry clocks, revocation denials, cookie headers, CSRF failures, and candidate SHA (FR-003, FR-004, FR-005, FR-006, FR-007, SC-003).

**Checkpoint**: US2 provides coherent authenticated owner flows and secure session control; production never uses the development cookie, and loopback HTTP never receives the production cookie.

## Phase 5: User Story 4 — Protect Data and Maintain Recovery Material (Priority: P1)

**Goal**: Encrypt server and local protected data with authenticated envelopes, retain external key custody, fail closed on invalid material, and preserve feature-001 identities.

**Independent Test**: Seed page/block content, sensitive properties/relationships, files, indexes, history, annotations, integration secrets, local pending operations, and browser storage; inspect ciphertext and fail closed for missing, wrong, corrupt, or revoked keys.

### Tests for User Story 4 (write first and make them fail)

- [ ] T050 [P] [US4] Add server encryption integration tests covering page/block content, sensitive properties/relationships, files/chunks, content-revealing indexes, history, annotations, and recoverable integration secrets while preserving feature-001 identity manifests in `packages/database/tests/security-crypto.integration.spec.ts` (FR-011, FR-014, FR-024).
- [ ] T051 [P] [US4] Add encrypted blob chunk tests for authenticated 4 MiB chunk envelopes, digest/content addressing, nonce uniqueness, tamper detection, and chunk-index AAD in `packages/blob-store/tests/encrypted-chunks.spec.ts` (FR-011, FR-014, FR-017).
- [ ] T052 [P] [US4] Add local encryption tests for content, files, indexes, pending operations, device-secure-storage behavior, lock/key-loss states, and preserved local projection/mutation identities in `packages/client-core/tests/local-encryption.spec.ts` and `packages/client-core/tests/local-encryption.integration.spec.ts` (FR-012, FR-014, FR-024).
- [ ] T053 [P] [US4] Add missing/wrong/corrupt/unauthorized/revoked-key and flipped-ciphertext/tag/AAD/generation fault tests proving no partial or substituted data in `apps/api/tests/encryption-read-faults.integration.spec.ts` and `packages/database/tests/encryption-fault-injection.integration.spec.ts` (FR-013, FR-014, FR-023).
- [ ] T054 [P] [US4] Add responsive Playwright recovery-readiness, protected-storage failure, encrypted-local-state, and honest error journeys in `tests/e2e/security-recovery.spec.ts` (FR-011, FR-012, FR-014, FR-015, FR-016).

### Implementation for User Story 4

- [ ] T055 [US4] Implement protected-record repositories and generation-aware encrypted reads/writes for feature-001 payload-bearing fields while retaining approved routing metadata and every canonical ID in `packages/database/src/repositories/security/protected-record-repository.ts`, `packages/database/src/repositories/item-repository.ts`, `packages/database/src/repositories/revision-repository.ts`, and `packages/database/src/repositories/relationship-repository.ts` (FR-011, FR-014, FR-024).
- [ ] T056 [US4] Implement encrypted file metadata/chunk storage and content-addressed ciphertext without changing logical file identity or digest lineage in `packages/blob-store/src/encryption/encrypted-chunk-store.ts`, `packages/blob-store/src/encrypted-blob-store.ts`, and `packages/blob-store/src/index.ts` (FR-011, FR-014, FR-024).
- [ ] T057 [US4] Integrate protected repositories with feature-001 page, file, relationship, revision, search, export, and snapshot routes without editing feature-001 artifacts in `apps/api/src/routes/pages.ts`, `apps/api/src/routes/files.ts`, `apps/api/src/routes/relationships.ts`, `apps/api/src/routes/revisions.ts`, `apps/api/src/routes/search.ts`, `apps/api/src/routes/export.ts`, and `apps/api/src/routes/snapshots.ts` (FR-011, FR-024).
- [ ] T058 [US4] Implement device-bound encrypted local storage for content, files, indexes, pending operations, and conflicts using platform secure storage when available in `packages/client-core/src/security/local-encryption.ts`, `packages/client-core/src/security/local-key-state.ts`, `packages/client-core/src/local-store/schema.ts`, and `packages/client-core/src/local-store/local-repository.ts` (FR-012, FR-014, FR-024).
- [ ] T059 [US4] Implement encrypted recovery-kit artifact creation, format/version/lineage metadata, supported generations, offline separation, readiness persistence, and the canonical `authorizationState`/`deliveryState` valid-pair transitions for provisional and active kits in `apps/api/src/security/recovery-kit-service.ts`, `packages/database/src/repositories/security/recovery-kit-repository.ts`, and `packages/domain/src/security/recovery-artifacts.ts` (FR-015, FR-016, FR-018).
- [ ] T060 [US4] Enforce fail-closed reads, generation authorization, external-secret boundaries, and redacted integrity failures through `apps/api/src/security/integrity-service.ts`, `packages/database/src/repositories/security/integrity-repository.ts`, and `apps/api/src/plugins/errors.ts` (FR-013, FR-014, FR-023).
- [ ] T061 [US4] Add encryption/recovery audit events and status projections without logging plaintext, keys, credentials, tokens, or artifacts in `apps/api/src/security/audit-service.ts`, `packages/database/src/repositories/security/audit-repository.ts`, and `packages/domain/src/security/audit.ts` (FR-022, FR-023, FR-035).
- [ ] T062 [US4] Run the complete server/local encryption and recovery-readiness evidence suite, record category-by-category usable plaintext counts and fail-closed counts in `specs/002-owner-security-foundation/validation.md`, and mark SC-004 only from raw evidence after migration-compatible storage is verified (FR-011, FR-012, FR-014, FR-015, FR-016, SC-004).

**Checkpoint**: All FR-011/FR-012 categories are application-encrypted, invalid material fails closed, external key custody is preserved, and recovery artifacts are not colocated with workspace ciphertext.

## Phase 6: User Story 3 — Manage Authorized Devices (Priority: P2)

**Goal**: Provide an owner-visible device inventory, rename/limit controls, explicit revocation, local-key binding, and reauthorization after recovery.

**Dependency**: Starts after US2 sessions and US4 local encryption are complete.

**Independent Test**: Authorize two devices, inspect and edit metadata, revoke one, replay its authorization, and verify sign-in/renewal/new-data/synchronization-key use is denied until explicit reauthorization.

### Tests for User Story 3 (write first and make them fail)

- [ ] T063 [P] [US3] Add device inventory/update/revoke/reauthorize contract tests requiring `lastActivityAt` and `lastSyncAt` in every response, explicitly `null` before activity/sync events, populated only by their corresponding real events, and mapped from database `last_activity_at`/`last_sync_at` to API `lastActivityAt`/`lastSyncAt`, plus all other required fields and safe remote-erasure wording in `apps/api/tests/devices.contract.spec.ts` (FR-008, FR-009, FR-010, FR-023).
- [ ] T064 [P] [US3] Add device state and local-identity property tests for authorization, rename, storage-limit validation, revocation, key denial, and reauthorization-required transitions in `packages/domain/tests/device-state.property.spec.ts` (FR-008, FR-009, FR-024).
- [ ] T065 [P] [US3] Add database integration tests for two-device inventory, before-event `lastActivityAt=null`/`lastSyncAt=null`, after-event timestamps sourced only from an activity event and a successful sync event, unchanged timestamps across inventory reads/rename/limit/revocation, stable feature-001 local projection/outbox IDs, revocation cascades, and post-recovery trust reset in `packages/database/tests/device-management.integration.spec.ts` (FR-008, FR-009, FR-024, SC-003).
- [ ] T066 [P] [US3] Add responsive Playwright device-settings journeys for inventory, rename, limit change, revoke, explicit reauthorize, keyboard/focus, and unreachable-device erasure limitation in `tests/e2e/devices.spec.ts` (FR-008, FR-009, FR-010, SC-008).

### Implementation for User Story 3

- [ ] T067 [US3] Implement authorized-device inventory, stable device binding, required nullable `lastActivityAt`/`lastSyncAt` persistence, event-only timestamp updates, local limits/usage, state, and key-version persistence in `packages/database/src/repositories/security/device-repository.ts` and `packages/database/src/schema/security/device.ts`; retain nullable database `last_activity_at`/`last_sync_at` until real events commit (FR-008, FR-024).
- [ ] T068 [US3] Implement authenticated device inspection, rename, storage-limit update, revocation, synchronization-key denial, and explicit reauthorization service rules in `apps/api/src/security/device-service.ts` and `packages/domain/src/security/device-policy.ts` (FR-009, FR-010, FR-024).
- [ ] T069 [US3] Implement device inventory/update/revoke/reauthorize routes with mandatory nullable timestamp fields, explicit database-to-API mapping from `last_activity_at`/`last_sync_at` to `lastActivityAt`/`lastSyncAt`, event-only timestamp writes, recent-authentication, CSRF, safe errors, and no remote-erasure overclaim in `apps/api/src/routes/devices.ts`, `apps/api/src/routes/reauthorization.ts`, and `apps/api/src/security/device-service.ts` (FR-008, FR-009, FR-010, FR-023).
- [ ] T070 [US3] Bind local encrypted-store access and synchronization delivery to the current device trust grant and preserve local projection/mutation identities during reauthorization in `packages/client-core/src/security/device-key-binding.ts`, `packages/client-core/src/security/reauthorization.ts`, and `apps/api/src/security/synchronization-authorization.ts` (FR-009, FR-012, FR-024).
- [ ] T071 [US3] Implement accessible responsive device inventory, edit, revoke, reauthorize, usage-limit, and unreachable-device explanation views in `apps/web/src/features/security/device-panel.tsx`, `apps/web/src/features/security/security-settings.tsx`, and `apps/web/src/services/security-api.ts` (FR-008, FR-009, FR-010, SC-008).
- [ ] T072 [US3] Record device authorization, rename, revocation, reauthorization, synchronization-denial, before-event null timestamp, and after-event populated timestamp evidence in `apps/api/src/security/audit-service.ts`, `packages/database/src/repositories/security/audit-repository.ts`, and `specs/002-owner-security-foundation/validation.md` (FR-008, FR-009, FR-010, FR-022, SC-003).

**Checkpoint**: Devices are attributable and revocable, revoked devices cannot renew or receive protected data, and inaccessible local erasure is described honestly.

## Phase 7: User Story 5 — Recover a Replacement and Rotate Security Material (Priority: P1)

**Goal**: Replace kits only after recent authentication, recover compatible encrypted source data into an empty target while preserving all canonical identities, and operate independent wrapping-key and data-key rotation state machines.

**Dependency**: Starts after US2, US3, and US4; replacement recovery must reset device trust and never create a new lineage or owner.

### Tests for User Story 5 (write first and make them fail)

- [ ] T073 [P] [US5] Add protected-local-CLI contract tests only for status, password/session administration, key check, integrity verify, recovery inspect/import, device reauthorization, both rotation commands/statuses, migration inspection, the exact `security compatibility inspect --target PATH --source PATH [--json] [--dry-run]` command, diagnostics, fixed exit codes, dry-run, confirmation, and help in `tests/contract/admin-cli.contract.spec.ts` against `specs/002-owner-security-foundation/contracts/admin-cli.md`; assert there is no session-based admin-recovery method, no remote administrator bearer/API channel, no API token, and no placeholder administrator authentication, while owner API remains session+CSRF protected (FR-019, FR-020, FR-021, FR-023, FR-035).
- [ ] T074 [P] [US5] Add controlled-clock policy tests for exactly these eight states—pre-due, due, overdue-within-grace, emergency, write-block, in-progress, complete, and failed—for both independent policies, including 365-day wrapping due interval, 7-day scheduled grace, immediate emergency due, independent data-key due/write-block configuration, safe reads, and blocked writes in `packages/domain/tests/rotation-policy.clock.spec.ts` (FR-025, FR-026, FR-027, SC-009).
- [ ] T075 [P] [US5] Add rotation-policy API integration tests for startup evaluation, the at-least-daily automatic due check, startup/status and owner-facing warnings at due/overdue-within-grace/emergency, preserved safe reads of valid existing ciphertext, and explicit owner-API and protected-local-CLI triggers for each policy in `apps/api/tests/key-rotation-policy.integration.spec.ts` (FR-025, FR-026, SC-009).
- [ ] T076 [P] [US5] Add transactional write-block integration tests proving new protected writes are refused exactly at `write_block_at` for each policy (scheduled `due_at` + 7 calendar days; emergency zero-day grace) while safe reads, status inspection, and resumable rotation progress remain available in `apps/api/tests/key-rotation-write-block.integration.spec.ts` (FR-026, FR-027, SC-009).
- [ ] T077 [P] [US5] Add separate wrapping-key tests proving root-key rewrap changes without record/chunk ciphertext changes and separate data-key tests proving progressive record/chunk re-encryption, generation switching, cursors, and decrypt-only compatibility; assert each policy exposes all eight states and independent operation IDs in `packages/domain/tests/wrapping-key-rotation.property.spec.ts`, `packages/domain/tests/data-key-rotation.property.spec.ts`, and `packages/database/tests/key-rotation.integration.spec.ts` (FR-017, FR-018, FR-025, SC-006, SC-009).
- [ ] T078 [P] [US5] Add recovery replacement/import integration tests for one-time download, active-kit continuity, atomic supersession/epoch advance, old/revoked/prior-epoch/wrong-lineage/malformed rejection, empty-target requirement, exact identity manifest preservation, and device reauthorization in `packages/database/tests/recovery-kit.integration.spec.ts` and `packages/database/tests/administrative-recovery.integration.spec.ts` (FR-016, FR-018, FR-019, FR-024, SC-005).
- [ ] T079 [P] [US5] Add interruption, restart, unavailable-secret, rotation-conflict, and recovery-import fault tests at every persistence boundary in `apps/api/tests/key-rotation-fault-injection.integration.spec.ts` and `apps/api/tests/administrative-recovery-fault-injection.integration.spec.ts` (FR-013, FR-017, FR-018, FR-019, FR-025, SC-006).
- [ ] T080 [P] [US5] Add responsive Playwright rotation/recovery journeys for due warnings, write blocks, progress/resume, safe failures, kit replacement, import rejection, reauthorization, and accessible confirmation in `tests/e2e/security-rotation.spec.ts` (FR-017, FR-019, FR-025, FR-026, FR-027).

### Implementation for User Story 5

- [ ] T081 [US5] Implement authenticated recovery-kit replacement, one-time download/confirmation, active-kit continuity, epoch advance, supersession/revocation, and recent-authentication gates in `apps/api/src/security/recovery-kit-service.ts`, `packages/database/src/repositories/security/recovery-kit-repository.ts`, and `apps/api/src/routes/security-recovery.ts` (FR-016, FR-018).
- [ ] T082 [US5] Implement compatible administrative recovery only as a protected local-CLI operation (never a session admin-recovery route) into an empty/uninitialized target with atomic source-lineage, installation, owner, workspace, content, history, file, and mutation identity adoption plus device trust reset in `apps/api/src/security/administrative-recovery-service.ts`, `apps/api/src/admin/security-commands.ts`, `packages/database/src/repositories/security/recovery-import-repository.ts`, and `packages/database/src/repositories/security/identity-adoption-repository.ts` (FR-001, FR-019, FR-020, FR-024, SC-005).
- [ ] T083 [US5] Implement the independent external wrapping-key rotation state machine across exactly the eight policy states, root-key-only rewrap operation, operation ID, checkpoint cursor, due/emergency mode, 365-day/7-day policy, and command handler in `packages/domain/src/security/wrapping-key-rotation.ts`, `packages/database/src/repositories/security/wrapping-key-rotation-repository.ts`, and `apps/api/src/admin/commands/rotation-wrapping-key.ts` (FR-017, FR-025, FR-027).
- [ ] T084 [US5] Implement the independent workspace data-key generation rotation state machine across exactly the same eight policy states, progressive record/file-chunk rewriting, generation status, resumable checkpoints, configured due/write-block thresholds, and command handler in `packages/domain/src/security/data-key-rotation.ts`, `packages/database/src/repositories/security/data-key-rotation-repository.ts`, and `apps/api/src/admin/commands/rotation-data-key.ts` (FR-017, FR-018, FR-025, FR-027).
- [ ] T085 [US5] Implement startup and automated daily evaluation of both policies, due/overdue/emergency/write-block warnings, safe reads, transactional protected-write blocking, and explicit triggers in `apps/api/src/security/rotation-scheduler.ts`, `apps/api/src/security/rotation-policy-service.ts`, and `apps/api/src/routes/security-rotation.ts` (FR-025, FR-026, FR-027, SC-009).
- [ ] T086 [US5] Implement the supported redacted local CLI with help, JSON/text envelopes, protected stdin/file-descriptor input, dry-run/`--yes`, exit codes 0/2/3/4/5/6/7, key/integrity checks, local-only compatible recovery import, exact local-only `security compatibility inspect --target PATH --source PATH [--json] [--dry-run]` inspection without session creation or writes in dry-run, both rotation commands, migration status, and diagnostics in `apps/api/src/admin/security-cli.ts`, `apps/api/src/admin/command-parser.ts`, `apps/api/src/admin/command-output.ts`, and `apps/api/src/admin/security-commands.ts`; reject any session admin-recovery method, remote admin bearer/API route, API token, or placeholder admin auth (FR-019, FR-020, FR-021, FR-023, FR-035).
- [ ] T087 [US5] Record recovery attempts, epoch changes, rotation policy/operation/checkpoint changes, integrity failures, admin actions, and safe status output through `packages/domain/src/security/audit.ts`, `apps/api/src/security/audit-service.ts`, and `packages/database/src/repositories/security/audit-repository.ts` (FR-022, FR-023, FR-035).
- [ ] T088 [US5] Implement owner-facing recovery-kit replacement, rotation policy/progress, write-block, safe failure, and compatible-recovery status views in `apps/web/src/features/security/recovery-kit-panel.tsx`, `apps/web/src/features/security/key-rotation-panel.tsx`, `apps/web/src/features/security/security-settings.tsx`, and `apps/web/src/services/security-api.ts` (FR-016, FR-025, FR-026, FR-027, SC-008).
- [ ] T089 [US5] Run the independent recovery/rotation matrix and update `specs/002-owner-security-foundation/validation.md` with exact identity digests, valid/invalid import counts, separate wrapping/data-key operation IDs, ciphertext comparisons, interruption resumes, all sixteen rotation rows (eight states for each policy), safe-read results, write-block results, and SC-005/SC-006/SC-009 formulas (FR-017, FR-018, FR-019, FR-025, FR-026, FR-027, SC-005, SC-006, SC-009).

**Checkpoint**: Recovery and the two key axes are independently observable, resumable, auditable, and fail closed; replacement preserves identity and requires explicit device reauthorization.

## Phase 8: User Story 6 — Migrate Safely and Deliver a Verifiable Installation (Priority: P1)

**Goal**: Complete staged plaintext migration and provide the official local Compose stack, reverse-proxy boundary, immutable image selection, single CI quality gate, and exact-SHA release publication.

**Dependency**: Starts after encrypted storage and recovery primitives are available; migration and delivery must preserve identities and never publish on incomplete evidence.

### Tests for User Story 6 (write first and make them fail)

- [ ] T090 [P] [US6] Add migration state-machine/property tests for capture boundary, resumable backfill, counts/digests/identity verification, plaintext-write stop, encrypted-read cutover, scrub/drop, monotonic checkpoints, and no premature completion in `packages/domain/tests/migration-state.property.spec.ts` (FR-028, FR-029, SC-010).
- [ ] T091 [P] [US6] Add database/API fault-injection tests for failures before backfill, during backfill, after verification, after plaintext-write stop, during encrypted-read cutover, and during scrub/drop in `packages/database/tests/security-migration.integration.spec.ts` and `apps/api/tests/security-migration-fault-injection.integration.spec.ts` (FR-028, FR-029, SC-010).
- [ ] T092 [P] [US6] Add Compose contract tests for `api`, `web`, `postgres`, durable `file-store`, health checks, startup dependencies, mounted secrets, loopback-only HTTP, persistent volumes, `.env.example`, local-build override, feature-002 baseline ownership, and feature-007 non-duplication in `tests/contract/compose-security.spec.ts` (FR-030, FR-031, FR-032, FR-035).
- [ ] T093 [P] [US6] Add negative delivery-gate tests proving failed, skipped, missing, cancelled, stale, and different-SHA checks block merge/publication, manual diagnostics never publish, the five named security jobs are individually observable and artifact-bearing, a work-branch push with no pull request runs no required gate and builds or publishes nothing, a pull-request candidate builds images without publishing and is refused package-write, and positive paths cover pull-request, `main`, and version-tag candidates in `tests/contract/release-gates.spec.ts` (FR-033, FR-034, FR-035, SC-007).
- [ ] T094 [P] [US6] Add image/release inspection tests for immutable commit-SHA and semantic-version tags, `linux/amd64`/`linux/arm64`, GHCR references, checksums, SBOM, provenance/attestation, least-privilege permissions, and no moving publication channel in `tests/contract/release-artifacts.spec.ts` (FR-032, FR-034, SC-007).

### Implementation for User Story 6

- [ ] T095 [US6] Implement the durable migration state machine and capture boundary in `packages/domain/src/security/migration.ts`, `packages/database/src/repositories/security/migration-repository.ts`, and `packages/database/src/repositories/security/migration-checkpoint-repository.ts` (FR-028, FR-029).
- [ ] T096 [US6] Implement resumable encrypted backfill of records and file blobs, deterministic counts/digests, and feature-001 canonical identity verification in `apps/api/src/security/migration-backfill-service.ts`, `packages/database/src/repositories/security/migration-source-repository.ts`, and `packages/blob-store/src/migration/encrypted-backfill.ts` (FR-024, FR-028, FR-029).
- [ ] T097 [US6] Implement verified plaintext-write stop, encrypted-read cutover, scrub/drop cleanup, restart recovery, and safe completion reporting in `apps/api/src/security/migration-orchestrator.ts`, `packages/database/src/repositories/security/migration-cutover-repository.ts`, and `packages/blob-store/src/migration/plaintext-cleanup.ts` (FR-028, FR-029, SC-010).
- [ ] T098 [US6] Implement feature 002’s official baseline Compose stack with `api`, `web`, `postgres`, durable `file-store`, health checks, dependency conditions, `127.0.0.1`-bound local HTTP, persistent volumes, mounted deployment secret, explicit immutable image selection, and no feature-007 duplicate in `compose.yaml` and `compose.override.yaml` (FR-030, FR-031, FR-032).
- [ ] T099 [US6] Document local HTTP, external HTTPS/reverse-proxy responsibility, trusted proxy/public origin headers, nginx/Caddy/Traefik examples, immutable image pinning, and rollback selection in `docs/deployment/reverse-proxy.md` and `.env.example` (FR-030, FR-031, FR-032).
- [ ] T100 [US6] Update the existing `.github/workflows/ci.yml` in place as feature 002’s single reusable `quality-gate`: trigger directly on `pull_request`, on `push` to `main`, and on `workflow_dispatch` for diagnostics, and expose `workflow_call` for version tags, with no non-`main` branch push trigger; set workflow-level permissions to `contents: read`; keep diagnostics gate-only with no publish job or package-write permission; run formatting, Biome, lint/static analysis, types, tests, migrations, production build, Compose/configuration, real-stack startup, and five separately observable blocking security jobs (`dependency-vulnerability-audit`→`dependency-audit.json`, `secret-scan`→`secret-scan.sarif`, `static-security-analysis`→`static-security.sarif`, `container-vulnerability-scan`→`container-scan.sarif`, `license-policy`→`license-policy.json`) on the exact candidate SHA, and make the aggregate fail for failed/skipped/missing/cancelled/stale/artifact-less jobs (FR-033, FR-034, FR-035).
- [ ] T101 [US6] Add the blocking `build-images` gate job to `.github/workflows/ci.yml`: build `docker/api.Dockerfile` and `docker/web.Dockerfile` for `linux/amd64` and `linux/arm64` from the committed lockfile and pinned base image digests with no `--push`, emit `image-build.json` recording per-platform digests, then run `container-vulnerability-scan` on the built images; the job MUST run on every candidate including `pull_request`, MUST publish nothing, and MUST hold no `packages: write` permission so an attempted registry write fails on permission (FR-032, FR-033, FR-034, SC-007).
- [X] T102 [US6] Add the `publish-commit-images` job to `.github/workflows/ci.yml` with `needs: quality-gate`, the guard `if: github.ref == 'refs/heads/main' && needs.quality-gate.result == 'success'`, and `packages: write` granted to this job alone; publish immutable commit-addressable images to GHCR for the exact commit the gate evaluated, inside the same workflow run as that gate, with no second gate execution and no `workflow_run` or other indirect completion trigger (FR-032, FR-033, FR-034, FR-035, SC-007).
- [ ] T103 [US6] Add `.github/workflows/release.yml` triggered only by strict `^v[0-9]+\.[0-9]+\.[0-9]+$` version tags, with no `main` trigger since `ci.yml` already publishes commit images for `main`; make its first `quality-gate` job call `./.github/workflows/ci.yml` at the tag commit, export reusable `candidate_sha = github.sha`, compare it to release `github.sha`, and make every publication job depend on a successful, non-stale, exact-SHA gate plus all five security artifacts, with failed/skipped/missing/cancelled/mismatched gates blocking all publication, without an indirect workflow-completion trigger or a second logical gate (FR-032, FR-033, FR-034, FR-035).
- [ ] T104 [US6] Configure protected-branch required-check and stale/missing-check enforcement for the single aggregate gate in `.github/rulesets/main.json`, without adding a duplicate quality-gate workflow (FR-033, FR-034).
- [ ] T105 [US6] Run the six migration fault checkpoints and update `specs/002-owner-security-foundation/validation.md` with source retention, last safe state, read/write mode, cleanup, identity digest, and completion evidence; accept SC-010 only after verified cleanup (FR-028, FR-029, SC-010).
- [ ] T106 [US6] Execute the exact SC-008 usability protocol with exactly 10 pseudonymous participants `P01`–`P10`: show the implemented security screens, give identical task wording without facilitator explanation, score owner/no-second-account, sessions/devices and revocation, recovery readiness, and unreachable-device erasure limitation, record facilitator-explanation yes/no and each 0–4 result, and accept only at least 9 independent four-of-four successes in `specs/002-owner-security-foundation/validation.md` (FR-001, FR-008, FR-010, FR-015, SC-008).
- [ ] T107 [US6] Run Compose, migration, local-checks/pull-request/`main`/tag, manual-diagnostic, work-branch-push-without-gate, pull-request image-build-without-publication, `main` publication, exact-SHA, negative-gate, five-security-job/artifact, image, checksum, SBOM/provenance, GHCR, and rollback evidence: pin a prior compatible immutable image, restore it through Compose, verify health and persisted data, and fill every delivery/release ledger field in `specs/002-owner-security-foundation/validation.md`—candidate type/SHA, required checks, failed/skipped/missing/cancelled/stale result, exact-SHA result, publication result, all five security artifacts plus `image-build.json`, artifact digests/checksums/SBOM/provenance, current/prior image refs and digests, pre/post persisted-data digests, Compose image selection, pre/post health, rollback result, raw artifact, reviewer, date, and status—keeping SC-007 pending unless every required result and artifact is recorded (FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, SC-007).

> **Deferral (owner decision)**: the vulnerability-scanning half of T100 and
> T101 — dependency audit, secret scan, static security analysis, license
> policy, and the container scan — is postponed until the application is
> functionally complete, so it lands against something worth auditing rather
> than blocking construction. Already implemented and merged: the reusable
> `quality-gate` with its four invocation paths, the blocking multi-architecture
> `build-images` job, and T102's commit-addressable GHCR publication. The
> `pnpm security:audit|secrets|static|licenses` scripts exist and run by hand.
> T100 and T101 stay unchecked until their scanning jobs are wired in.

**Checkpoint**: Plaintext is scrubbed only after verified cutover, the official stack is complete and loopback-bound, and release publication is impossible without the exact successful single quality gate.

## Phase 9: Polish, Full Gates, Analysis, and Convergence

**Purpose**: Run the complete repository-quality and evidence handoff checks after all user stories.

- [ ] T108 [P] Run cross-feature integration/regression tests for authenticated content access, encrypted payloads, files, relationships, revisions, mutations, reconciliation, offline local projection, and canonical identity preservation in `tests/integration/security-content-regression.spec.ts`, `tests/e2e/security-content-regression.spec.ts`, and `tests/e2e/offline-reconciliation.spec.ts` (FR-011, FR-012, FR-024, SC-004, SC-005).
- [ ] T109 [P] Run Biome formatting/checking without modifying files and validate TypeScript, shell, contract, migration, Compose, and release artifacts using `package.json`, `biome.jsonc`, `scripts/ci/check-shell.ts`, `tests/contract/security-api.spec.ts`, `tests/contract/compose-security.spec.ts`, and `tests/contract/release-gates.spec.ts` (FR-033, FR-035, SC-007).
- [ ] T110 Run the complete local gate—`pnpm toolchain:check`, `pnpm format:check`, `pnpm lint:ci`, `pnpm shell:check`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:property`, `pnpm test:integration`, `pnpm test:contract`, `pnpm db:test-migrations`, `pnpm test:e2e`, `pnpm build`, `docker compose config`, and `docker compose up -d --wait`—and record every raw result in `specs/002-owner-security-foundation/validation.md` (FR-030, FR-033, FR-035, SC-007).
- [ ] T111 Run the exact SpecKit Analyze workflow from `.agents/skills/speckit-analyze/SKILL.md` against `specs/002-owner-security-foundation/spec.md`, `specs/002-owner-security-foundation/plan.md`, and `specs/002-owner-security-foundation/tasks.md`; resolve high-impact inconsistencies without editing feature-001 artifacts (FR-024, FR-035).
- [ ] T112 Run the convergence workflow from `.agents/skills/speckit-converge/SKILL.md` against `specs/002-owner-security-foundation/spec.md`, `specs/002-owner-security-foundation/plan.md`, `specs/002-owner-security-foundation/tasks.md`, and `specs/002-owner-security-foundation/validation.md`; append and complete only genuinely remaining work (FR-035, SC-001, SC-007, SC-010).
- [ ] T113 Review `specs/002-owner-security-foundation/validation.md` for one normalized row for each FR-001–FR-035 and SC-001–SC-010 using only the seven canonical column names (`Requirement/criterion`, `Command or test path`, `Candidate SHA`, `Controlled clock/configuration`, `Raw evidence/artifact`, `Reviewer/date`, `Status`), require a complete run-metadata block, raw command/configuration/SHA/artifact/reviewer/date evidence, exactly seven recovery pairs, exactly sixteen rotation rows, and leave any unrun criterion `pending` or `blocked`, never `pass` (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-007, SC-008, SC-009, SC-010).
- [ ] T114 Verify the final worktree and task checklist contain no scheduled edits to feature-001 specification artifacts, and record the review in `specs/002-owner-security-foundation/validation.md` (FR-001, FR-024).
- [ ] T115 Complete the normalized validation-ledger handoff in `specs/002-owner-security-foundation/validation.md`: populate run metadata (`Candidate commit SHA`, branch, dirty-before-run flag, Node/pnpm versions, Docker/Compose versions, database/storage fixture, deployment wrapping-key fixture ID, controlled-clock version, overall status), exactly one functional row for each FR-001–FR-035 and exactly one success-criterion row for each SC-001–SC-010 using only the seven canonical column names in order (`Requirement/criterion`, `Command or test path`, `Candidate SHA`, `Controlled clock/configuration`, `Raw evidence/artifact`, `Reviewer/date`, `Status`) with no renamed synonym, the 20-trial/5-operator SC-002 table, the 10-participant SC-008 table, all seven recovery state-axis pairs, exactly sixteen rotation rows (eight states for each policy), all six migration fault rows, all four delivery candidates, the full image-selection/rollback row, and the evidence-review row with raw command/configuration/SHA/artifact/reviewer/date/status fields; leave unrun evidence `pending` or `blocked`, never `pass` (FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-024, FR-025, FR-026, FR-027, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, SC-001, SC-002, SC-003, SC-004, SC-005, SC-006, SC-007, SC-008, SC-009, SC-010).

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** has no feature dependency and prepares the pinned toolchain, fixtures, configuration, and delivery scaffolding.
- **Foundational (Phase 2)** depends on Setup and blocks every story; crypto, redaction, singleton, repository, contract, and policy primitives must pass first.
- **US1 (Phase 3)** depends only on the foundation and is deliberately session-free; it must establish owner/workspace/recovery readiness before any session-dependent flow.
- **US2 (Phase 4)** depends on US1 and provides the coherent authenticated session boundary.
- **US4 (Phase 5)** depends on US2 for protected owner operations and uses the foundation/US1 recovery primitives; it protects server/local content.
- **US3 (Phase 6)** depends on US2 and US4 for authenticated device and local-key behavior.
- **US5 (Phase 7)** depends on US2, US3, and US4 for recent authentication, device reset, encrypted generations, and kits.
- **US6 (Phase 8)** depends on US4 and US5 for encrypted destinations, migration identity checks, and delivery/recovery contracts.
- **Polish (Phase 9)** depends on all six stories and is the final local-gate, Biome, contract, SpecKit Analyze, convergence, and evidence phase.

### Task-ID dependency gates

- `T001–T007 → T008–T023`: setup artifacts and fixtures precede foundational tests and implementations.
- `T008–T023 → T024–T036`: contracts, crypto, redaction, scoped persistence, and policy primitives precede session-free bootstrap.
- `T024–T036 → T037–T049`: US1 must establish confirmed recovery readiness before any session-dependent owner flow.
- `T037–T049 → T050–T062`: authenticated owner operations precede protected server/local data and recovery-material integration.
- `T050–T062 → T063–T072`: encrypted local storage precedes device-key binding and device reauthorization.
- `T063–T072 → T073–T089`: device trust reset, recent authentication, encrypted generations, and kit primitives precede recovery import and rotations.
- `T073–T089 → T090–T107`: recovery/rotation contracts and implementations precede migration, Compose, CI, GHCR, and rollback evidence.
- `T024–T107 → T108–T115`: all six story checkpoints precede cross-feature regression, full gates, analysis, convergence, and final ledger review.

### User-story dependency graph

```text
Foundational
    ↓
US1 session-free bootstrap/recovery readiness
    ↓
US2 authentication/sessions
    ↓
US4 content/local protection
    ↓
US3 devices
    ↓
US5 authenticated recovery + independent rotations
    ↓
US6 staged migration + Compose + CI/release delivery
    ↓
Full gates + Analyze + convergence/evidence
```

### Parallel opportunities

- Setup tasks T002–T005 are parallel only across their distinct file boundaries; T006 follows the script/configuration decisions.
- Foundational tests T008–T012 can run in parallel, then T013–T021 proceed in dependency order.
- Within each story, the marked test tasks can run in parallel; implementation follows tests and is ordered domain → repository/service → route/CLI → web → evidence.
- US5 wrapping-key and data-key tests/implementations (T077/T083 and T084) are parallel across separate state machines, while T085 and T089 depend on both.
- US6 migration tests and Compose/release contract tests (T090–T094) can run in parallel before their separate implementations.
- T108 and T109 can run in parallel after all story checkpoints; T110–T115 are sequential evidence and governance gates.

## Implementation Strategy

### MVP first

1. Complete Setup and Foundational.
2. Complete US1 and stop at its checkpoint.
3. Validate exactly one owner/workspace, session-free bootstrap, provisional recovery, SC-001, and the exact SC-002 20-trial/5-operator protocol before expanding the authenticated surface.

### Incremental delivery

1. Add US2 for passkey/password authentication and revocable sessions.
2. Add US4 for server/local encryption and fail-closed protected content.
3. Add US3 for device inventory, revocation, and explicit reauthorization.
4. Add US5 for authenticated recovery, separate wrapping/data-key rotation, due/overdue/emergency/write-block policy, and admin commands.
5. Add US6 for migration, Compose, external reverse-proxy documentation, exact-SHA CI, and multi-architecture GHCR release publication.
6. Complete the full local gate, Biome, contract validation, SpecKit Analyze, convergence, and evidence review.

### Independent test criteria by story

- **US1**: Fresh bootstrap succeeds without a session; repeated/concurrent/interrupted/invalid-key attempts cannot create a second or usable partial owner; provisional recovery is one-time and readiness requires confirmation (FR-001, FR-002, FR-015, FR-016, SC-001, SC-002).
- **US2**: Passkey-only and password-alternative login succeed; bounds, recent auth, cookies, CSRF, rate limits, and one/all-session revocation are enforced without disclosure (FR-003–FR-007, FR-022, FR-023, SC-003).
- **US3**: Required device fields are visible; rename/limit changes preserve canonical identities; revoked devices cannot renew/sync/receive data and unreachable erasure is stated honestly (FR-008–FR-010, FR-024, SC-003, SC-008).
- **US4**: Every FR-011/FR-012 category is encrypted at rest; invalid material fails closed; external key custody, artifact separation, and feature-001 identity preservation hold (FR-011–FR-016, FR-023, FR-024, SC-004).
- **US5**: Valid recovery preserves all IDs only into an empty target; invalid kits/targets fail; wrapping and data-key rotations remain separate and resumable with policy enforcement (FR-017–FR-027, SC-005, SC-006, SC-009).
- **US6**: Migration reaches verified cleanup through all fault checkpoints; Compose is complete and loopback-bound; exact-SHA gates block unsafe merge/publication and publish only immutable required artifacts (FR-028–FR-035, SC-007, SC-010).

## Notes

- Every task is a checkbox with a sequential ID; `[P]` appears only where the task has a distinct file boundary and no dependency on incomplete work.
- `[US1]`–`[US6]` labels map to the six stories in `specs/002-owner-security-foundation/spec.md`; setup, foundational, and polish tasks intentionally have no story label.
- Every actionable task names one or more exact repository-relative file paths. Feature-001 identities are referenced, tested, and preserved; feature-001 artifacts are never scheduled for editing.

## Requirement traceability (FR-001..FR-035 and SC-001..SC-010)

Each row below is an explicit reference to the normative requirement in
`specs/002-owner-security-foundation/spec.md` and to the validation ledger in
`specs/002-owner-security-foundation/validation.md`. The task IDs resolve to
the exact implementation, test, workflow, or evidence paths above.

| Requirement | Normative source | Traceable task IDs |
| --- | --- | --- |
| FR-001 | `spec.md` §Requirements; `validation.md` FR-001 | T007, T010, T018, T019, T026, T029, T031, T032, T036, T082, T106, T114, T115 |
| FR-002 | `spec.md` §Requirements; `validation.md` FR-002 | T013, T021, T024, T025, T027, T028, T029, T030, T032, T034, T036, T115 |
| FR-003 | `spec.md` §Requirements; `validation.md` FR-003 | T013, T030, T037, T040, T041, T042, T046, T047, T115 |
| FR-004 | `spec.md` §Requirements; `validation.md` FR-004 | T033, T037, T040, T041, T043, T046, T047, T115 |
| FR-005 | `spec.md` §Requirements; `validation.md` FR-005 | T037, T042, T043, T046, T047, T115 |
| FR-006 | `spec.md` §Requirements; `validation.md` FR-006 | T013, T021, T037, T038, T039, T040, T041, T042, T043, T044, T045, T046, T047, T115 |
| FR-007 | `spec.md` §Requirements; `validation.md` FR-007 | T021, T037, T038, T040, T041, T044, T045, T046, T115 |
| FR-008 | `spec.md` §Requirements; `validation.md` FR-008 | T013, T063, T064, T065, T066, T067, T069, T071, T072, T115 |
| FR-009 | `spec.md` §Requirements; `validation.md` FR-009 | T063, T064, T065, T066, T068, T069, T070, T071, T072, T115 |
| FR-010 | `spec.md` §Requirements; `validation.md` FR-010 | T063, T066, T068, T069, T071, T072, T115 |
| FR-011 | `spec.md` §Requirements; `validation.md` FR-011 | T009, T015, T019, T050, T051, T054, T055, T056, T057, T062, T108, T115 |
| FR-012 | `spec.md` §Requirements; `validation.md` FR-012 | T002, T052, T054, T058, T062, T108, T115 |
| FR-013 | `spec.md` §Requirements; `validation.md` FR-013 | T004, T016, T027, T053, T060, T062, T079, T115 |
| FR-014 | `spec.md` §Requirements; `validation.md` FR-014 | T009, T011, T014, T015, T016, T018, T020, T023, T027, T036, T050, T051, T052, T053, T055, T056, T058, T060, T062, T079, T115 |
| FR-015 | `spec.md` §Requirements; `validation.md` FR-015 | T009, T014, T024, T025, T027, T028, T029, T031, T032, T033, T034, T036, T059, T078, T081, T115 |
| FR-016 | `spec.md` §Requirements; `validation.md` FR-016 | T014, T024, T025, T027, T028, T029, T032, T033, T036, T054, T059, T078, T081, T088, T115 |
| FR-017 | `spec.md` §Requirements; `validation.md` FR-017 | T003, T009, T014, T015, T019, T051, T077, T079, T083, T084, T089, T115 |
| FR-018 | `spec.md` §Requirements; `validation.md` FR-018 | T014, T015, T018, T077, T078, T079, T081, T083, T084, T115 |
| FR-019 | `spec.md` §Requirements; `validation.md` FR-019 | T013, T020, T073, T078, T079, T082, T086, T115 |
| FR-020 | `spec.md` §Requirements; `validation.md` FR-020 | T008, T022, T073, T082, T086, T115 |
| FR-021 | `spec.md` §Requirements; `validation.md` FR-021 | T008, T022, T073, T086, T115 |
| FR-022 | `spec.md` §Requirements; `validation.md` FR-022 | T012, T017, T019, T020, T034, T048, T061, T072, T087, T115 |
| FR-023 | `spec.md` §Requirements; `validation.md` FR-023 | T008, T012, T013, T015, T016, T017, T020, T032, T037, T039, T040, T042, T043, T045, T046, T053, T060, T061, T069, T073, T086, T115 |
| FR-024 | `spec.md` §Requirements; `validation.md` FR-024 | T002, T007, T010, T011, T018, T019, T020, T021, T029, T031, T055, T057, T058, T059, T064, T065, T067, T068, T070, T082, T108, T111, T114, T115 |
| FR-025 | `spec.md` §Requirements; `validation.md` FR-025 | T003, T013, T018, T074, T075, T083, T084, T085, T088, T089, T115 |
| FR-026 | `spec.md` §Requirements; `validation.md` FR-026 | T018, T074, T075, T076, T080, T085, T088, T089, T115 |
| FR-027 | `spec.md` §Requirements; `validation.md` FR-027 | T003, T018, T074, T076, T080, T083, T084, T085, T088, T089, T115 |
| FR-028 | `spec.md` §Requirements; `validation.md` FR-028 | T009, T013, T019, T090, T091, T095, T096, T097, T105, T115 |
| FR-029 | `spec.md` §Requirements; `validation.md` FR-029 | T003, T011, T090, T091, T095, T096, T097, T105, T115 |
| FR-030 | `spec.md` §Requirements; `validation.md` FR-030 | T004, T007, T092, T098, T099, T107, T110, T115 |
| FR-031 | `spec.md` §Requirements; `validation.md` FR-031 | T004, T092, T098, T099, T107, T115 |
| FR-032 | `spec.md` §Requirements; `validation.md` FR-032 | T004, T005, T007, T092, T094, T098, T099, T101, T102, T103, T107, T115 |
| FR-033 | `spec.md` §Requirements; `validation.md` FR-033 | T001, T002, T005, T006, T007, T093, T100, T101, T102, T103, T104, T107, T109, T110, T115 |
| FR-034 | `spec.md` §Requirements; `validation.md` FR-034 | T005, T007, T093, T094, T100, T101, T102, T103, T104, T107, T115 |
| FR-035 | `spec.md` §Requirements; `validation.md` FR-035 | T001, T002, T003, T006, T007, T008, T012, T013, T016, T017, T022, T032, T037, T042, T046, T061, T073, T086, T087, T092, T093, T100, T102, T103, T107, T109, T110, T111, T112, T113, T115 |
| SC-001 | `spec.md` §Success Criteria; `validation.md` SC-001 | T003, T025, T026, T028, T029, T031, T036, T115 |
| SC-002 | `spec.md` §Success Criteria; `validation.md` SC-002 | T035, T115 |
| SC-003 | `spec.md` §Success Criteria; `validation.md` SC-003 | T040, T049, T065, T072, T115 |
| SC-004 | `spec.md` §Success Criteria; `validation.md` SC-004 | T052, T053, T062, T108, T115 |
| SC-005 | `spec.md` §Success Criteria; `validation.md` SC-005 | T078, T082, T089, T108, T115 |
| SC-006 | `spec.md` §Success Criteria; `validation.md` SC-006 | T003, T077, T079, T083, T084, T089, T115 |
| SC-007 | `spec.md` §Success Criteria; `validation.md` SC-007 | T092, T093, T094, T101, T102, T107, T109, T110, T115 |
| SC-008 | `spec.md` §Success Criteria; `validation.md` SC-008 | T033, T041, T066, T071, T080, T088, T106, T115 |
| SC-009 | `spec.md` §Success Criteria; `validation.md` SC-009 | T003, T074, T075, T076, T077, T085, T089, T115 |
| SC-010 | `spec.md` §Success Criteria; `validation.md` SC-010 | T003, T090, T091, T097, T105, T115 |
