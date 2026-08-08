# Feature Specification: Files and Durable Storage

**Feature Branch**: `codex/files-and-storage`

**Created**: 2026-08-08

**Status**: Draft

**Input**: User description: "Continuer la roadmap avec files-and-storage : pièces jointes, stockage objet, sauvegarde et restauration, en allant le plus loin possible avec Spec Kit."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open and Reuse Attachments (Priority: P1)

As the workspace owner, I can inspect, preview, download, and reuse files attached to pages so supporting material remains part of my knowledge workspace rather than an opaque filename.

**Why this priority**: Import already exists, but a stored file is not useful until its exact bytes can be safely retrieved and understood from every placement.

**Independent Test**: Attach an image and a document, preview the image, download both with their exact names and bytes, attach one existing logical file to a second page, replace its content, reload, disconnect, and verify the already-opened revision remains available.

**Acceptance Scenarios**:

1. **Given** an active page attachment, **When** the owner activates its download action, **Then** the exact verified bytes arrive with the current logical filename, media type, length, and stable file identity.
2. **Given** a supported safe raster image, **When** the owner expands its preview, **Then** a bounded labelled preview appears without exposing a storage locator or making the object public.
3. **Given** a file already present in the workspace, **When** the owner attaches it to another page, **Then** both placements resolve to one logical file and content replacement is visible from both placements.
4. **Given** a previously opened immutable file revision admitted by the documented offline quota, **When** the application is offline and reloaded, **Then** its cached bytes and metadata remain readable with an explicit offline state.
5. **Given** a missing, corrupted, unsupported, trashed, or replaced file revision, **When** the owner attempts access, **Then** the application shows a specific unavailable or integrity state and never substitutes different bytes.

---

### User Story 2 - Keep File Content Private and Durable (Priority: P1)

As the self-hosting owner, I can store file bytes in a private object store and verify their integrity so database metadata never claims that incomplete or different content is available.

**Why this priority**: Attachments become durable product data only when object persistence, verification, restart behavior, and failure handling are explicit.

**Independent Test**: Start the production-like composition on a clean host, upload small and large files, interrupt one upload, restart every service, retrieve accepted content by full and partial reads, run an integrity audit, and verify private object access plus exact digests.

**Acceptance Scenarios**:

1. **Given** valid production storage configuration, **When** a file upload completes, **Then** the persisted object is verified before the logical file mutation is accepted.
2. **Given** an interrupted or rejected upload, **When** storage is inspected, **Then** no logical file references an incomplete object and temporary data is safe to clean.
3. **Given** accepted files and a full composition restart, **When** they are retrieved, **Then** their identities, metadata, lengths, digests, placements, and exact bytes remain unchanged.
4. **Given** a storage outage or integrity mismatch, **When** the system receives a read or write, **Then** it fails visibly without leaking storage credentials, locators, filenames, file content, or request bodies into logs.
5. **Given** an integrity audit, **When** metadata and stored objects disagree, **Then** every missing, mismatched, or unreferenced object is reported without automatic destructive repair.

---

### User Story 3 - Create Encrypted Recoverable Backups (Priority: P1)

As the self-hosting owner, I can create scheduled and on-demand encrypted backups in a separate failure domain so losing the application host does not lose my workspace.

**Why this priority**: Persistent volumes protect against restart, not host loss, operator error, or storage failure.

**Independent Test**: Populate pages, relationships, revisions, files, tasks, databases, and canvases; create two encrypted backups; simulate a failed overlapping run and a remote-copy failure; inspect manifests and retention; then verify that only complete backup sets are reported as recoverable.

**Acceptance Scenarios**:

1. **Given** valid backup credentials and destination configuration, **When** an on-demand or scheduled backup runs, **Then** one encrypted recoverable set includes canonical metadata, current and retained revision data, and every referenced file object.
2. **Given** a backup in progress, **When** another scheduled run starts, **Then** runs do not overlap and neither complete set is corrupted.
3. **Given** a database dump, object copy, manifest, verification, encryption, or remote-transfer failure, **When** the run ends, **Then** it is reported as failed and is never advertised as recoverable.
4. **Given** several complete backups, **When** retention executes, **Then** the documented daily, weekly, and monthly recovery points are preserved and deletion never affects active application data.
5. **Given** backup output and operational logs, **When** they are reviewed, **Then** credentials and private page, file, relationship, and document content are absent.

