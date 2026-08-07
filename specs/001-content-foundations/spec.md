# Feature Specification: Canonical Content Foundations

**Feature Branch**: `not-created (detached worktree)`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "Define durable foundations for a personal self-hosted knowledge workspace whose pages, folders, files, relationships, revisions, synchronization, backups, graph, sharing, and future clients can evolve without replacing the canonical content model."

## Clarifications

### Session 2026-08-07

- Q: How long must an item remain recoverable in the trash before automatic permanent deletion? → A: 30 days; trashed items remain included in backups during that period.
- Q: How long must the complete content of previous revisions remain viewable and restorable? → A: 24 hours; minimal lineage metadata remains afterward.
- Q: When the same file appears in several pages or hierarchy locations, is it stored once or copied per location? → A: It is one canonical file stored once and shown through multiple placements.
- Q: What happens when one visible placement of a multiply placed file is removed? → A: Only that placement is removed; removing the last placement sends the canonical file to the 30-day trash.
- Q: If identical file content is imported separately, should those imports become one logical file? → A: No; they remain independent logical files, while cautious content-verified physical deduplication is allowed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Organize Knowledge Recursively (Priority: P1)

As the sole owner, I can organize pages, folders, and standalone files in one recursive hierarchy so that my workspace matches the way I structure my knowledge.

**Why this priority**: Every later editing, synchronization, graph, sharing, and navigation capability depends on a stable and unambiguous content hierarchy.

**Independent Test**: Create a hierarchy containing nested pages and folders plus standalone files, move complete branches, and confirm that the resulting structure and contents remain intact.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the owner creates a folder containing a page, another folder, and a standalone file, **Then** each item appears at the requested location with its correct type.
2. **Given** a page in the hierarchy, **When** the owner adds nested pages and folders through several levels, **Then** the hierarchy preserves every parent-child relationship without imposing a product-level depth limit.
3. **Given** a populated branch, **When** the owner moves its root beneath another page or folder, **Then** all descendants move with it and retain their contents and relationships.
4. **Given** an item in the hierarchy, **When** the owner attempts to move it beneath one of its own descendants, **Then** the operation is rejected without changing the hierarchy.
5. **Given** siblings beneath the same parent, **When** the owner reorders them, **Then** the chosen order persists after reload without changing any item identity.

---

### User Story 6 - Continue Core Work Offline (Priority: P1)

As the owner, after my workspace has loaded once on a device, I can reopen it, navigate available pages, edit page content, and reorganize locally available items while the server is unreachable.

**Why this priority**: Offline reading and editing is a constitutional product guarantee, not a later enhancement. The first interactive slice cannot make the server the only path to already local content.

**Independent Test**: Load a workspace, disconnect the server, reload the client, read and change local content, restart the client again, then reconnect and confirm each pending change is submitted once without losing concurrent work.

**Acceptance Scenarios**:

1. **Given** a workspace previously loaded on the device, **When** the server becomes unreachable and the client reloads, **Then** the locally available hierarchy, page documents, file metadata, and synchronization status remain accessible.
2. **Given** the client is offline, **When** the owner creates, edits, moves, trashes, or restores locally available content, **Then** the accepted local change and its durable pending-change entry are persisted together before the interface reports success.
3. **Given** accepted offline changes, **When** the client process closes and reopens before reconnection, **Then** the local state and pending-change queue remain intact.
4. **Given** queued offline mutations and an available server, **When** the client reconnects, **Then** each mutation is submitted idempotently and acknowledged or retained with an explicit conflict state.
5. **Given** the server has a concurrent revision, **When** an offline mutation cannot be accepted safely, **Then** both versions remain recoverable and the client reports an unresolved conflict instead of silently overwriting either version.

---

### User Story 2 - Distinguish Pages, Folders, and Files (Priority: P2)

As the owner, I can rely on clear content types so that a page remains editable, a folder remains organizational, and a file remains a terminal content item.

**Why this priority**: Explicit type semantics prevent later features from interpreting the same item differently and corrupting navigation, sharing, or graph behavior.

**Independent Test**: Create one item of each type, exercise every allowed containment relationship, and verify that disallowed content or child operations are rejected without side effects.

**Acceptance Scenarios**:

