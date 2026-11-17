# Feature Specification: Multi-user accounts

**Feature Branch**: `058-multi-user-accounts`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Multi-user support for MyOwnNotion. On first launch, the app prompts to create an administrator account. After that, other people can create accounts. An account = email + password + pseudonym. Passkeys must keep working. Each user manages MCP access to their own notes only, never other users' notes."

## Product direction

This feature lifts the former permanent single-owner invariant. In the same
change:

- Constitution amended to 5.0.0 (principle I: isolated multi-account
  installations).
- Product canvas updated: §2 decision 1, §3, §5 (actors and isolation), §6.1,
  §8 (authentication), §26 (MCP per user), §28.4 (first launch), §32
  (pre-release migration reset), §43.

## Clarifications

### Session 2026-11-16

- Q: Amend constitution and canvas? → A: Yes, explicitly and clearly.
- Q: How are additional accounts created? → A: The administrator picks one of
  three registration modes: **closed** (only the administrator creates
  accounts), **invitation** (the administrator issues private links, manages
  them and sees their usage count and the accounts created through each), or
  **open** (anyone reaching the installation can sign up).
- Q: Existing data and migrations? → A: Nothing is in production. Existing
  development data is disposable; the migration history is replaced by one
  clean baseline migration.
- Q: Can users share private content with each other? → A: Not asked;
  assumed no. Each account is strictly isolated (see Assumptions).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrator bootstrap on first launch (Priority: P1)

On a fresh installation, the first visitor is asked to create the
administrator account with an email, a pseudonym and a password, and is
offered to register a passkey. Once completed, the installation is
configured and the administrator lands in their empty workspace.

**Why this priority**: Nothing else works without a first account.

**Independent Test**: Start a fresh installation, complete the form, sign
out, sign back in with email + password and with the passkey.

**Acceptance Scenarios**:

1. **Given** no account exists, **When** anyone opens the app, **Then** they
   see the administrator creation screen and no other screen.
2. **Given** valid email, pseudonym and password, **When** submitted,
   **Then** the administrator account exists, a session is open and a passkey
   registration is offered (skippable).
3. **Given** an administrator exists, **When** someone requests the bootstrap
   screen or its action, **Then** it is refused and they see the sign-in
   screen.
4. **Given** two browsers submit bootstrap concurrently, **Then** exactly one
   becomes administrator and the other is refused with a clear message.

---

### User Story 2 - Sign in with password or passkey (Priority: P1)

Any user signs in with email + password, or with one of their passkeys alone.

**Why this priority**: Core access; passkeys must keep working per user.

**Independent Test**: Two accounts, each with a passkey; each passkey opens
only its own account.

**Acceptance Scenarios**:

1. **Given** a user, **When** they enter correct email and password, **Then**
   they reach their own workspace.
2. **Given** a user with a registered passkey, **When** they choose passkey
   sign-in, **Then** they reach their own workspace without typing an email.
3. **Given** wrong credentials or unknown email, **Then** the same generic
   error is shown (no account enumeration) and abusive attempts are limited.
4. **Given** a signed-in user, **When** they add or remove a passkey or change
   their password in settings, **Then** it affects only their account and
   requires recent authentication.

---

### User Story 3 - Strict workspace isolation (Priority: P1)

Every page, folder, database, file, search result, backlink, graph,
synchronization stream, export and public share belongs to exactly one
account and is only reachable by that account (or publicly, if that account
explicitly shared it).

**Why this priority**: Multi-account is unsafe without it.

**Independent Test**: Users A and B each create content; B tries by UI,
search, direct identifiers, sync and API to reach A's content and fails
every time without learning that it exists.

**Acceptance Scenarios**:

1. **Given** A owns a page, **When** B requests it by identifier, **Then** B
   receives the same "not found" as for a nonexistent page.
2. **Given** A and B, **When** B searches for a word only in A's content,
   **Then** no result, snippet or count reveals it.
3. **Given** A's devices sync, **Then** B's devices never receive A's
   operations, files or metadata.
4. **Given** the administrator, **Then** they have no product path to read
   another account's content.

---

### User Story 4 - Per-user MCP access (Priority: P1)

Each user manages, from their own settings, the MCP accesses to their own
notes: create, scope, list, revoke. An MCP access acts only within its
owner's workspace.

**Why this priority**: Explicit user requirement.

**Independent Test**: A authorizes an MCP client; using it, attempt to read,
search, create in and modify B's content: all fail. B does not see A's MCP
accesses.

**Acceptance Scenarios**:

1. **Given** A creates an MCP access, **Then** it appears only in A's
   settings and its operations are audited under A.
2. **Given** an MCP access of A, **When** it targets content of B by any
   means, **Then** the server answers as if the content did not exist.
3. **Given** A revokes the access or A's account is disabled or deleted,
   **Then** the access stops working immediately.
4. **Given** the authorization page for an MCP temporary token, **Then** it
   requires the token's owner to be signed in; another account cannot
   complete it.

---

### User Story 5 - Registration modes and invitations (Priority: P2)

The administrator chooses the registration mode in installation settings:
closed, invitation or open. In closed mode the administrator creates accounts
directly. In invitation mode the administrator creates private links, each
with an optional maximum number of uses and optional expiry, can revoke them,
and sees for each link its use count and the accounts created through it. In
open mode a sign-up form is available to anyone.

**Why this priority**: Needed to have more than one account, but the
administrator can already create accounts in closed mode.

**Independent Test**: Switch each mode and verify which sign-up paths work.

**Acceptance Scenarios**:

1. **Given** closed mode (default), **Then** no public sign-up is shown and
   only the administrator can create an account (email, pseudonym, initial
   password).
2. **Given** invitation mode and a valid link, **When** a person opens it and
   submits email, pseudonym and password, **Then** the account is created and
   the link's use count increases and lists that account.
