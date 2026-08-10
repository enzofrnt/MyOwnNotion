# Feature Specification: Owner Security Foundation

**Feature Branch**: `codex/spec-update`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "Create the Owner Security Foundation feature defined by product-canvas sections 5, 8, 9, 28, 29, and 34 and roadmap entry 002."

## Product Direction, Dependencies, and Scope

This feature specifies the security foundation for the single-owner installation described by product-canvas sections 5 (owner boundary), 8 (authentication and sessions), 9 (authorized devices), 28 (encryption and key management), 29 (security and privacy), and 34 (administrative commands). It is roadmap feature 002, Owner security foundation.

Feature 001, [Canonical Content Foundations](../001-content-foundations/spec.md), is the dependency. This feature authenticates and protects the one workspace and its existing canonical pages, folders, files, placements, relationships, revisions, and local projections. It does not redefine, duplicate, or alter that canonical content model.

The feature covers exactly one owner per installation, secure first-run bootstrap, passkey and password authentication, sessions, authorized devices, application-level encryption at rest on the server and local devices, external deployment key material, an encrypted offline recovery kit, key rotation and revocation, and administrative recovery. Public sharing, MCP access, desktop clients, block-editor work, backup scheduling and transfer, and application implementation are excluded.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Establish the Sole Owner Securely (Priority: P1)

As the person operating a new installation, I can securely establish its one owner and protect the first access path so that no unclaimed or second identity can take ownership.

**Why this priority**: Every later content and security operation depends on an unambiguous owner and a recoverable initial setup.

**Independent Test**: Start with an empty installation and valid deployment key material, complete first-run setup with a passkey and recovery-kit confirmation, then verify that the owner can sign in and that a second first-run claim is rejected.

**Acceptance Scenarios**:

1. **Given** a fresh installation with valid externally supplied key material and no owner, **when** the first-run operator completes the protected bootstrap, **then** exactly one owner identity is established and the installation is not left in an unclaimed state.
2. **Given** first-run setup is in progress, **when** another request attempts to claim the installation or the bootstrap is interrupted, **then** no second owner is created and the installation remains either safely uninitialized or completely initialized.
3. **Given** the owner has enrolled a passkey and exported the encrypted recovery kit, **when** the owner confirms that the kit is stored offline, **then** setup is considered ready and the owner can continue to authentication.
4. **Given** the required deployment key material is absent or invalid, **when** first-run setup starts, **then** the installation refuses to become usable and explains the missing prerequisite without exposing key material.

### User Story 2 - Authenticate and Control Sessions (Priority: P1)

As the sole owner, I can sign in with a passkey by itself or with my password as an alternative, and I can control active sessions so that access remains convenient and revocable.

**Why this priority**: The owner needs a strong primary sign-in path while retaining a practical alternative and an immediate response to suspected session compromise.

**Independent Test**: Sign in using each supported method, exercise inactivity expiry and recent-authentication requirements, then revoke one session and all sessions and verify their access ends.

**Acceptance Scenarios**:

1. **Given** an enrolled passkey and no password entry, **when** the owner completes passkey authentication, **then** a valid owner session is created without requiring a password or another factor.
2. **Given** a configured password alternative, **when** the owner signs in with the password, **then** a valid owner session is created; an incorrect password or failed passkey attempt does not reveal which protected account data exists.
3. **Given** an inactive owner session, **when** its configured inactivity period elapses, **then** it can no longer access private content until the owner authenticates again. The default period is 30 days and the allowed configuration range is 1 to 90 days.
4. **Given** an operation that changes authentication methods, recovery material, key state, or global device access, **when** the owner's latest authentication is older than 15 minutes by default, **then** the operation requires recent re-authentication before proceeding.
5. **Given** several active sessions, **when** the owner revokes one session or all sessions, **then** the selected session or every selected session stops authorizing private access and cannot silently renew.
6. **Given** repeated abusive authentication attempts, **when** the threshold is reached, **then** further attempts are limited and the event is recorded without recording passwords, passkeys, tokens, or private content.