1. **Given** a page, **When** the owner edits its content and adds pages, folders, or standalone files beneath it, **Then** the page retains both its editorial content and its children.
2. **Given** a folder, **When** the owner adds pages, folders, or standalone files beneath it, **Then** the folder organizes them without exposing editorial page content of its own.
3. **Given** a standalone file, **When** any operation attempts to add a child beneath it, **Then** the operation is rejected without modifying the file or hierarchy.
4. **Given** a file attached inside a page rather than placed in the hierarchy, **When** the hierarchy is displayed, **Then** that attachment is absent from the tree but remains discoverable through the page's attachment collection.
5. **Given** the same file is placed in two pages and one hierarchy location, **When** any of those locations is viewed, **Then** it resolves to the same stored file while each location remains independently visible.
6. **Given** a file with several placements, **When** one placement is removed, **Then** the file and every other placement remain active and unchanged.
7. **Given** a file with exactly one remaining placement, **When** that placement is removed, **Then** the canonical file enters the 30-day trash together with the information required to restore its former placement.

---

### User Story 3 - Preserve Identity and Relationships (Priority: P3)

As the owner, I can reorganize or rename content without breaking references so that links, attachments, graph relations, and future shared selections continue to identify the intended items.

**Why this priority**: Stable identity is required before links, graph views, sharing, synchronization, and conflict handling can be safely built.

**Independent Test**: Create linked items, rename and move them repeatedly, and verify that every relationship still resolves to the same logical target.

**Acceptance Scenarios**:

1. **Given** two related items, **When** either item is renamed or moved, **Then** the relationship continues to resolve to the same item.
2. **Given** a file used by a page, **When** the file is moved elsewhere in the hierarchy, **Then** the page still refers to the same file.
3. **Given** an item removed from active use, **When** another item still references it, **Then** the reference is preserved as recoverable or explicitly marked unavailable rather than silently redirected.
4. **Given** one canonical file shown in several locations, **When** its content is updated through any location, **Then** every location continues to resolve to the updated canonical file without creating hidden copies.

---

### User Story 4 - Recover from Interrupted Changes (Priority: P4)

As the owner, I can trust that an interrupted or invalid structural change will not leave my workspace partially modified or silently lose previously valid data.

**Why this priority**: Integrity under failure is a core product promise and must exist before multiple clients, migrations, or synchronization add more failure modes.

**Independent Test**: Interrupt representative create, move, update, and delete operations at each persistence boundary, then reopen the workspace and verify that it contains either the complete previous state or the complete accepted new state.

**Acceptance Scenarios**:

1. **Given** a valid hierarchy, **When** a move is interrupted before completion, **Then** reopening the workspace reveals either the complete original hierarchy or the complete moved hierarchy, never a partial branch.
2. **Given** an invalid requested change, **When** validation fails, **Then** no canonical item, relationship, or revision is partially updated.
3. **Given** an accepted content change, **When** the application closes unexpectedly afterward, **Then** the accepted change can be recovered without silently reverting to unrelated older content.

---

### User Story 5 - Retain Verifiable Change Lineage (Priority: P5)

As the owner, I can rely on each accepted change having ordered lineage so that future synchronization, conflict comparison, recovery, and migrations can distinguish new work from an outdated device catching up.

**Why this priority**: A shared notion of ancestry is necessary to avoid false conflicts and destructive last-write-wins behavior later.

**Independent Test**: Apply ordered and independently branched changes to the same starting item, then verify that the system can identify their common ancestor and distinguish a descendant from a concurrent revision.

**Acceptance Scenarios**:

1. **Given** an accepted revision, **When** a later change is accepted, **Then** the later revision identifies its lineage without relying only on device clock time.
2. **Given** a device whose last known revision is simply older than the current revision, **When** its state is compared, **Then** it is classified as behind rather than conflicting.
3. **Given** two changes derived independently from the same revision, **When** their lineage is compared, **Then** they are identifiable as concurrent and both remain available for later reconciliation.

### Edge Cases