3. **Given** a link that is revoked, expired or exhausted, **Then** sign-up
   through it is refused with a clear message and creates nothing.
4. **Given** a link with one use left opened twice concurrently, **Then** at
   most one account is created.
5. **Given** open mode, **Then** a sign-up link is shown on the sign-in
   screen and anyone can create an account.
6. **Given** switching away from invitation mode, **Then** existing links stop
   working (and work again only if the mode returns to invitation and they
   are still valid).

---

### User Story 6 - Account administration (Priority: P3)

The administrator lists accounts (pseudonym, email, creation date, origin:
bootstrap / administrator / invitation / open, status), disables, re-enables
and deletes accounts, and can reset a user's password. Users edit their own
pseudonym and email.

**Independent Test**: Disable B → B's sessions, devices and MCP accesses stop;
re-enable restores sign-in; delete removes B and all B's content.

**Acceptance Scenarios**:

1. **Given** B is disabled, **Then** B's sessions, devices and MCP accesses
   are refused immediately and B cannot sign in.
2. **Given** deletion of B, **Then** it requires recent authentication and an
   explicit confirmation naming B, and removes B's content, files, passkeys,
   sessions and MCP accesses.
3. **Given** the administrator account, **Then** it cannot be disabled or
   deleted while it is the only administrator.

### Edge Cases

- Email already used (case-insensitive): refused with a message that does not
  disclose the account in open/invitation sign-up beyond what is needed.
- Pseudonym is not unique and is never used as a sign-in identifier.
- A passkey can belong to exactly one account.
- A public share of A reveals neither A's email nor other content.
- Backup and restore cover the whole installation (all accounts) and remain
  operator actions.
- Pre-release databases from older migration histories are not upgraded;
  starting on such a database fails clearly asking to reset it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST require creating an administrator account
  (email, pseudonym, password) when no account exists, and MUST refuse any
  further bootstrap once one exists.
- **FR-002**: An account MUST consist of a unique email (case-insensitive),
  a pseudonym (1–64 characters) and a password; passkeys MAY be added.
- **FR-003**: Users MUST be able to sign in with email + password or with a
  passkey alone; each passkey MUST be bound to exactly one account.
- **FR-004**: Every content object, file, index entry, sync operation, export,
  public share, MCP access and audit entry MUST belong to exactly one account.
- **FR-005**: No product path (UI, API, sync, search, graph, export, MCP,
  public share) MUST let an account read, infer or modify another account's
  private content; foreign identifiers MUST be indistinguishable from
  nonexistent ones.
- **FR-006**: Each user MUST manage their own MCP accesses (create with
  scopes, list, revoke) and an MCP access MUST only operate on its owner's
  content.
- **FR-007**: The administrator MUST choose a registration mode among
  closed (default), invitation and open.
- **FR-008**: In invitation mode, the administrator MUST be able to create,
  list and revoke links with optional maximum uses and expiry, and see each
  link's use count and created accounts; link secrets MUST be single-purpose,
  unguessable, stored protected and never logged.
- **FR-009**: The administrator MUST be able to create, disable, re-enable,
  delete accounts and reset a user's password; disabling or deleting MUST
  immediately invalidate that account's sessions, devices and MCP accesses.
- **FR-010**: Sensitive operations (auth methods, account deletion, MCP access
  creation, registration-mode change, invitation creation) MUST require recent
  authentication.
- **FR-011**: Authentication failures MUST NOT reveal whether an email exists;
  attempts MUST be rate-limited per account and per origin.
- **FR-012**: Users MUST be able to edit their own pseudonym and email
  (email change requires recent authentication).
- **FR-013**: The migration history MUST be replaced by one baseline that
  creates the multi-account schema; earlier development data is not migrated.
- **FR-014**: The interface MUST show the signed-in pseudonym and provide
  sign-out; administrator-only settings MUST be hidden from members and
  refused by the server.
- **FR-015**: Account and registration events (creation with origin,
  disable, delete, mode change, link creation/revocation/use) MUST be
  audited without secrets.

### Key Entities

- **Account**: email, pseudonym, password credential, role (administrator or
  member), status (active/disabled), origin, creation date.
- **Passkey**: credential bound to one account.
- **Registration settings**: installation-wide mode.
- **Invitation link**: secret, optional max uses, optional expiry, revoked
  flag, use count, accounts created through it, creator.
- **Workspace content** (pages, folders, databases, files, shares, MCP
  accesses, devices, sessions): each owned by exactly one account.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new administrator completes first-launch setup in under
  2 minutes.
- **SC-002**: An invited person creates an account from a link in under
  1 minute.
- **SC-003**: An isolation test suite attempting cross-account access through
  every product surface (UI, API, sync, search, graph, files, export, MCP,
  public share) records 0 successful accesses and 0 existence leaks.
- **SC-004**: After disabling or revoking, 100% of subsequent requests of the
  affected sessions or MCP accesses are refused.
- **SC-005**: Passkey sign-in succeeds for each account with its own passkey
  and never opens another account.

## Assumptions

- No private sharing or co-editing between accounts; only existing public
  sharing per account.
- Exactly one administrator role holder in this feature (the bootstrap
  account); promoting other administrators is out of scope.
- The administrator never sees other accounts' content; backups and recovery
  remain installation-wide operator actions.
- The installation-wide encryption keys and recovery kit stay as today,
  managed by the administrator; per-account encryption keys are out of scope.
- No outgoing email: no email verification and no self-service "forgot
  password"; the administrator resets passwords. Invitation links are shared
  by the administrator through their own channel.
- Default registration mode is closed (secure by default).
- Deleting an account deletes its content irreversibly after confirmation;
  installation backups remain the recovery path.
