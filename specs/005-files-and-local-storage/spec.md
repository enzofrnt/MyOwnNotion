# Feature Specification: Files and Local Storage

**Feature Branch**: `feat/005-files-and-local-storage`

**Created**: 2026-08-16

**Status**: Implemented; diagram-editing scope corrected 2026-08-22

**Input**: User description: "Files and local storage: the complete file and attachment experience… Scope is product-canvas sections 15 to 18. Depends on features 001 to 004, all delivered."

## Product Direction, Dependencies, and Scope

This feature realises sections 15 to 18 of
[`docs/product/product-canvas.md`](../../docs/product/product-canvas.md), and
feature 005 of the roadmap.

Feature 001 already delivers the foundation and this feature does not rebuild
it: content-addressed storage keyed by SHA-256, a `logical_files` record with
media type and byte length, attachment and hierarchy placements, and the
sealed-envelope model. What is missing is everything an owner actually does
with a file — see it, open it, keep it available, and be told the truth about
where it is.

Three properties are the point of the feature, and each of them is a promise
that is easy to state and easy to break:

1. **A reference never breaks.** Files are reachable from several places at
   once, so moving, renaming, or deleting one is not a local act.
2. **The device tells the truth about what it holds.** A local copy that has
   been offloaded must never be indistinguishable from one that is present.
3. **Opening a file cannot compromise the workspace.** A file is arbitrary
   bytes supplied to the application; previewing one must not give it the
   application's privileges.

The product remains strictly single-owner: one installation, one owner, one
canonical workspace, several devices.

**Out of scope**: whiteboards (feature 011), graph views (feature 010), and
Draw.io preview/editing are named here only as future contexts or opaque file
formats. A future diagram editor belongs after the V1 editor and synchronization
foundations and must run inside MyOwnNotion, never as a separate Draw.io service
or public embed. Multi-device synchronization mechanics belong to feature 006 —
this feature specifies what an owner is *told* about sync state, not how the
reconciliation runs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Seeing and organising files (Priority: P1)

The owner attaches files to a page, places files directly in the hierarchy, and
inspects what a page carries. Each file states its name, type, size, when it
was added, where it lives, what uses it, whether this device holds it, and
whether the server has it.

**Why this priority**: Everything else in the feature depends on a file being
findable and truthfully described. An attachment list that omits usages makes
deletion unsafe; one that omits local availability makes offline use a guess.

**Independent Test**: Attach several files to a page, place one in the
hierarchy, open the attachment list, and confirm every stated field is present
and correct for each file.

**Acceptance Scenarios**:

1. **Given** a page with three attachments, **When** the owner opens the
   attachment list, **Then** each row states name, type, size, date added,
   location, usages, local availability, and sync state.
2. **Given** a file used by two pages, **When** the owner views it, **Then**
   both usages are listed and reachable.
3. **Given** a file placed directly in the hierarchy, **When** the owner
   browses the tree, **Then** it appears at the same level as pages and
   folders and can be moved like them.

### User Story 2 - Moving, renaming, and deleting without losing references (Priority: P1)

The owner renames a file, moves it elsewhere in the hierarchy, and eventually
deletes one. No reference to it breaks, and a deletion that would leave a
dangling use is refused until the owner has seen what depends on it.

**Why this priority**: The same priority as the story above because it is the
same guarantee seen from the other side. A file system that silently breaks
references is one an owner learns not to trust with anything important.

**Independent Test**: Attach a file to two pages, rename it, move it to another
folder, and confirm both pages still resolve it; then delete it and confirm the
confirmation names both usages.

**Acceptance Scenarios**:

1. **Given** a file embedded in a page and attached to another, **When** the
   owner renames it, **Then** both continue to resolve it.
2. **Given** the same file, **When** the owner moves it to a different folder,
   **Then** both continue to resolve it.
3. **Given** a file still in use, **When** the owner deletes it, **Then** the
   confirmation names every usage and the deletion does not proceed until the
   owner confirms explicitly.