### User Story 3 - Manage Authorized Devices (Priority: P2)

As the sole owner, I can see and manage the devices authorized for my installation so that I can recognize, rename, monitor, and revoke access when a device is lost or no longer trusted.

**Why this priority**: Multiple devices are required for local-first use, but each additional copy of private data must remain attributable and revocable.

**Independent Test**: Authorize two devices, inspect their records, rename one, change its local storage limit from that device, revoke it, and verify that it cannot reconnect or receive new data until explicitly authorized again.

**Acceptance Scenarios**:

1. **Given** one or more authorized devices, **when** the owner opens device settings, **then** each device shows a name, platform, client type, authorization date, last activity, last synchronization, state, local-storage limit, and current local usage.
2. **Given** an authorized device, **when** the owner renames it or changes its local-storage limit from that device, **then** the updated value is shown without changing the identity of the owner or any canonical content.
3. **Given** an authorized device, **when** the owner revokes it, **then** it cannot sign in, renew a session, receive new content, or use its synchronization keys until a new authorization is completed.
4. **Given** a device is lost and never reconnects, **when** the owner views its revoked status, **then** the owner is clearly told that data already stored on an inaccessible device cannot be guaranteed to have been remotely erased.

### User Story 4 - Protect Data and Maintain Recovery Material (Priority: P1)

As the sole owner, I can trust that private data stored by the server or a local device is encrypted by the application and that I have an offline recovery path without placing key material beside the protected data.

**Why this priority**: Encryption and recovery are prerequisites for treating self-hosted and offline copies as private rather than merely relying on host or volume protection.

**Independent Test**: Store representative workspace data and local pending operations, inspect persisted representations for absence of usable plaintext, restart with missing or incorrect deployment key material, and restore access using a valid encrypted recovery kit.

**Acceptance Scenarios**:

1. **Given** server-persisted workspace data, **when** it is stored at rest, **then** page and block content, sensitive properties and relationships, files, content-revealing indexes, history, annotations, and recoverable integration secrets are protected by authenticated application-level encryption.
2. **Given** data retained by a local device, **when** it is stored at rest, **then** local content, files, indexes, and pending-operation data are protected by application-level encryption and the device-specific protection material is kept in the platform's secure storage when available.
3. **Given** encrypted data is read with missing, invalid, or unauthorized key material, **when** access is attempted, **then** the system fails closed, reports an integrity or configuration failure, and does not present partial or silently substituted data.
4. **Given** the installation is initialized, **when** the owner requests recovery material, **then** the system creates an encrypted kit that can be exported and stored offline, identifies its format and applicable installation, and does not automatically place it in the same storage as the encrypted workspace.
5. **Given** a newly generated recovery kit, **when** the owner has not confirmed offline storage, **then** the installation continues to warn that recovery setup is incomplete and does not claim security readiness.

### User Story 5 - Rotate Keys and Recover Administratively (Priority: P2)

As the owner or authorized hosting administrator, I can rotate or revoke security material and recover a locked installation through a documented, auditable process so that compromise and operational failure have a bounded response.

**Why this priority**: Long-lived installations need a tested response to suspected compromise, lost authentication methods, unavailable devices, and server replacement.

**Independent Test**: Perform a scheduled and an emergency key rotation, invalidate an old recovery method, interrupt and resume the operation, then use administrative recovery to restore a compatible installation while preserving the existing owner and canonical content identities.

**Acceptance Scenarios**:

