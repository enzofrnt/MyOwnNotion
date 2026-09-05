# Feature Specification: Storage privacy and code coherence audit

**Feature Branch**: `codex/025-storage-coherence-audit`

**Created**: 2026-09-05

**Status**: Specified

**Input**: Owner requests a substantial code audit and correction of serious
inconsistencies before importing valuable Notion data. Existing privacy and
recovery promises must apply to real application flows, including attachments.

## Product direction and scope

This feature enforces product canvas sections 4, 8–9, 15–20, 28–29, 31–35,
39–44 and constitution principles I, III–VII. It does not change product scope.
Features 002 (owner security), 005 (files), 006 (sync), 007/024 (recovery),
009 (structured entries), 014 (desktop) and 017 (workspace UI) are direct audit
boundaries. Complete server backups from 024 precede any historical storage
migration. The UI quality skill from 023 applies to changed interactive flows.

The audit inventories server/client content boundaries, authentication and
recovery, migrations, synchronization, shared contracts, active styling and
native runtime composition. It records evidence and limits; a clean test run
alone is not a claim that every defect has been eliminated. Independent
reusable databases, syntax highlighting, MCP and Notion import retain their
own specifications and are excluded from this implementation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Keep attachments private on disk (Priority: P1)

The owner uploads, renames, previews, downloads and resumes attachments without
leaving readable content or sensitive names in persistent server storage.

**Why this priority**: Attachment privacy is already promised and is required
before transferring personal data into the application.

**Independent Test**: Use a secured installation to upload recognizable data
through both supported transfer paths, restart the server, read it back, and
inspect its persistent storage for readable source content and names.

**Acceptance Scenarios**:

1. **Given** an authorized device, **When** it uploads a file directly or in
   resumable parts, **Then** no acknowledged file bytes are persisted in clear
   text, and downloading after restart returns the original bytes.
2. **Given** an interrupted resumable upload, **When** the owner reconnects,
   **Then** the accepted offset is accurate, repeated parts cannot duplicate
   bytes, and completion verifies the entire file before reporting success.
3. **Given** a file referenced from several pages, **When** the owner renames it,
   **Then** every reference keeps the same file identity and the new and old
   sensitive names are absent from readable persistent content and history.
4. **Given** corrupted, swapped or missing stored file parts, **When** the owner
   opens the affected range, **Then** the application refuses unauthenticated
   bytes and reports an integrity failure without disclosing the content.
5. **Given** files written before and after a key rotation, **When** authorized
   reads and recovery are performed, **Then** both remain readable through the
   documented key history and revoked credentials still fail.

### User Story 2 - Upgrade existing storage without losing data (Priority: P1)

The owner upgrades a V0 installation containing files and interrupted uploads.
The upgrade preserves the contents and their identities while bringing the
stored data under the existing encryption policy.

**Why this priority**: Enforcing privacy on new writes must not strand old data.

**Independent Test**: Restore a historical fixture with shared attachments and
partial uploads, interrupt the upgrade at each durable stage, resume it and
compare all supported reads and references before and after.

**Acceptance Scenarios**:

1. **Given** historical readable storage, **When** the upgrade starts, **Then**
   it first produces a verified complete backup with source-version provenance;
   failure to produce it prevents migration writes.
2. **Given** an interrupted migration, **When** the application restarts,
   **Then** it resumes safely, retains a verified source until its replacement
   is complete, and refuses ordinary writes until the storage transition is safe.
3. **Given** a completed migration, **When** attachments, historical revisions,
   export and restored copies are read, **Then** content, identities, references,
   offsets and declared sizes match the originals; readable legacy files and
   metadata are no longer retained in the active application store.
4. **Given** missing keys or source corruption, **When** migration is attempted,
   **Then** it stops with an actionable safe error and keeps the last recoverable
   state; it does not silently downgrade to readable storage.

### User Story 3 - Restore ownership with consistent device trust (Priority: P1)

After recovery the owner can authorize a fresh device, while previous devices
and sessions cannot retain access through inconsistent states. Administrative
key import still requires an empty target; it must never become a way to
overwrite an installation already holding an owner or content.

**Why this priority**: Recovery must work on installations containing active
trust records, not only on empty fixtures.