---

### User Story 4 - Restore and Prove a Complete Workspace (Priority: P1)

As the self-hosting owner, I can restore a selected backup into a clean composition and verify it before normal service starts so disaster recovery is repeatable rather than hopeful.

**Why this priority**: A backup has no user value until a documented restore proves both metadata and binary objects can be recovered together.

**Independent Test**: Select a complete encrypted backup, restore it into empty database and object storage targets, inject checksum and version failures, then start the application and compare canonical identities, relationships, revisions, documents, files, and digests with the source fixture.

**Acceptance Scenarios**:

1. **Given** a compatible complete backup and empty targets, **When** restore is explicitly confirmed, **Then** database state and file objects are restored and verified before the application becomes ready.
2. **Given** a non-empty target, incompatible manifest, missing object, wrong decryption secret, or digest mismatch, **When** restore is attempted, **Then** it stops before replacing active data and explains the safe next action.
3. **Given** a successful restore, **When** the application starts, **Then** stable item, placement, revision, relationship, document, task, database, canvas, logical-file, and content identities match the selected backup.
4. **Given** a restored file, **When** it is downloaded or previewed, **Then** the exact source digest and byte length are reproduced.
5. **Given** the deployment documentation on a clean host, **When** an operator follows the backup, verification, restore, and rollback rehearsal, **Then** no undocumented application-specific step is required.

### Edge Cases