1. **Given** active encrypted data and a valid current key set, **when** the owner performs a scheduled rotation or responds to suspected compromise, **then** new writes use the new key generation, old generations remain available only through the documented transition, and the operation is observable and resumable.
2. **Given** a replacement recovery kit or explicitly revoked recovery method, **when** the replacement becomes active, **then** the revoked kit cannot restore access, while historical encrypted backups remain recoverable through the documented wrapping and compatibility policy.
3. **Given** the required key material is unavailable, **when** an administrator runs a key-availability or integrity check, **then** the command reports a safe failure without displaying secrets and without marking the installation healthy.
4. **Given** a locked, damaged, or newly provisioned compatible installation, **when** an administrator follows the documented recovery procedure with the required external deployment secret and encrypted recovery kit, **then** the owner can regain access and existing canonical content identities remain unchanged.
5. **Given** an administrative operation that could change or destroy protected state, **when** it is requested without explicit confirmation or its simulation is not accepted, **then** no destructive action occurs.

### Edge Cases

- First-run setup is interrupted after an authenticator is enrolled but before recovery-kit confirmation; the installation must resume safely or roll back to an unclaimed state without leaving a usable partial owner.
- A second first-run request arrives concurrently with the first; at most one succeeds.
- The owner has only a passkey and loses access to the device that can use it; administrative recovery must not silently bypass encryption or create a second owner.
- A password alternative is disabled or changed while existing sessions remain active; recent-authentication and session-revocation rules still apply.
- A revoked device reconnects with a previously issued session or synchronization key; the connection and data delivery must be rejected.
- A revoked device never reconnects; the owner-facing limitation about remote erasure must remain visible.
- A local device has insufficient protected storage or loses access to its secure key store; the application must preserve existing data and explain whether local use is blocked, degraded, or awaiting reauthorization.
- A recovery kit is malformed, from another installation, superseded, or encrypted with the wrong protection material; no partial recovery is presented as successful.
- Rotation is interrupted at each persistence boundary; reopening must produce either the complete prior state or a complete resumable rotation state.
- A key is missing, corrupt, or unauthorized; encrypted data must not be replaced with empty or unencrypted values.
- Diagnostic output, audit entries, errors, and authentication-rate-limit events must not expose private content, passwords, passkeys, sessions, recovery kits, or encryption keys.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The installation MUST have exactly one owner identity and exactly one owner workspace; it MUST provide no second account, team member, private guest, role, or multi-owner path.
- **FR-002**: The installation MUST provide a protected first-run bootstrap that can be completed only once, must not be claimable concurrently by multiple requests, and must not become usable until required owner authentication and recovery readiness are complete.
- **FR-003**: The owner MUST be able to authenticate with a passkey sufficient by itself, without a password or additional factor, when a valid passkey is enrolled.
- **FR-004**: The owner MUST be able to use a password as an alternative authentication method, change it, and use it without weakening the passkey-only path.
- **FR-005**: The installation MUST allow the owner to add and remove passkeys and change authentication methods only after recent authentication.
- **FR-006**: Owner sessions MUST expire after 30 days of inactivity by default, support a configured inactivity period from 1 through 90 days, and require recent authentication no older than 15 minutes by default for sensitive operations.
- **FR-007**: The owner MUST be able to revoke one session or all sessions, and revoked sessions MUST stop authorizing private access and renewal.
- **FR-008**: The installation MUST maintain an owner-visible inventory of authorized devices containing name, platform, client type, authorization date, last activity, last synchronization, state, local-storage limit, and current local usage.
- **FR-009**: The owner MUST be able to rename, inspect, and revoke authorized devices; a revoked device MUST be denied sign-in, session renewal, new data, and future use of its synchronization keys until it is newly authorized.
- **FR-010**: The device-management experience MUST clearly distinguish device revocation from remote erasure and MUST state that data on a lost device that never reconnects cannot be guaranteed to be erased remotely.
- **FR-011**: The application MUST encrypt at rest on the server all sensitive workspace data, including page and block content, sensitive properties and relationships, files and attachments, content-revealing indexes, history and versions, annotations, and recoverable integration secrets.
- **FR-012**: The application MUST encrypt at rest on each local device the local content, files, indexes, and pending-operation data it retains; device-specific protection material MUST use the platform's secure storage when that facility is available.
- **FR-013**: Server key-encryption material MUST be supplied as an external deployment secret, remain outside the repository, application images, persisted encrypted data, and logs, and never be exposed as plaintext configuration when a supported secret mechanism is available.
- **FR-014**: Encrypted data MUST provide authenticated integrity protection and identify its encryption format and key generation; missing, invalid, corrupt, or unauthorized key material MUST cause a safe failure rather than partial or silently substituted data.
- **FR-015**: The installation MUST generate an encrypted recovery kit for the owner, make it exportable for offline storage, identify its format and applicable installation, keep it separate from the encrypted workspace by default, and require confirmation that it was stored before declaring recovery setup complete.
- **FR-016**: The owner MUST be able to replace the recovery kit after recent authentication; the installation MUST state which prior kits or recovery methods are invalidated and MUST preserve a documented path for historical encrypted backups that remain supported.
- **FR-017**: The key-encryption material MUST support scheduled rotation at least annually and immediate rotation after suspected compromise; rotation MUST be resumable, observable, integrity-protected, and must not require unsafe simultaneous plaintext exposure of all data.
- **FR-018**: Key revocation MUST prevent revoked key generations, device keys, sessions, and recovery methods from authorizing new access while preserving only the historical access explicitly allowed by the documented compatibility and restoration policy.
- **FR-019**: The installation MUST provide administrative recovery for a locked, damaged, replaced, or newly provisioned compatible installation using the required external deployment secret and encrypted recovery kit, without creating a second owner or changing canonical content identities.
- **FR-020**: The supported administrative command surface MUST include password reset, session revocation, data-integrity verification, key-availability verification without displaying keys, key rotation, documented recovery or repair, compatibility inspection, and redacted diagnostics; backup and restore operations MAY be invoked or tested only where a later backup feature provides them.
- **FR-021**: Administrative commands MUST provide built-in help, reliable success and failure status, and non-interactive operation where automation requires it; destructive commands MUST provide a simulation or require explicit confirmation.
- **FR-022**: Security events MUST be auditable, including authentication successes and failures, authentication-method changes, device authorization and revocation, session revocation, recovery-kit changes, key rotation and revocation, administrative recovery, and integrity failures.
- **FR-023**: Logs, diagnostics, errors, and audit records MUST exclude private content, passwords, passkeys, session or integration tokens, recovery kits, encryption keys, and other sensitive values unless a separate, explicit, redacted diagnostic action permits a safe summary.
- **FR-024**: All authentication, authorization, device, encryption, recovery, and administrative operations MUST preserve the single-owner boundary and MUST protect the existing feature-001 canonical content model without redefining its entities, identities, hierarchy, relationships, revisions, or local projections.

