# Feature Specification: Complete server backups

**Feature Branch**: `codex/024-full-server-backups`
**Created**: 2026-09-05
**Status**: Specified
**Input**: The owner needs a complete database backup, beyond in-app exports,
in a directory before version migrations and every night, with the original
app version recorded and all data recoverable after an update or accidental damage.

## Product Direction, Dependencies and Scope

Refines canvas sections 4, 28 and 30–34, and strengthens feature 007's recovery
contract. Includes all application database state and durable attachment bytes,
version provenance, automatic scheduling, migration protection and independent
administrative restoration. Feature 007's portable content archive remains a
separate export format and retains its existing retention proofs.

Depends on the existing encrypted key hierarchy, file storage and administrative
commands. Delivery follows desktop and the UI skill and precedes historical file
encryption migrations and the owner's Notion import. No unrelated database,
operating-system backup, continuous replication or arbitrary point-in-time
recovery is included. Desktop cache backups are not a substitute for this server backup.

## User Scenarios & Testing

### User Story 1 — Recover the complete installation (Priority: P1)

The owner restores a backup into an empty isolated target with the external
recovery material and recovers all server-held data, including records that a
content export does not know how to enumerate.

**Why this priority**: Recovery must cover the actual installation, not merely
its visible pages.
**Independent Test**: Back up a populated installation, remove access to its
catalogue, restore elsewhere and compare all application records and file bytes.

**Acceptance Scenarios**:

1. **Given** pages, revisions, operations, databases, relationships, files,
   settings and security records, **when** a complete backup is restored,
   **then** all data at the backup boundary is recoverable with matching bytes
   and relationships, including records unknown to the content export.
2. **Given** the backup file and external recovery material but no original
   server or backup catalogue, **when** the owner inspects and restores it,
   **then** provenance, integrity and compatibility can be verified independently.
3. **Given** a wrong key, corruption or an incompatible format, **when** restore
   is requested, **then** it refuses before modifying the target.
4. **Given** a nonempty or active target, **when** restore is requested,
   **then** it refuses and identifies the need for a separate empty target.
5. **Given** a verified complete restore, **when** it is prepared for service,
   **then** historical device/session records do not silently restore trust to
   devices that may have been revoked since the backup; reauthorization preserves
   identity needed to reconcile newer offline work.

### User Story 2 — Protect the state before an update changes it (Priority: P1)

An update protects the existing state before the first migration and leaves a
recovery point identifying the version that created those data.

**Why this priority**: A backup made after modification cannot restore the prior state.
**Independent Test**: Start an update from an old schema with a failing backup;
no data, schema, version marker or workspace is created or modified.

**Acceptance Scenarios**:

1. **Given** an existing installation and a pending migration or app-version
   change, **when** update starts, **then** a complete verified backup is durable
   before any migration or schema-dependent initialization begins.
2. **Given** an old installation with no recorded application version, **when**
   it is backed up, **then** provenance says V0 with unknown exact version and
   records the actual schema inventory; it never substitutes the new app version.
3. **Given** a backup failure or interrupted dump, **when** the guard finishes,
   **then** migration has not started and the prior verified backup remains available.
4. **Given** a genuinely empty database, **when** initial installation begins,
   **then** it can initialize without claiming a backup of nonexistent data.

### User Story 3 — Obtain a verified backup every night (Priority: P1)

The owner gets a complete backup every day at 04:00 in the configured time zone,
with retries and missed-run recovery rather than an unnoticed gap.

**Why this priority**: Accidental edits need protection between version updates.
**Independent Test**: Advance a controlled clock through success, failure,
restart and daylight-saving boundaries and inspect complete-backup results.

**Acceptance Scenarios**:

1. **Given** a running server, **when** the daily deadline arrives, **then** one
   verified complete backup is created in the configured directory.
2. **Given** a failed run, **when** its retry delay elapses, **then** it retries
   that day; a failed attempt never counts as a successful daily backup.
3. **Given** downtime spanning a deadline, **when** the server restarts,
   **then** it catches up without waiting for the next night's deadline.
4. **Given** a successful local backup and failed remote transfer, **when** the
   run ends, **then** the local verified copy remains, remote failure is explicit
   and subsequent attempts can restore remote protection.
5. **Given** no complete verified backup for 26 hours, **when** the owner uses
   the app, **then** its backup warning cannot be cleared by a portable export.

### User Story 4 — Inspect and rehearse recovery (Priority: P2)

The owner lists versions and verification results from the command line and
backup settings, then rehearses restoration without changing the live server.

**Why this priority**: Recovery needs evidence before an incident.
**Independent Test**: Inspect a directory and run a real isolated restore;
compare the live server before and after and inspect the recorded rehearsal.

**Acceptance Scenarios**:

1. **Given** multiple backups and partial files, **when** listing backups,
   **then** source versions, dates and verified outcomes are clear and partial
   files are never reported as valid recovery points.
2. **Given** a compatible backup, **when** a rehearsal completes, **then** the
   record states actual restoration and integrity outcomes without secrets.
3. **Given** an interrupted rehearsal, **when** status is read, **then** it
   reports incompletion and never a healthy restored installation.

### Edge Cases

