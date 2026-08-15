# Feature Specification: Core Workspace Experience

**Feature Branch**: `003-core-workspace-experience`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Core workspace experience: responsive navigation and sidebar, usable pages and folders, a Notion-like block editor, keyboard shortcuts, explicit save states, and accessibility of the core journeys. Scope is product-canvas sections 7 and 11 to 14. Depends on feature 001 (content foundations) and feature 002 (owner security foundation), both delivered."

**Product-canvas scope**: sections 7 (platforms and compatibility), 11 (pages,
folders and hierarchy), 12 (sidebar and navigation), and 13 (block editor).

**Dependencies**: feature 001 (content foundations) and feature 002 (owner
security foundation), both delivered. This feature adds no new storage
guarantees and no new security boundary; it makes the ones that exist usable.

**Exclusions**: section 14 (databases and views) is deliberately **not** in
scope — see Assumptions. Files and attachments (sections 15–18) belong to
feature 004; real-time multi-device transport belongs to feature 005; search
belongs to feature 007.

---

## Why this feature exists

The installation currently holds an owner's notes safely and lets them be
created, moved, renamed, versioned, and reconciled offline. What it does not do
is make writing them pleasant, or even ordinary.

Today a page is a title and a JSON body edited through a plain control. There
is no way to write a heading, a list, or a piece of code; no way to move a
block; no keyboard path through the tree; and no clear statement of whether
what was typed is saved. Every guarantee underneath is real and nearly
invisible.

This feature is where the workspace becomes a place someone would choose to
keep their notes rather than one that merely could.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Write a page that reads like a document (Priority: P1)

The owner opens a page and writes: a heading, a paragraph, a bulleted list, a
checkbox, a quoted line, a fenced code block. They type `# ` and get a heading;
they type `- ` and get a list item; they press `/` and pick a block from a
menu. They select a block and move it. They change their mind and undo.

**Why this priority**: This is the feature. Everything else in this document
supports it. An owner who cannot write a structured note has no reason to use
the product at all, whatever else it does correctly.

**Independent test**: Create a page, produce each block type by both the
slash menu and the Markdown-style shortcut, reorder two blocks, undo the
reorder, reload, and confirm the document is exactly as it was left.

**Acceptance scenarios**:

1. **Given** an empty page, **when** the owner types `# ` at the start of a
   line, **then** the line becomes a heading and the shortcut characters are
   not left in the text.
2. **Given** a page with three blocks, **when** the owner moves the last block
   above the first, **then** the order changes immediately and the change
   survives a reload.
3. **Given** any editing action from the list above, **when** the owner presses
   the undo shortcut, **then** the previous state is restored, and redo returns
   to the later state.
4. **Given** a page being edited, **when** the browser is closed without
   warning, **then** reopening the page shows the content as of the last
   completed edit rather than an earlier state.

---

### User Story 2 — Know whether the work is saved (Priority: P1)

While writing, the owner can always tell whether their words are only on this
device, on their way to the server, saved, or blocked. When something is
wrong — offline, a write block, a conflict — the interface says so in terms
they can act on, and never claims success it has not had.

**Why this priority**: Equal to the editor. A note-taking application that
loses work destroys trust permanently, and one that *appears* to lose work
destroys it just as fast. Feature 001 already reconciles correctly; what is
missing is telling the owner what it is doing.

**Independent test**: Type into a page while offline, observe the state, come
back online, and observe it resolve — with no moment at which the interface
claims "saved" before the server has confirmed.

**Acceptance scenarios**:

1. **Given** an edit that has not reached the server, **when** the owner looks
   at the page, **then** the state is shown as unsaved or pending, never as
   saved.
2. **Given** the device is offline, **when** the owner edits, **then** the
   interface says the work is kept on this device and will be sent later.
3. **Given** a rotation write block or another server refusal, **when** the
   owner edits, **then** the interface says what is blocked, that existing
   content is still readable, and what would resolve it.
4. **Given** an edit that conflicts with a newer server revision, **when**
   reconciliation completes, **then** the owner is shown that a conflict
   occurred and can see both versions rather than losing either silently.

---

### User Story 3 — Find and organise things without the mouse (Priority: P2)

The owner navigates the whole workspace from the keyboard: moving through the
tree, opening and collapsing branches, creating a page in the right place,
moving items, and reaching favourites, recents, and settings. Focus is always
visible, and every state — loading, empty, unavailable offline, error — is
stated rather than implied by a blank area.

**Why this priority**: One priority below writing because a workspace with a
handful of pages is navigable by mouse alone. It becomes essential as the
workspace grows, and it is the difference between an application someone uses
daily and one they tolerate.

**Independent test**: Complete a full journey — create a folder, create a page
inside it, rename it, move it to the root, and open it — using only the
keyboard, with focus visible at every step.

**Acceptance scenarios**:

1. **Given** the sidebar has focus, **when** the owner uses arrow keys, **then**
   focus moves through the tree and the focused item is visibly distinct.