- A hierarchy operation attempts to create a direct or indirect cycle.
- A page or folder with a large descendant tree is moved while another accepted change targets a descendant.
- Two items have the same display name under the same parent; their identities and references must remain distinct.
- An attachment and a standalone file have identical visible names and content but remain separate logical items unless explicitly deduplicated by a future feature.
- One canonical file appears through many page attachments and hierarchy placements; listing, graphing, and lifecycle operations must not count it as multiple stored files.
- Two devices concurrently remove different placements of the same file; the file must enter the trash only if the accepted combined state has no active placement.
- Two imports share a name, size, format, or preview but differ in content; they must never be treated as physically identical on those attributes alone.
- Two logically distinct files currently share deduplicated physical content and one is edited; the edit must not alter the other logical file.
- An item is removed while still referenced by a page, graph relation, or future share selection.
- A canonical export or snapshot is prepared for a backup while an item is in its 30-day trash period; the item and its recovery metadata must remain represented in that backup input.
- The 30-day trash period expires while an item is still referenced; permanent deletion must preserve a diagnosable unavailable reference rather than redirecting it.
- A client supplies an unknown content type or a revision whose ancestor is unavailable.
- A revision becomes older than 24 hours while another device still identifies it as an ancestor; lineage comparison must continue without requiring the expired content body.
- A timestamp is incorrect because a device clock is skewed; ancestry must remain determinable without trusting wall-clock order alone.
- An operation exceeds an implementation resource limit even though the product model permits arbitrary nesting; it must fail explicitly without partial mutation.
- Local storage becomes unavailable or reaches quota while persisting a mutation; the mutation must fail visibly and must not be reported as accepted.
- A client reconnects after its prior change checkpoint is no longer directly available; it must rebuild from a verified snapshot without discarding its durable pending changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST maintain exactly one canonical workspace owned by the single configured owner.
- **FR-002**: The canonical model MUST distinguish pages, folders, standalone files, and page attachments as explicit content roles.
- **FR-003**: A page MUST support editorial content and MAY contain pages, folders, and standalone files.
- **FR-004**: A folder MUST contain no editorial page content and MAY contain pages, folders, and standalone files.
- **FR-005**: A file placement in the hierarchy MUST be terminal and MUST NOT contain child items.
- **FR-006**: A page attachment placement MUST belong to a page attachment collection and MUST remain absent from the main hierarchy unless the same canonical file also has an explicit hierarchy placement.
- **FR-007**: The product model MUST permit recursive nesting of pages and folders without a fixed product-level depth limit.
- **FR-008**: The system MUST prevent direct and indirect hierarchy cycles.
- **FR-009**: Every canonical item MUST have a stable identity that is independent of its name and hierarchy location.
- **FR-010**: Renaming or moving an item MUST preserve its identity, descendants, content, metadata, and relationships.
- **FR-011**: Relationships MUST identify their endpoints by stable identity and MUST NOT silently resolve to a different item after moves, renames, removal, or name reuse.
- **FR-012**: The model MUST support typed relationships between canonical items so future links, graph views, database relations, embeds, attachment usage, and share selections can coexist without overloading hierarchy membership.
- **FR-013**: Removing an active item MUST place it in a recoverable trash state for 30 days before automatic permanent deletion is allowed.
- **FR-014**: Permanent deletion MUST NOT silently redirect or erase surviving references; affected references MUST remain diagnosable.
- **FR-015**: Each accepted canonical change MUST produce verifiable lineage sufficient to order descendants, identify a common ancestor, and recognize concurrent revisions without relying only on wall-clock timestamps.
- **FR-016**: Concurrent revisions MUST remain individually recoverable until a later conflict-resolution feature records an accepted result.
- **FR-017**: Canonical mutations affecting multiple records or relationships MUST be atomic from the owner's perspective: either the complete valid change is accepted or the prior valid state remains.
- **FR-018**: Invalid or interrupted mutations MUST NOT leave partially created branches, orphan descendants, broken ownership, or silently discarded accepted content.
- **FR-019**: The canonical model MUST retain sufficient type, identity, hierarchy, relationship, lifecycle, and revision metadata to support later offline synchronization without redefining existing items.
- **FR-020**: The canonical model MUST retain sufficient structure for later filtered graph views, selective descendant sharing, backup verification, migrations, and durable full-workspace export.
- **FR-021**: The system MUST validate all externally supplied identifiers, types, parent assignments, relationship endpoints, and lineage claims before accepting a mutation.
- **FR-022**: Integrity failures MUST be reported explicitly and MUST NOT expose private content or secrets in diagnostic output.
- **FR-023**: The system MUST allow all canonical workspace data and relationships to be represented in a documented, durable export without requiring Markdown as the internal or export format.
- **FR-024**: The feature MUST expose verifiable behaviors for automated tests covering type rules, containment, cycles, identity preservation, relationship preservation, atomicity, lifecycle, and revision lineage.
- **FR-025**: Every canonical export or snapshot supplied to a backup process while an item remains in its 30-day trash period MUST include that item, its descendants, relationships, revision lineage, deletion time, and recovery deadline.
- **FR-026**: The complete content of each superseded revision MUST remain viewable and restorable for 24 hours after it is superseded.
- **FR-027**: After a superseded revision's 24-hour content-retention period expires, the system MUST preserve the minimal lineage metadata required to identify ancestry and concurrency without retaining that revision's complete content indefinitely.
- **FR-028**: A canonical file MUST be stored once by stable identity and MAY have multiple simultaneous page-attachment and hierarchy placements.
- **FR-029**: Every placement of a canonical file MUST resolve to the same file content and identity; adding a placement MUST NOT create an implicit content copy.
- **FR-030**: Updating a canonical file through any placement MUST make the accepted update observable through all of its placements.
- **FR-031**: Removing one file placement MUST remove only that placement while any other active placement remains.
- **FR-032**: Accepting removal of a canonical file's final active placement MUST move the file into the 30-day trash and retain sufficient placement metadata to restore it.
- **FR-033**: Restoring a file from the trash MUST restore at least its last removed placement unless the owner selects another valid location.
- **FR-034**: Each independent file import MUST create an independent logical file identity, even when its initial content appears identical to an existing file.
- **FR-035**: The implementation MAY deduplicate physical file content only after verifying the complete content with a collision-resistant content identity and equality safeguards; names, sizes, types, metadata, and previews MUST NOT be sufficient evidence of equality.
- **FR-036**: Physical deduplication MUST remain unobservable in logical behavior: updating, moving, trashing, restoring, or permanently deleting one logical file MUST NOT change another logical file that happened to share the same physical content.
- **FR-037**: The client MUST persist a local projection of all previously loaded hierarchy items, page documents, file metadata, placements, relationships, revision headers, and synchronization state needed for core offline reading and navigation.
- **FR-038**: The client MUST persist each accepted local change together with its resulting local state and durable pending-change record before reporting success.
- **FR-039**: The client MUST retain pending-change records across reloads, process termination, network loss, and failed submission attempts.
- **FR-040**: Reconnecting clients MUST submit mutations with their stable mutation IDs and causal base revisions so replay is idempotent and concurrency can be detected.
- **FR-041**: The server MUST expose a durable ordered change checkpoint or a verified replacement snapshot so a client can catch up after any supported offline interval without relying on transient notifications.
- **FR-042**: A rejected concurrent mutation MUST remain locally recoverable with its base and competing revision identities and MUST NOT be automatically discarded or overwritten.
- **FR-043**: The interface MUST display offline, pending, synchronizing, synchronized, and unresolved-conflict states without claiming server durability for local-only work.
- **FR-044**: Every hierarchy placement MUST have an explicit stable sibling order that the owner can change without changing canonical item identity.