4. **Given** a file with no remaining usages, **When** the owner deletes it,
   **Then** it goes to the trash under the same recovery window as other
   items.

### User Story 3 - Previewing safely (Priority: P2)

The owner opens a PDF, an image, and an SVG without leaving the application. A
format the application cannot preview still states what it is and offers a way
out.

**Why this priority**: Previewing is what makes attachments useful rather than
merely stored, but it comes after the file is safely stored and referenced.

**Independent Test**: Upload one file of each previewable type plus one
unrecognised type; confirm each previews or, failing that, states its name,
type, and size and offers download.

**Acceptance Scenarios**:

1. **Given** a PDF, an SVG, and a PNG file, **When** the owner opens each,
   **Then** each is previewed in the application.
2. **Given** a Draw.io file, **When** the owner opens it, **Then** it is treated
   as an unsupported ordinary file with a download action, and no external
   editor is loaded.
3. **Given** a file of an unrecognised type, **When** the owner opens it,
   **Then** the application states its name, type, and size and offers to
   download or open it externally.
4. **Given** a file containing active content, **When** it is previewed,
   **Then** it cannot read or act on the workspace around it.

### User Story 4 - Keeping what matters available offline (Priority: P2)

The owner marks a page, a branch, or a file as always available offline, sets
how much space this device may use, and continues working without a network.
When the limit is reached the device offloads what it can recover, and says so.

**Why this priority**: This is what makes the product local-first rather than a
website that caches. It follows the previewing story because an owner must be
able to open a file before choosing to keep it.

**Independent Test**: Mark a branch as always available, go offline, and open
everything within it; then lower the limit and confirm which content is
offloaded and how it is presented.

**Acceptance Scenarios**:

1. **Given** a branch marked always available offline, **When** the device has
   no network, **Then** every page and file within it opens.
2. **Given** the device is at its storage limit, **When** more content
   arrives, **Then** the client offloads recoverable content first and never
   offloads unsynchronized changes or unresolved conflicts.
3. **Given** an offloaded file, **When** the owner views it, **Then** its
   title and metadata are present, it is plainly marked as not held locally,
   and it can be retrieved.
4. **Given** the owner sets the limit to unlimited, **When** content
   accumulates, **Then** nothing is offloaded automatically.

### Edge Cases

- A transfer interrupted midway is resumable rather than restarted, where the
  protocol allows it; the partial upload never appears as a complete file.
- A file that exceeds the configured maximum is refused with the limit and the
  reason stated, and the page being written is not lost.
- Two devices upload identical bytes: content-addressed storage stores them
  once, and each device's references remain independent.
- The server holds a file this device has never fetched: it is presented as
  available but not local, never as missing.
- A file is deleted on another device while open here.
- Storage is exhausted at the operating-system level rather than by the
  configured limit.
- A preview fails to render a file that claims a supported type.
- A `.drawio` file remains downloadable without starting another service or
  contacting a Draw.io host.

## Requirements *(mandatory)*

### Functional Requirements

**Files and references**

- **FR-001**: A file MUST be placeable as an attachment of a page, embedded
  within a page's content, or directly in the hierarchy independent of any
  page.
- **FR-002**: A page MUST offer a list of its attachments stating, for each:
  name, type, size, date added, location, usages, local availability, sync
  state, and the actions available.
- **FR-003**: Renaming or moving a file MUST NOT break any reference to it.
- **FR-004**: Deleting a file that is still in use MUST show its usages and
  require an explicit confirmation before proceeding.
- **FR-005**: A file MUST be reportable as used by every page that attaches or
  embeds it, and the owner MUST be able to reach each usage from the file.

**Transfer and integrity**

- **FR-006**: An interrupted transfer MUST be resumable where the transfer
  protocol allows it.
- **FR-007**: A file MUST NOT be reported as synchronized until the server has
  verified its integrity.
- **FR-008**: The maximum file size MUST be configurable by the administrator,
  defaulting to 2 GB.
- **FR-009**: A refused transfer MUST state the limit and the reason, before or
  during the transfer, and MUST NOT discard the draft being written.