**Independent Test**: Verify that administrative key import refuses occupied
targets and creates no imported trust on an empty target. Separately exercise
complete restoration with active, pending and revoked source devices, failure
rollback and fresh-owner authorization through real requests.

**Acceptance Scenarios**:

1. **Given** existing device trust and sessions, **When** complete restoration
   completes, **Then** all prior grants required to be invalidated by that
   recovery flow become unusable and the owner can establish fresh access.
   Administrative key import into that occupied installation remains refused.
2. **Given** a failure during recovery, **When** the transaction aborts,
   **Then** there is no partially adopted identity or authorized recovery and
   retry preserves the required empty-target/trust-state invariants.

### User Story 4 - Trust the implemented behavior and its checks (Priority: P2)

The owner receives a traceable audit of important code boundaries, and ordinary
controls behave predictably while edits and synchronization are active.

**Why this priority**: Duplicated or disconnected implementations and tests can
hide problems even when automated checks appear green.

**Independent Test**: Review an evidence inventory, prove that changed UI tests
exercise the active runtime, and exercise pointer, keyboard and composition
behavior while structured content refreshes.

**Acceptance Scenarios**:

1. **Given** a normal action button, **When** the pointer is pressed and moved
   away before release, **Then** the action is cancelled; release inside or
   keyboard activation performs the action exactly once.
2. **Given** a form being edited during synchronization, **When** projections
   refresh, **Then** focus, composition and the owner's current input survive;
   saving commits those values once and does not replace them with stale data.
3. **Given** the completed audit, **When** a maintainer reads its inventory,
   **Then** each confirmed defect identifies its active path, impact,
   reproduction and fix/remaining work, and each reviewed boundary states the
   evidence and limits. Disconnected or obsolete checks are corrected.

### Edge Cases

- Empty files, exact chunk boundaries, maximum supported size, overlapping byte
  ranges, identical content referenced by different items and historical versions.
- Power loss between encrypted file publication and metadata commit, duplicate
  completion requests, key rotation during upload and backups during migration.
- Readable orphan blobs, missing source chunks, inconsistent persisted offsets,
  temporary files from an interrupted historical write and unavailable disk space.
- Recovery with no active devices, already revoked devices, expired sessions,
  failed transactions and a retry after an interrupted administrative operation.
- Keyboard activation, pointer cancellation, touch scrolling, IME composition
  and simultaneous projection updates with a dirty form.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every application path persisting private attachment bytes,
  including incomplete transfers, MUST apply authenticated encryption before
  writing them to persistent storage.
- **FR-002**: Sensitive file names and attachment metadata in canonical records,
  revisions and synchronization payload storage MUST use the existing protected
  content policy; public disclosure remains explicit and authorized.
- **FR-003**: File reads MUST authenticate stored data against its installation,
  content identity, part position and encryption generation before returning
  that part. Missing, substituted, truncated or corrupted data MUST fail safely.
- **FR-004**: Upload, resume, range read and integrity verification MUST process
  large files with bounded working memory rather than loading a complete file.
  The configured size limit and existing digest/offset contracts remain intact.
- **FR-005**: Attachment identities, references, deduplication semantics, history,
  export and download behavior MUST remain compatible across the storage change.
- **FR-006**: New storage MUST record sufficient authenticated format/key
  provenance for rotation, historical reads, complete backup and recovery.
- **FR-007**: Historical migration MUST require a verified full backup, resume
  after interruption, verify replacements before retiring readable originals,
  prevent incompatible writes, and leave no readable legacy private content in
  the active store after successful completion.
- **FR-008**: Missing keys, corruption and exhausted storage MUST stop the
  affected operation without a clear-text fallback or false success status.
- **FR-009**: Each recovery flow MUST preserve its empty-target and trust
  contract atomically. Administrative key import MUST refuse occupied targets
  and import no device trust; complete restore MUST invalidate prior grants as
  specified in 024. Both MUST satisfy stored invariants and permit the
  appropriate fresh owner authorization.
- **FR-010**: Ordinary UI actions MUST retain semantic click/keyboard activation,
  pointer cancellation and exactly-once submission. Projection refreshes MUST
  preserve focus, composition and unsaved input in affected forms.