### Key Entities

- **Workspace**: The single owner's canonical knowledge space and the boundary containing all canonical items and relationships.
- **Canonical Item**: A stable-identity item with a type, lifecycle state, metadata, revision lineage, and optional hierarchy position.
- **Page**: A canonical item with editorial content that may also contain pages, folders, and standalone files.
- **Folder**: A canonical organizational item without editorial page content that may contain pages, folders, and standalone files.
- **File**: A canonical binary or document item stored once by stable identity and visible through one or more page-attachment or terminal hierarchy placements.
- **Hierarchy Membership**: An ordered parent-child placement beneath the workspace, a page, or a folder; pages and folders have one active hierarchy membership, while a file may have multiple placements.
- **File Placement**: One visible use of a canonical file, either as a page attachment or as a terminal item in the hierarchy.
- **File Content**: The immutable byte content referenced by one or more independently identified logical files when verified physical deduplication is in use.
- **Relationship**: A typed connection between stable item identities, distinct from hierarchy membership.
- **Revision**: An immutable description of an accepted canonical change and its causal parent or parents.
- **Lifecycle State**: The active, trashed, or permanently removed status of an item, including the trash-entry time and 30-day recovery deadline, subject to reference-integrity rules.
- **Mutation**: A validated set of intended changes accepted or rejected as one observable unit.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In automated acceptance tests, 100% of allowed page, folder, and standalone-file containment combinations succeed, and 100% of prohibited child or cycle operations are rejected without changing the prior valid state.
- **SC-002**: After at least 1,000 randomized rename and move operations across a hierarchy of at least 10,000 items, every surviving identity, descendant placement, and pre-existing relationship resolves to its intended logical item.
- **SC-003**: Fault-injection tests at every multi-step mutation boundary produce zero partially applied canonical mutations; each reopened state is either the complete prior state or the complete accepted new state.
- **SC-004**: Revision-lineage tests correctly classify 100% of tested pairs as ancestor, descendant, identical, or concurrent, including cases with deliberately incorrect device clocks.
- **SC-005**: A complete canonical workspace fixture containing every defined entity and relationship can be exported and independently validated with zero missing items, relationships, hierarchy placements, or revision identifiers.
- **SC-006**: A new contributor can determine the permitted containment rules, identity guarantees, removal behavior, and lineage semantics from this specification without consulting chat history or agent-specific documentation.
- **SC-007**: Lifecycle and export tests confirm that 100% of trashed items remain recoverable and represented in every canonical backup input throughout their 30-day period, then become eligible for permanent deletion only after the recorded deadline.
- **SC-008**: Revision-retention tests confirm that complete prior content remains restorable throughout the 24-hour window and that ancestry classification remains correct after the prior content expires.
- **SC-009**: A canonical file fixture with at least 100 simultaneous page and hierarchy placements occupies one logical stored file, resolves to the same stable identity from every placement, and exposes accepted content updates at every location.
- **SC-010**: Placement-lifecycle tests remove 99 of 100 placements without changing the file or remaining placement, then confirm that removing the final placement moves the file and its restorable placement metadata to the trash.
- **SC-011**: Deduplication tests never merge distinct content across the complete collision and near-match fixture set, and changing any logically independent file leaves every other logical file byte-for-byte unchanged.
- **SC-012**: After initial loading, all core offline acceptance scenarios pass after a client reload with the server fully unavailable.
- **SC-013**: Fault-injection tests at each local persistence boundary produce zero cases where the interface reports success without both the local state and matching pending-change record being durable.
- **SC-014**: Reconnection tests submit every queued mutation exactly once logically despite repeated transport delivery and preserve 100% of rejected concurrent work as an explicit unresolved conflict.