**Preview and editing**

- **FR-010**: The application MUST preview PDF, SVG, PNG, JPEG, GIF, and WebP
  files.
- **FR-011**: A Draw.io file MUST remain an ordinary downloadable file and MUST
  NOT load an external editor or require a separate Draw.io service.
- **FR-012**: A file that cannot be previewed MUST state at least its name,
  type, and size, and offer a download or external-open action.
- **FR-013**: Previews MUST be isolated so that file content cannot read or act
  on the workspace, and downloads MUST be served with a content type that
  cannot be interpreted as active content.

**Local storage**

- **FR-014**: Each device MUST keep its local set encrypted, with a size limit
  that defaults to 5 GB, is adjustable on that device, and can be set to
  unlimited.
- **FR-015**: The client MUST retain, in priority over anything else:
  navigation metadata, titles, synchronization information, unsynchronized
  changes, unresolved conflicts, open or recent content, content marked always
  available offline, and information critical to access.
- **FR-016**: "Always available offline" MUST be applicable to a page, a folder
  or branch, or a file.
- **FR-017**: When the limit is reached the client MUST offload only content
  recoverable from the server, and MUST NOT offload unsynchronized changes or
  unresolved conflicts.
- **FR-018**: Offloaded content MUST retain its title and local metadata, MUST
  be distinguishable from content held locally, and MUST be retrievable from
  the server.
- **FR-019**: The owner MUST be able to see how much local space is in use and
  what is holding it.

### Key Entities

- **Logical file**: the owner-facing file — its name, media type, and the
  content it points at. Exists once regardless of how many places reference it.
- **File content**: the stored bytes, addressed by digest, so identical bytes
  are stored once.
- **Usage**: a reference to a logical file from a page attachment, a page
  embed, or a hierarchy placement. What FR-004 enumerates before a deletion.
- **Local availability**: per device, whether the content is held locally,
  offloaded, or never fetched — and, when offloaded, that it is recoverable.
- **Offline intent**: the owner's instruction that a page, branch, or file be
  kept locally regardless of pressure on the limit.
- **Device storage budget**: the configured limit for this device, its current
  usage, and what that usage consists of.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can attach a file and see it listed with all nine stated
  fields within one interaction.
- **SC-002**: After renaming and moving a file used in three places, all three
  still resolve it — verified by opening each.
- **SC-003**: No deletion of an in-use file completes without the owner having
  been shown its usages.
- **SC-004**: A 2 GB file transfers to completion, and a transfer interrupted
  at any point resumes rather than restarting from zero.
- **SC-005**: Every listed previewable format opens within the application; an
  unsupported format always states name, type, and size.
- **SC-006**: A preview cannot reach the workspace: an attempt to do so from
  file content fails.
- **SC-007**: With a branch marked always available offline, an owner with no
  network can open every page and file within it.
- **SC-008**: At the storage limit, no unsynchronized change or unresolved
  conflict is ever offloaded.
- **SC-009**: An offloaded file is visually and programmatically
  distinguishable from a locally held one.

## Assumptions

- **Trash and recovery follow feature 001.** Deleting a file uses the existing
  30-day recovery window rather than a separate mechanism.
- **Content addressing is already in place.** Deduplication by digest comes
  from feature 001 and is assumed, not re-specified.
- **"Administrator" and "owner" are the same person here**, because the product
  is single-owner and self-hosted. The maximum file size is nonetheless an
  installation setting rather than a per-session preference, because it is
  bounded by what the deployment can actually carry.
- **The maximum file size is bounded by the deployment.** The configurable
  limit is valid only within what the reverse proxy, browser, storage, and
  transfer protocol genuinely support; the product does not promise more.
- **Draw.io editing is deferred beyond the V1 foundations.** If specified later,
  its engine runs inside MyOwnNotion and follows the ordinary offline,
  synchronization, permission, and save model; it is not a deployment service.
- **Offloading is automatic but never silent.** The owner can always see what
  was offloaded and why the limit was reached.