2. **Given** a collapsed folder is focused, **when** the owner expands it,
   **then** its children appear and focus behaviour follows the same rules as
   the rest of the tree.
3. **Given** a branch of the tree is still loading, **when** the owner looks at
   it, **then** the interface says it is loading rather than showing an empty
   branch.
4. **Given** the owner returns to a page after navigating away, **when** the
   page opens, **then** their previous position in the document is preserved.

---

### User Story 4 — Use it on a phone (Priority: P2)

The owner opens the workspace on a 320-pixel-wide screen and can read, write,
navigate, and see the save state. Nothing requires horizontal scrolling, and
no control is smaller than a finger.

**Why this priority**: The canvas requires usability from 320 pixels, and the
screen someone reaches for when they need a note is usually the one in their
pocket. It is P2 rather than P1 because the desktop journey is the one that
must exist first for either to be worth testing.

**Independent test**: Complete User Story 1 at a 320-pixel viewport width, with
no horizontal page scrolling at any point.

**Acceptance scenarios**:

1. **Given** a 320-pixel viewport, **when** any core screen is shown, **then**
   the page does not scroll horizontally.
2. **Given** a narrow viewport, **when** the owner opens the navigation,
   **then** it is reachable and dismissable without obscuring the editor
   permanently.

---

### User Story 5 — Trust the connection (Priority: P3)

The owner can see which server they are connected to, whether it is reachable,
whether the client and server versions are compatible, and whether the channel
is secure. An insecure non-local address is called out plainly.

**Why this priority**: Lower because the single-installation default path works
without it. It matters at the moment an owner moves to a real deployment, and
getting it wrong there is a security problem rather than an inconvenience.

**Independent test**: Point the client at a server over plain HTTP on a
non-local address and confirm the interface warns clearly and unmistakably.

**Acceptance scenarios**:

1. **Given** a non-local server address over plain HTTP, **when** the client
   connects, **then** the interface warns that the channel is not secure.
2. **Given** a client and server whose protocol versions are incompatible,
   **when** the client connects, **then** it says so rather than failing in an
   unrelated way later.

---

### Edge Cases

- A page whose stored document contains a block type this client version does
  not recognise: the unknown block must be preserved on save rather than
  dropped, and shown as unrenderable rather than as empty.
- An edit made while the local projection is locked (device key unavailable):
  the interface must refuse to accept the edit rather than accept it into a
  store it cannot seal.
- A very large document: the editor must remain responsive, and the acceptance
  threshold is stated in Success Criteria rather than left to judgement.
- Two blocks reordered in quick succession while offline: reconciliation must
  produce one of the two orders and say which, never an interleaving of both.
- A page open in two tabs of the same browser: the second tab must not silently
  overwrite the first tab's newer content.
- Paste from an external application containing rich text: the result must be
  representable in the internal model, and anything that is not must be
  reduced to text rather than stored as something the export path cannot emit.

---

## Requirements *(mandatory)*

### Functional Requirements

**Block editing**

- **FR-001**: The editor MUST support at minimum these block types: paragraph,
  heading (at least three levels), bulleted list, numbered list, checkbox,
  quote, code, divider, and link.
- **FR-002**: The owner MUST be able to insert a block through a slash command,
  a visible insertion control, and Markdown-style input shortcuts.
- **FR-003**: Blocks MUST be selectable, movable, transformable into another
  block type, duplicable, and deletable.
- **FR-004**: Every editing action listed in FR-002 and FR-003 MUST be
  undoable and redoable.
- **FR-005**: The stored document MUST use a documented internal content model
  with a defined export path, independent of the editing library used.
- **FR-006**: A block type the client does not recognise MUST be preserved
  unchanged when the document is saved, and MUST be displayed as unrenderable
  rather than omitted.

**Save state and data safety**

- **FR-007**: The interface MUST show, for the document being edited, which of
  these applies: unsaved local changes, sending, saved, or blocked.
- **FR-008**: The interface MUST NOT display a saved state before the server
  has confirmed the write.
- **FR-009**: Local edits MUST survive an unexpected close of the application
  and be present when it reopens.
- **FR-010**: When the server refuses a write, the interface MUST state what is
  refused, whether existing content is still readable, and what would resolve
  it.
- **FR-011**: When reconciliation produces a conflict, the interface MUST make
  the conflict visible and both versions reachable.

**Navigation and hierarchy**

- **FR-012**: The sidebar MUST allow browsing the tree, expanding and
  collapsing branches, creating a page or folder at a chosen location, moving
  items, and reaching favourites, recents, and settings.
- **FR-013**: The sidebar MUST show connection and synchronization state.
- **FR-014**: Navigation MUST preserve context when returning to a previously
  visited page, including the position within the document.
- **FR-015**: Every list or branch MUST have an explicit state for loading,
  empty, unavailable offline, and error, distinguishable from one another.
- **FR-016**: Pages, folders, and standalone files MUST be displayable at the
  same level of the tree.