### Key Entities *(include if feature involves data)*

- **Installation**: One self-hosted product instance containing exactly one owner and one canonical workspace.
- **Owner identity**: The sole authenticated identity permitted to access the private installation and its feature-001 workspace.
- **Passkey credential**: An owner-controlled sign-in credential that is sufficient by itself and can be added or revoked by the owner.
- **Password credential**: An optional alternative owner sign-in method whose protected value can be changed or reset through the defined recovery paths.
- **Session**: A time-bounded authorization granted after owner authentication and independently revocable.
- **Authorized device**: A named client belonging to the owner, with observable activity and local-storage state, that may receive protected workspace data until revoked.
- **Encryption key generation**: A versioned set of protection material used to encrypt or wrap persisted server and local data, with an explicit lifecycle and revocation state.
- **Recovery kit**: An encrypted, versioned, offline-storable artifact containing the recovery material needed to restore authorized access to protected keys for the applicable installation.
- **Administrative recovery operation**: A controlled, auditable action performed by the hosting administrator to restore access or repair a compatible installation without introducing another owner.
- **Security audit event**: A redacted record of an authentication, authorization, device, recovery, key, integrity, or administrative security action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In fresh-install acceptance tests, 100% of successful bootstraps create exactly one owner, 100% of concurrent or repeated claims create no second owner, and 100% of interrupted bootstraps leave no usable partial owner.
- **SC-002**: At least 95% of test operators who have the required deployment secret can complete first-run owner setup, passkey enrollment, and recovery-kit export confirmation in 5 minutes or less without assistance.
- **SC-003**: Authentication acceptance tests achieve 100% success for passkey-only login and password-alternative login, and 100% of revoked sessions and devices are denied access and renewal on their next authorization attempt.
- **SC-004**: Encryption coverage tests find 0 usable plaintext values for every server and local data category listed in FR-011 and FR-012, and 100% of missing, incorrect, corrupt, or revoked-key cases fail closed.
- **SC-005**: In recovery tests, 100% of valid recovery kits restore owner access to the applicable encrypted key material without changing any feature-001 canonical content identity, while 100% of invalid, superseded, or cross-installation kits are rejected without partial recovery.
- **SC-006**: Scheduled and emergency rotation tests complete or resume successfully in 100% of injected interruption cases, use the new key generation for new protected data, and preserve 100% of data declared compatible with historical restoration.
- **SC-007**: 100% of required administrative command scenarios provide understandable help, a reliable success or failure result, and no secret or private-content disclosure in captured output; destructive scenarios perform 0 changes without confirmation.
- **SC-008**: In owner usability review, at least 90% of participants can identify the sole owner boundary, current sessions, authorized devices, recovery-kit readiness, and the remote-erasure limitation without facilitator explanation.