## Assumptions

- This feature establishes product-visible invariants and a canonical model; it does not deliver the final editor, user interface, multi-device transport, backup scheduler, graph renderer, sharing pages, or MCP service.
- The product remains permanently single-owner even though multiple authorized devices and anonymous public readers will be introduced later.
- Pages and folders may recursively contain pages, folders, and standalone files; standalone files never contain children.
- A page attachment is not shown in the hierarchy unless explicitly represented there as a standalone file.
- Arbitrary nesting means no product rule imposes a depth maximum; implementations may enforce explicit resource protections provided they preserve integrity and report the limitation.
- Display names need not be unique because stable identity, not path or name, defines an item.
- The 30-day trash duration is measured from the accepted removal event; backup retention beyond that lifecycle is governed by the later backup specification.
- Wall-clock timestamps are useful metadata but are insufficient as the sole basis for revision ancestry or conflict detection.
- The 24-hour revision-content window applies to superseded content history, not to active content, trashed items, unresolved conflicts, or backup copies governed by their own retention rules.
- Physical file-content deduplication is an implementation optimization, never a user-visible merge of independently imported files.
- This feature implements minimum durable offline state and reconciliation foundations; real-time notifications, automatic rich-text merging, multi-device conflict-resolution UI, cache-size eviction, and complete synchronization operations remain separate specs.
- Data-at-rest encryption, container volumes, authentication, synchronization protocols, backup retention, and implementation technologies belong in later plans and feature specifications.

## Scope Boundaries

### Included

- Canonical content roles and their containment rules.
- Stable identity and relationship invariants.
- Recoverable lifecycle semantics.
- Atomic mutation expectations.
- Revision ancestry required by future synchronization and conflict handling.
- Durable exportability of the canonical structure.
- Durable local state, pending changes, checkpoint-based catch-up, and non-destructive conflict capture required by constitutional offline use.

### Excluded

- Visual hierarchy and editor implementation.
- Authentication and device enrollment.
- Real-time transport, rich-text automatic merge, and complete user-facing conflict-resolution workflows beyond durable catch-up and conflict capture.
- User-facing conflict-resolution screens.
- Local cache quotas and eviction.
- File preview and Draw.io editing.
- Backup scheduling, Google Drive transfer, restoration, update orchestration, and rollback.
- Databases, tasks, graph visualization, whiteboards, public sharing, annotations, and MCP behaviors beyond preserving model compatibility.