**Keyboard and accessibility**

- **FR-017**: Every core journey — create, open, rename, move, delete, edit,
  and navigate — MUST be completable using the keyboard alone.
- **FR-018**: The focused element MUST be visually identifiable at all times.
- **FR-019**: The tree, the editor, and the navigation MUST expose semantics
  that assistive technology can convey, including the tree structure, the
  current selection, and each state named in FR-015.
- **FR-020**: State changes that matter to the owner — a save failing, a
  conflict appearing, a write becoming blocked — MUST be announced to
  assistive technology rather than only shown.

**Platform and compatibility**

- **FR-021**: The interface MUST remain usable at a viewport width of 320
  pixels, with no horizontal page scrolling.
- **FR-022**: The client MUST support the two most recent stable major versions
  of Chrome, Edge, Firefox, and Safari.
- **FR-023**: The client MUST report server reachability, protocol
  compatibility, channel security, and owner authentication state.
- **FR-024**: The client MUST warn when connected to a non-local address over
  an insecure channel.

**Preserving what exists**

- **FR-025**: This feature MUST NOT change the canonical identities, revision
  lineage, or mutation semantics established by feature 001.
- **FR-026**: This feature MUST NOT weaken any boundary established by feature
  002; in particular, document bodies MUST continue to be sealed on the server
  and in the local projection.

### Key Entities

- **Document**: the internal, editor-independent representation of a page's
  content, composed of ordered blocks. Already stored by feature 001 as a page
  document; this feature defines its block-level structure.
- **Block**: an addressable unit within a document, with a type, content, and
  optional children.
- **Editing session**: the owner's in-progress state for one document,
  including undo history and save state, which is not itself persisted content.
- **Navigation state**: the expanded branches, the current selection, and the
  scroll position that make returning to a page feel like returning rather than
  arriving.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner unfamiliar with the product can create a page containing
  a heading, a list, and a checkbox within 3 minutes of opening the workspace,
  without documentation.
- **SC-002**: In a usability protocol with 10 participants, at least 9 can
  state correctly whether their last edit was saved, when asked at an arbitrary
  moment during editing.
- **SC-003**: Every core journey is completable by keyboard alone, verified by
  an operator performing all of them without a pointing device.
- **SC-004**: An automated accessibility audit reports no critical or serious
  violations on the workspace, the editor, and the settings screens.
- **SC-005**: Typing in a document of 500 blocks produces visible output within
  100 milliseconds of the keystroke, at the 95th percentile.
- **SC-006**: A document of 500 blocks opens and becomes editable within 2
  seconds on a mid-range laptop.
- **SC-007**: No participant in the SC-002 protocol loses content during the
  session, including when the application is closed unexpectedly.
- **SC-008**: Every core screen is usable at 320 pixels wide with no horizontal
  scrolling, verified across the four supported browser engines.
- **SC-009**: A document containing an unrecognised block type round-trips
  through an edit and a save with that block unchanged, byte for byte.
- **SC-010**: The four save states named in FR-007 are each reachable and
  visually distinct, demonstrated by a recorded run of each.

---

## Assumptions

- **Databases and views (canvas section 14) are excluded from this feature.**
  The roadmap groups sections 11–14 together, but the constitution states that
  "advanced databases … MUST be delivered as separate specs rather than folded
  into the core feature." The constitution is the higher authority, and a
  feature that tried to deliver a block editor *and* a database with five view
  types would be neither reviewable nor independently testable. Checkbox blocks
  and simple in-page tasks remain in scope because they are editor blocks; a
  database entry with typed properties, saved filters, and Kanban or calendar
  views belongs to its own specification.
- **Tiptap is the presumed editor library** per the constitution, but FR-005
  requires the internal content model and export path to be documented and
  independent of it. The specification does not assume any library behaviour.
- **Offline editing already works** through feature 001's outbox and
  reconciliation. This feature adds the interface that explains it, not the
  mechanism.
- **The local projection is already sealed** by feature 002. Editing must
  refuse when the device key is unavailable rather than degrade to plaintext.
- **"Two most recent stable major versions"** is evaluated at release time
  rather than pinned to specific version numbers here.
- **Undo history is per-session and not persisted.** Restoring undo history
  across a reload is a larger problem involving the revision lineage, and no
  requirement here depends on it.
- **Favourites and recents are per-installation, not per-device.** The product
  is single-owner, so there is no reason for one device to disagree with
  another about what is a favourite.

---

## Out of scope

- Databases, typed properties, saved views, filters, sorting, and grouping
  (canvas section 14) — separate specification.
- File attachments, previews, Draw.io, and local storage quotas (sections
  15–18) — feature 004.
- Real-time transport, multi-device catch-up, and visual conflict resolution
  beyond making a conflict visible (sections 19–20) — feature 005.
- Search (section 21) — feature 007.
- Public sharing, plugins, import from other products, and collaborative
  editing — permanently out of scope for V1 or governed by their own specs.