- **FR-011**: The audit MUST cover the explicitly listed boundaries and distinguish
  confirmed active defects, unreachable scaffolding, test blind spots, resolved
  findings and unverified risks. It MUST not treat source inspection alone as a
  successful end-to-end privacy or recovery test.
- **FR-012**: Maintained tests and documentation MUST refer to the actual runtime
  composition and stylesheet. Removed duplicate code MUST have no live consumer;
  replacement checks MUST verify behavior or a meaningful boundary contract.
- **FR-013**: Changed browser and desktop flows MUST preserve offline use and
  synchronization guarantees, and all required local, PR and main gates MUST
  pass before delivery is recorded complete.

### Key Entities

- **Attachment content**: Stable content identity, verified plaintext size and
  digest, authenticated encrypted parts and key/format provenance.
- **Partial transfer**: Stable upload identity, acknowledged offset, expected
  total size, encrypted accepted content and completion state.
- **Storage transition**: Source/replacement inventory, verified full-backup
  identity, durable progress and verification state.
- **Recovery trust transition**: Affected device/session identities and an
  atomic invalidation boundary without introducing a second owner.
- **Audit finding**: Boundary, impact, evidence, severity, remediation,
  verification and explicitly stated uncertainty.

## Assumptions and Dependencies

- This is a correction of existing application encryption and recovery promises;
  it does not add a new permission model or require zero-knowledge hosting.
- Full backups from 024 and UI guidance from 023 are dependencies. Real user
  storage is not used for destructive verification; fixtures exercise migration,
  recovery and corruption. Migration recovery material remains external.
- Inspection of active storage means current logical records, current exports
  and application-managed files. Migration does not promise forensic erasure
  of previously written database pages, write-ahead logs, host snapshots or
  retired media; their retention and disposal are documented operationally.
- Filesystem metadata such as encrypted file lengths remains observable; the
  feature protects private content, names and sensitive metadata rather than
  promising traffic-analysis resistance.
- Key lifecycle and portable export policies remain those of 002/007. Complete
  backups preserve encrypted historical data and its required metadata.
- A broad audit can discover additional defects. New material behavior is
  recorded as traceable tasks/spec changes before implementation, rather than
  silently broadening this specification.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All direct/resumable upload, rename, history and restart scenarios
  preserve the exact original file content and expose zero recognizable private
  fixture contents or names in the active persistent server store.
- **SC-002**: Every tested corruption, substitution and key-loss scenario refuses
  unauthenticated bytes and produces zero false successful completion reports.
- **SC-003**: Every declared durable migration interruption point resumes with
  identical file identities, references and bytes; a failed pre-migration backup
  produces zero migration writes.
- **SC-004**: The default 2 GiB transfer and range-read fixture completes with
  less than 256 MiB additional server working memory attributable to file
  processing, measured independently from concurrent unrelated workloads.
- **SC-005**: Recovery fixtures with existing trust records allow zero previous
  sessions/devices after completion and permit one newly authorized owner device.
- **SC-006**: Affected forms pass pointer cancellation, keyboard activation,
  composition and synchronization-refresh journeys on the maintained browser
  matrix; each explicit activation commits at most once.
- **SC-007**: Every listed audit boundary has an evidence entry, and every
  confirmed critical/high finding is fixed and verified before this feature is
  marked delivered. Other findings have explicit disposition and limitations.

## Audit extension: canonical plaintext copies

Inspection during T013/T016 identified a broader instance of the same privacy
inconsistency: ordinary item/snapshot writes and portable restoration create
protected envelopes while retaining readable payload columns. This is an
existing constitution IV / feature 002 promise, not a new product feature.

- **FR-014**: Accepted canonical mutations and portable restoration MUST leave
  sensitive item presentation, page bodies, relationship metadata and revision
  payloads only in protected storage after commit. Authorized reads, subsequent
  snapshots, structured definitions/values, revision restore and synchronization
  MUST resolve those protected values without overwriting them with placeholders.
  Historical readable copies MUST be included in the verified 025 transition.

Extend SC-001 sentinel inspection to those canonical fields through real secured
requests and a portable round trip. The logical-storage and historical WAL scope
limits above still apply. T042–T045 record reproduction, implementation and proof.