## Assumptions

- The installation owner is a single person or household operator; the product does not identify or manage additional people as accounts.
- Feature 001 supplies the canonical workspace and content model. This feature adds its security boundary around that model rather than replacing it.
- The owner can access at least one passkey-capable client during initial setup; the password alternative exists for a separately configured fallback path.
- The default session, recent-authentication, and key-rotation intervals are those stated in the product canvas unless an administrator documents a permitted configuration change.
- A local device may already contain protected data when it is disconnected or revoked; revocation controls future authorization and delivery but cannot guarantee physical erasure from an inaccessible device.
- Application-level encryption is required even when the host, filesystem, browser, or platform offers additional encryption.
- The deployment environment can supply server key-encryption material through an external secret mechanism. This material is not generated from ordinary persisted workspace data.
- Administrative recovery is an owner-installation operation performed by the hosting administrator under the documented procedure; it is not a second user identity and does not grant a separate private workspace.
- Backup scheduling, remote backup transfer, general restore orchestration, and update rollback are owned by roadmap feature 006. This feature specifies the recovery-kit and key-management contracts that feature 006 must honor.
- No public sharing, MCP, desktop client, block editor, or application implementation is required to validate this specification.

## Scope Boundaries

### Included

- Exactly one owner and one protected workspace per installation.
- Secure first-run bootstrap and recovery readiness.
- Passkey-only sign-in, password alternative, passkey/password management, session expiry, recent authentication, and session revocation.
- Authorized-device inventory, device settings, device revocation, and the honest remote-erasure limitation.
- Application-level encryption at rest for server and local protected data.
- External deployment secret handling, key generations, integrity failure behavior, key rotation, and key/recovery revocation.
- Encrypted offline recovery-kit generation, export, replacement, validation, and administrative recovery.
- Redacted security audit events and safe administrative command behavior.
- Compatibility with feature 001's canonical content model without redefining it.

### Excluded

- Public sharing, public annotations, and visitor access.
- MCP authorization or MCP client behavior.
- Windows or macOS desktop clients and native mobile clients.
- Block-editor behavior, rich editing, content-type changes, and canonical model changes.
- Backup scheduling, Google Drive or other remote backup transfer, general backup retention, and full update/rollback orchestration.
- Application implementation, technology selection, data schemas, code structure, or deployment scripts.