- A zero-byte file, a 256 MiB file, or a filename containing Unicode, quotes, path separators, or control characters is uploaded.
- A client requests an invalid, multiple, open-ended, suffix, or unsatisfiable byte range.
- A claimed media type disagrees with a filename or content signature.
- A safe image preview is extremely wide, tall, animated, malformed, or decompression-heavy.
- An object write succeeds but the metadata transaction fails, or metadata commits while later object verification becomes unavailable.
- Two simultaneous uploads contain identical bytes but represent independent logical files.
- A file is replaced while an older immutable revision is cached offline.
- A final placement is removed while the file is still represented in a retained backup.
- An integrity audit sees an object created by an interrupted upload or a database reference whose object is missing.
- Backup begins during accepted writes, file replacement, trash restoration, or revision retention cleanup.
- The backup destination runs out of space, becomes unreachable, or accepts only part of a transfer.
- A restore is interrupted after creating temporary targets but before verification.
- Backup data was produced by a newer incompatible schema or references an unavailable content object.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every active logical file MUST expose labelled metadata, download, and placement actions from page attachments and hierarchy file entries.
- **FR-002**: File retrieval MUST return the exact verified current bytes with stable logical-file identity, original name, declared media type, byte length, digest, and current revision identity.
- **FR-003**: File retrieval MUST support metadata-only inspection, complete downloads, and one valid byte range while rejecting malformed, multiple, or unsatisfiable ranges predictably.
- **FR-004**: Only explicitly allow-listed safe raster media MAY render inline; every other type, including vector markup, MUST remain a download and MUST NOT execute as active content.
- **FR-005**: Retrieval responses MUST prevent media sniffing, sanitize downloadable names, and MUST NOT disclose object-store locators, credentials, internal paths, or unrelated file metadata.
- **FR-006**: The owner MUST be able to attach an existing active logical file to another page without importing duplicate logical content.
- **FR-007**: Replacing one logical file MUST preserve its identity and placements, create a new immutable content revision, and leave independent logical files unchanged even when bytes were physically reused.
- **FR-008**: A previously opened immutable file revision admitted by the documented offline quota and its metadata MUST remain available offline; content outside that quota MUST be labelled online-only, and new binary imports MAY require connectivity but MUST fail before page state implies a completed attachment.
- **FR-009**: Cached file revisions MUST be keyed by immutable file and revision identities, bounded by a documented quota policy, and MUST never serve one revision as another.
- **FR-010**: Missing, corrupt, unverified, unsupported, trashed, purged, or stale file content MUST produce an explicit safe state without silent substitution or partial bytes.
- **FR-011**: Production file bytes MUST use a private object-storage boundary with configurable endpoint and bucket ownership; local development MUST retain a documented dependency-light storage path.
- **FR-012**: Object keys MUST be opaque internal locators, object storage MUST have no unauthenticated public read path, and application access MUST remain loopback-only until authentication is delivered.
- **FR-013**: Uploads MUST be bounded at 256 MiB, avoid holding the complete maximum-sized file in application memory, and clean incomplete temporary objects without deleting accepted content.
- **FR-014**: The system MUST verify persisted byte length and SHA-256 before accepting new content metadata; physical deduplication MUST additionally prove complete byte equality and remain invisible to logical behavior.
- **FR-015**: Accepted full and ranged reads MUST verify the requested object identity and bounds; integrity or storage failure MUST be visible and MUST NOT mutate canonical metadata.
- **FR-016**: A non-destructive integrity audit MUST report referenced, missing, mismatched, temporary, and unreferenced objects with stable counts and redacted identifiers suitable for operations.
- **FR-017**: A backup set MUST include a transactionally consistent canonical database snapshot, every referenced immutable file object, schema/tool compatibility metadata, and a deterministic integrity manifest.
- **FR-018**: Every complete backup MUST be encrypted before leaving the application host and copied to an operator-configured destination in a separate failure domain; secrets MUST come from protected runtime configuration.
- **FR-019**: Backups MUST support on-demand and scheduled execution, prevent overlap, expose last-success and last-failure status, and never label an incomplete run recoverable.
- **FR-020**: Default retention MUST preserve 7 daily, 4 weekly, and 12 monthly complete recovery points; pruning MUST be explicit, logged without content, and isolated from active volumes.
- **FR-021**: Restore MUST require an explicit selected backup and confirmation, accept only empty targets, validate encryption, manifest, schema compatibility, database snapshot, object count, length, and digest, and fail closed before readiness.
- **FR-022**: Restore MUST stage and verify metadata plus objects together so interruption or failure cannot expose a partially restored workspace as ready.
- **FR-023**: A successful restore MUST reproduce stable canonical identities, ancestry, placements, relationships, page documents, logical-file metadata, and exact file bytes from the selected backup.
- **FR-024**: Backup, audit, and restore reports MUST contain operational state and bounded counts but MUST NOT log credentials, object locators, filenames, file bytes, page text, relationship metadata, or document bodies.
- **FR-025**: Attachment metadata, preview, download, reuse, offline, unavailable, and error controls MUST be semantic, labelled, focus-visible, keyboard operable, and contained at narrow viewports and 400% zoom.
- **FR-026**: Deterministic desktop and mobile review images for attachment metadata, safe image preview, existing-file reuse, offline cached content, and unavailable content MUST be retained in GitHub browser-test artifacts.
- **FR-027**: The production Compose topology and documentation MUST provide object storage, backup, audit, restore, verification, restart, and clean-host rehearsal paths with health checks, private defaults, persistent volumes, and no undocumented setup.
- **FR-028**: Existing page document versions 1 through 6, current files, placements, revisions, exports, and filesystem development data MUST remain readable and recoverable after this feature is introduced.
- **FR-029**: Public file sharing, authentication, malware scanning, media transformation, and automatic destructive garbage collection MUST NOT be implied by private retrieval, object storage, backup, or audit support.

### Key Entities