- Concurrent page changes, attachment finalization, deletion and scheduled/manual backups.
- An upload interrupted before the snapshot must retain its committed resumable prefix.
- Full disk, process termination, wrong key, truncated ciphertext and same-length corruption.
- Archive paths escaping the target, symlinks, duplicate components and unexpected files.
- Unknown source version, an old schema without backup tables and a lost backup catalogue.
- Clock changes, daylight-saving transitions and restarts before the next 04:00 deadline.
- Remote unavailability and retention while only one verified recovery point remains.

## Requirements

### Functional Requirements

- **FR-001**: Capture every application database record and required file byte,
  including history, page-operation state, structured databases, security/key
  envelopes and settings, independently of the current content export model.
- **FR-002**: Represent a coherent boundary between database references and file
  bytes; preserve resumable uploads at their committed prefix.
- **FR-003**: Encrypt backup content and metadata before persistence outside the
  live stores; never leave a decrypted dump in a temporary file after interruption.
- **FR-004**: Keep usable external decryption material and the owner's recovery
  kit separate; missing or wrong material must fail closed.
- **FR-005**: Include an authenticated manifest with component integrity,
  source application version or explicit V0/unknown, actual migration inventory,
  format versions and genuinely known source image/commit provenance.
- **FR-006**: Make the backup self-contained and inspectable/restorable without
  the original application catalogue.
- **FR-007**: Publish a final local artifact only after creation and verification
  succeed; partial artifacts must not look like valid backups.
- **FR-008**: Keep a verified local copy when remote transfer or verification fails;
  distinguish local protection from remote protection.
- **FR-009**: Verify a complete backup before any migration or initialization
  that mutates an existing database; failures block the update.
- **FR-010**: Inspect old schemas without requiring current business repositories
  or creating newer tables; empty installation detection must be read-only.
- **FR-011**: Record source version before migration and target version only after
  successful migration and integrity checks; never infer source from target.
- **FR-012**: Schedule complete backups daily at 04:00 in a configurable IANA
  time zone, using successful verification rather than attempt start as evidence.
- **FR-013**: Catch up missed deadlines on restart and retry failures with a
  bounded delay; concurrent CLI, scheduler and migration runs must coordinate.
- **FR-014**: Retain backups for three months by default, configurable, and never
  remove the latest verified recovery point or erase local protection on remote failure.
- **FR-015**: Restore through an administrative command into an explicit empty,
  isolated target after full key, integrity and compatibility validation.
- **FR-016**: Refuse active/nonempty targets, unsafe archive paths, symlinks,
  duplicate/unexpected components and incomplete artifacts before target writes.
- **FR-017**: Restore all durable data while requiring explicit security
  reactivation; preserve device identities for newer offline work without
  silently restoring old session authority.
- **FR-018**: Expose source version, dates, verification, transfer and rehearsal
  outcomes in CLI and dedicated backup settings, without secrets or private content.
- **FR-019**: Base the 26-hour stale warning on complete backup protection;
  portable export success must not masquerade as a complete backup.
- **FR-020**: Support real isolated rehearsals and record their date/outcome,
  with incomplete restoration reported accurately and the live server untouched.
- **FR-021**: Ship all required backup/restore capabilities in the official server
  and migration runtime, including both supported server architectures.

### Key Entities

- **Complete backup**: Immutable encrypted recovery artifact, identity and integrity evidence.
- **Source provenance**: Installed app/schema/format identity, with explicit unknown values.
- **Backup outcome**: Creation, local verification, remote verification and failure stages.
- **Daily deadline**: Zoned schedule and last completed protection boundary.
- **Restore rehearsal**: Backup identity, isolated target and actual verification result.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A real restoration recovers 100% of seeded application records,
  identities, relationships and file bytes, including an unrecognized data table.
- **SC-002**: Every injected backup failure before migration leaves the source
  schema and data unchanged; no newer version marker is written.
- **SC-003**: All corrupted, wrong-key and unsafe-target cases refuse before target writes.
- **SC-004**: Daily, retry, restart and clock-boundary cases produce verified
  protection without counting failed attempts or skipping missed deadlines.
- **SC-005**: Loss of the original catalogue does not prevent inspection and a
  successful isolated restoration with the external recovery material.
- **SC-006**: A failed remote transfer retains a verified local artifact and a
  visible remote failure; retention never deletes the final verified copy.

## Assumptions

- The server owns one application database; unrelated cluster databases and
  platform roles are outside the backup. Deployment prerequisites are documented.
- The user accepts source V0/unknown where early versions did not record provenance.
- Existing three-month retention and 04:00 schedule remain defaults.
- Restore targets are disposable/empty; replacing a running production target is
  a documented cutover after successful restoration, not an automatic destructive action.
- This work implements and tests recovery using generated fixtures. It does not
  restore over the owner's live data or import Notion data during development.

## MCP trust invalidation (feature013, 2026-09-05)

Complete archives retain MCP connection metadata and irreversible credential
digests. Activation revokes every restored MCP connection and consumes pending
exchange codes, alongside invalidating owner sessions and device trust. Older
archives without MCP tables remain restorable. The owner explicitly authorizes
new connections after recovery; historical access never resumes.
