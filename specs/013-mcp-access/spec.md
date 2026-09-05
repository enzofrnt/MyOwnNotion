# Feature Specification: MCP access before V1

**Feature Branch**: `codex/013-mcp-pre-v1`
**Created**: 2026-09-05
**Status**: Approved for implementation
**Input**: The owner requires usable MCP before V1.

## Product direction and clarification

Canvas sections 6, 26, 28–30, 42, 47 and 49 govern this feature. The owner's
2026-09-05 decision advances MCP into V1 without deferring settings or the
authorization journey. Features 002, 006, 019, 024 and 025 supply authentication,
canonical changes, the runtime, complete recovery and encrypted content.
There remains exactly one owner; an assistant connection is a delegated access,
never a second account. Public sharing and generic plugin execution are excluded.

## User Scenarios & Testing

### User Story 1 — Authorize and disconnect an assistant (P1)

The owner opens security settings, names a connection, selects explicit actions,
allowed content branches and file access, then generates an exchange code.
The assistant opens the authorization instructions and exchanges that code once.

**Independent Test**: Generate, exchange, inspect and revoke one connection.

**Acceptance Scenarios**:
1. Given recent owner authentication, creating a grant produces a code valid for
   ten minutes; concurrent exchange attempts yield exactly one persistent access.
2. Given an expired, consumed or revoked code, exchange reveals no access secret.
3. Given a connection, settings show its scope, expiry and status; revocation
   prevents the next authenticated request, including after server restart.
4. Given stale authentication or missing request-forgery protection, grant and
   revocation fail before changing authorization.

### User Story 2 — Work with permitted knowledge (P1)

An assistant lists permitted branches, searches, reads canonical items and reads
explicitly permitted file bytes. With separate permissions it creates pages or
folders, renames items, edits page blocks and moves items to the trash.

**Independent Test**: An actual protocol client performs each operation against
an encrypted workspace and sees the result in ordinary app content APIs.

**Acceptance Scenarios**:
1. A branch grant never reveals private ancestors, other branches, file metadata
   without file permission, or information about out-of-scope identifiers.
2. Search and read are separate permissions; all results are scope filtered.
3. Writes preserve canonical validation, revision history, idempotency,
   encryption, rotation blocks, maintenance locks and change notifications.
4. Editing a synchronized page preserves its operational history; a stale
   expected revision fails without replacing newer content.
5. Retrying the same change identifier does not apply it twice; another
   connection cannot use that identifier to retrieve the first one's result.

### User Story 3 — Recover and investigate access (P2)

The owner can inspect safe audit events by connection, renew access deliberately,
and recover the server without restoring historical trust.

**Acceptance Scenarios**:
1. Sensitive successful operations and refused attempts have connection identity,
   action, outcome and timestamp; no content or secret enters audit/logs.
2. Full restore activation revokes both pending exchange codes and persistent
   connections, including restorations from an archive with previously live tokens.
3. A new grant renews access; revoked credentials never become valid again.

### Edge Cases

Missing or invalid bearer, foreign Origin, unavailable deployment key, degraded
installation, concurrent hierarchy movement, removed branch roots, corrupt
ciphertext, malformed protocol messages, bounded file chunks, lost exchange
response, expired access, invalid change identity and full restore of old schemas.

## Requirements

- **FR-001**: Settings MUST create, list, inspect, renew and revoke scoped access
  with recent authentication for authorization changes.
- **FR-002**: Exchange codes MUST be unguessable, single use, valid for at most
  ten minutes and held only in protected or irreversible form at rest.
- **FR-003**: Dedicated access MUST expire after 90 days by default; the owner
  may select 1–90 days or explicitly acknowledge unlimited duration.
- **FR-004**: Search, read, create, edit and delete permissions MUST be independent.
  Allowed roots include descendants; an explicit whole-workspace choice is
  possible. Files require separate permission and permitted branch membership.
- **FR-005**: MCP MUST support actual interoperable remote tool discovery and
  calls and document setup without exposing owner sessions to assistants.
- **FR-006**: Every read and write MUST enforce current scope and installation
  health. Scope failures MUST not confirm an inaccessible item's existence.
- **FR-007**: Mutations MUST reuse canonical services and guards, preserve
  encryption, revisions and synchronization, and reject stale page edits.
- **FR-008**: Audits MUST identify the dedicated connection and safe action,
  without storing note text, file bytes, query text or credentials.
- **FR-009**: Revocation and expiry MUST reject the next request; recovery
  activation MUST invalidate restored access and pending exchanges.
- **FR-010**: Owner content remains usable offline. MCP requires the server and
  reports unavailability; it does not queue speculative mutations locally.
- **FR-011**: Setup MUST show clear French instructions and state, remain
  keyboard usable and fit narrow screens. Portable exports exclude credentials;
  full encrypted backups retain metadata but activation invalidates trust.

### Key Entities

Connection: opaque identity, owner/workspace, display label, scope, issuance,
expiry, revocation and last use. Exchange code: one-use proof bound to exactly
one connection. Audit: opaque connection reference, allowlisted action/outcome.

## Success Criteria

- **SC-001**: A documented client discovers and uses all advertised tools.
- **SC-002**: All expiry, revoke, branch isolation, stale-write and restore trust
  scenarios pass automated tests without leaked protected values.
- **SC-003**: The owner completes grant and revoke from settings at desktop and
  narrow viewports, with visible success/error state and keyboard controls.

## Assumptions

V1 uses dedicated bearer access following explicit owner approval; generic
third-party OAuth registration is excluded. The authorization page is the
settings destination with connection scope and exchange instructions. A lost
exchange response requires a new code; secrets are never recoverable from storage.
File access is read-only in this iteration; file import/replacement remains the
app's upload flow. Delete means reversible trash, never permanent purge.