- **Logical File**: A stable workspace item whose name, lifecycle, placements, current revision, and content pointer can change without changing identity.
- **Content Object**: Immutable verified bytes addressed by an opaque internal locator with digest, length, verification state, and physical reference metadata.
- **Attachment Placement**: A stable association exposing one logical file from one page without adding it to the hierarchy.
- **File Revision Cache Entry**: Locally retained immutable bytes and metadata keyed by logical-file and revision identities for offline retrieval.
- **Integrity Audit**: A read-only comparison between canonical content references and stored objects with categorized findings.
- **Backup Set**: One encrypted, immutable, recoverable database-and-object snapshot with a deterministic manifest and completion state.
- **Backup Manifest**: Compatibility metadata, bounded counts, object lengths and digests, database digest, creation time, and verification outcome without private content.
- **Restore Run**: An explicitly selected, staged, verified transition from empty targets to one complete restored workspace.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can attach, preview, download, and reuse a current file from a second page in under two minutes using only labelled keyboard-operable controls.
- **SC-002**: Full downloads, valid ranges, quota-admitted offline cached reads, restart reads, and post-restore reads reproduce the expected SHA-256 and byte length for 100% of acceptance fixtures.
- **SC-003**: Unsupported media and malformed or unsatisfiable range requests never execute active content, disclose a storage locator, or return bytes from another file or revision.
- **SC-004**: A 256 MiB upload completes or fails with peak application buffering below 32 MiB and never leaves accepted metadata pointing to incomplete content on the reference host.
- **SC-005**: After a complete production-like restart, 100% of accepted file identities, placements, revisions, metadata, and object digests remain unchanged.
- **SC-006**: Integrity audits classify every injected missing, mismatched, temporary, and unreferenced object while making zero automatic destructive changes.
- **SC-007**: Every successful backup fixture contains one verified database snapshot and 100% of referenced objects; every injected partial failure produces zero newly recoverable backup sets.
- **SC-008**: Scheduled and manually triggered backups never overlap in 100% of concurrency tests, and retention preserves exactly the configured daily, weekly, and monthly recovery points.
- **SC-009**: A clean-host restore reproduces 100% of fixture item, placement, revision, relationship, document, logical-file, content-object, length, and digest identities before readiness.
- **SC-010**: Wrong secrets, non-empty targets, incompatible schemas, missing objects, and digest corruption each stop restore without making the application ready in 100% of fault-injection cases.
- **SC-011**: Principal attachment journeys complete without critical accessibility violations or page-level horizontal overflow on supported desktop and mobile viewports.
- **SC-012**: An operator can follow the documented clean-host backup, remote-copy verification, restore, restart, and rollback rehearsal without an undocumented application-specific command.

## Assumptions

- The product remains a single-owner, loopback-only application until a later authentication and sharing specification.
- Existing canonical file identities, multi-placement semantics, immutable content addressing, and copy-on-write replacement are foundations to extend rather than replace.
- Page attachments remain in the page attachment surface for this increment; a new inline editor attachment block is not required.
- Safe inline preview is initially limited to allow-listed raster images. PDF rendering, audio/video players, vector rendering, thumbnails, transcoding, OCR, and annotations are separate work.
- New uploads require a reachable application server. Offline resilience covers immutable revisions whose bytes were previously opened successfully.
- The default file-size limit is 256 MiB and is a product safety limit, not a promise that every device has space to cache the maximum.
- Production object storage is self-hosted with the composition; backup copies must additionally reach an operator-configured separate failure domain.
- Backup and restore are operator workflows exposed through documented commands and composition profiles, not an end-user administration screen.
- The default retention policy is 7 daily, 4 weekly, and 12 monthly complete recovery points and may be overridden explicitly.
- Backup retention is independent of active 30-day trash and 24-hour superseded-revision-content windows.

## Scope Boundaries

### Included

- Exact private file metadata, full download, single-range retrieval, and safe raster preview.
- Existing-file attachment reuse, copy-on-write replacement, explicit unavailable states, and bounded immutable offline caching.
- Private object-store adapter and production composition, restart persistence, streaming, verification, and non-destructive integrity audit.
- Encrypted on-demand and scheduled backups, separate-destination transfer, manifests, verification, retention, status, and overlap prevention.
- Empty-target staged restore, compatibility and integrity validation, clean-host rehearsal, documentation, responsive accessibility, screenshots, and fault injection.

### Excluded

- Authentication, authorization, public links, third-party sharing, expiring download URLs, and internet exposure.
- Inline editor attachment blocks, drag-and-drop or clipboard paste into the editor, collaborative upload state, and new offline upload queues.
- Antivirus or content moderation, OCR, full-text extraction, thumbnails, image optimization, media playback/transcoding, PDF rendering, and vector preview.
- User-managed encryption keys inside the application UI, hosted backup accounts, and guarantees about a specific third-party remote provider.
- Restore into a live or non-empty workspace, in-place rollback, point-in-time database recovery, cross-version downgrade, and automatic migration rollback.
- Automatic deletion of unreferenced objects; the integrity audit reports candidates but never repairs or removes them.
