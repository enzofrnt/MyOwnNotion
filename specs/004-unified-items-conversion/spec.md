# Feature Specification: Unified Items and Page/Folder Conversion

**Feature Branch**: `004-unified-items-conversion`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Unified items and page/folder conversion: pages
and folders share one common base (title, hierarchy children including
standalone files, stable identity, owner-chosen order), and a page adds
editorial content plus its own content attachments shown as a second, separate
disclosure. The owner can convert a folder into a page (purely additive) and a
page into a folder (destructive: the editorial content and its content
attachments are removed, requiring an explicit confirmation naming what is lost
and stating that recovery is only possible within the revision retention
window). In both directions the item identity and everything below it in the
hierarchy are preserved."

**Product-canvas scope**: sections 10 (stable identities and relation types),
11 (pages, folders and hierarchy), 12 (sidebar and navigation), and 13 (page
content and links), all amended in the same change that raised this feature.

**Dependencies**: feature 001 (content foundations), whose canonical item kind
is currently fixed at creation and never changes; feature 003 (core workspace
experience), which supplies the block editor and internal page-link mark a
converted page opens in.

**Exclusions**: this feature does not add attachment *behaviour* — importing,
previewing and quotas remain with the files feature. It changes which item may
carry hierarchy children and how the two relations are presented, not what a
file is.

---

## Why this feature exists

The product canvas said, until this feature was raised, that "pages and folders
are two distinct objects". That sentence was wrong in a way that shaped the
code: a page can already contain sub-pages, sub-folders and standalone files,
exactly as a folder can. The two are not different natures. They are one base,
and a page adds a capability the folder does not have.

Because the canvas described two natures, the implementation made `kind` a
property fixed at creation. An owner who creates a page, then realises they
only wanted somewhere to file things, has no way back — and neither does an
owner who made a folder and later wants to write a paragraph at the top of it.
Their only option is to create a second item, move every child across, and
delete the first, which changes the identity of something that never stopped
being the same thing.

This feature makes the model say what the product means, and gives the owner
the operation that follows from it.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Turn a folder into a page (Priority: P1)

The owner has a folder holding a dozen related pages. They want a paragraph at
the top explaining what the folder is for. They convert it to a page and start
writing. Every child stays where it was.

**Why this priority**: It is the non-destructive direction, it delivers the
whole value of the feature on its own, and it can ship before the harder half
exists.

**Independent test**: Create a folder, put two pages and one file inside it,
convert it to a page, write a sentence, reload — the sentence is there and all
three children are still in place, in the same order.

**Acceptance scenarios**:

1. **Given** a folder with children, **when** the owner converts it to a page,
   **then** it gains editorial content and every child keeps its place and
   order.
2. **Given** a folder being converted, **when** the conversion completes,
   **then** the item's identity is unchanged and any link or reference to it
   still resolves.
3. **Given** a newly converted page, **when** the owner writes in it, **then**
   the content saves like any other page's.
4. **Given** a folder, **when** the owner converts it, **then** no confirmation
   is demanded, because nothing is lost.

---

### User Story 2 — Turn a page into a folder (Priority: P1)

The owner made a page, wrote nothing in it, and now realises it is only a
container. They convert it to a folder. If the page did hold content, the
interface tells them plainly what will be destroyed and how long they have to
undo it before agreeing.

**Why this priority**: Equal to US1 because "you can change your mind" is only
true if it works both ways. An owner who knows the conversion is one-way will
hesitate at creation, which is the friction this feature exists to remove.

**Independent test**: Create a page with a heading and a paragraph and two
child pages, convert it to a folder, confirm the warning names the content
loss, and verify afterwards that the children are intact and the text is gone
but restorable.

**Acceptance scenarios**:

1. **Given** a page with editorial content, **when** the owner asks to convert
   it, **then** a confirmation appears naming what will be destroyed and
   stating the limited window for recovery.
2. **Given** that confirmation, **when** the owner declines, **then** nothing
   changes at all.
3. **Given** a page with children and content, **when** the conversion
   completes, **then** the content is gone and every child is still in place
   and in order.
4. **Given** a page with attachments bound to its content, **when** it becomes
   a folder, **then** those attachments are removed with the content, and the
   confirmation said so.
5. **Given** a converted page, **when** the owner restores the revision from
   before the conversion within the retention window, **then** the content
   comes back.
6. **Given** an empty page with no content, **when** the owner converts it,
   **then** the interface may state there is nothing to lose rather than
   warning about content that does not exist.

---

### User Story 3 — See the two relations a page has (Priority: P2)

The owner opens a page in the sidebar. They expand it and see the pages,
folders and files filed under it. Separately, a control shows the attachments
belonging to the page's own text. The two never appear as one list.

**Why this priority**: One below the conversions because the underlying
distinction already exists in stored data; what is missing is showing it. It is
still required, because conflating the two is how a filed document appears to
vanish.

**Independent test**: Put a file under a page in the hierarchy and attach a
different file to the page's content, then confirm each appears in its own
place and neither appears in both.

**Acceptance scenarios**:

1. **Given** a page with hierarchy children, **when** the owner expands it in
   the sidebar, **then** the children appear as they would under a folder.
2. **Given** a page with content attachments, **when** the owner opens the
   attachments control, **then** those attachments appear there and not in the
   hierarchy.
3. **Given** a folder, **when** the owner looks at it, **then** it offers the
   hierarchy disclosure only, and no attachments control.
4. **Given** a file filed under a page, **when** the owner looks at the tree,
   **then** it is visible there rather than hidden inside the page.

---

### User Story 4 — Put things exactly where you want them (Priority: P2)

The owner moves an item anywhere in the tree and orders siblings by hand, and
the arrangement holds. Converting an item changes none of it.

**Why this priority**: Largely delivered by feature 001; this story exists to
state that the conversion must not disturb it, and to close the gap where
ordering is not fully under the owner's control.

**Independent test**: Arrange four siblings in a deliberate order, convert one
of them, and confirm the order is unchanged after a reload.

**Acceptance scenarios**:

1. **Given** siblings in an owner-chosen order, **when** one is converted,
   **then** the order is unchanged.
2. **Given** an item anywhere in the tree, **when** the owner moves it to
   another parent, **then** it keeps its identity and its own children.
3. **Given** an item targeted by an internal page link, **when** it is
   converted, **then** the link keeps resolving to that same canonical item
   and does not become a hierarchy placement.

---

### Edge Cases

- Converting a page to a folder while an edit is still unsaved: the pending
  edit must not resurrect content after the conversion, and the owner must not
  be told the edit was saved when it was discarded.
- Converting while offline: the conversion follows the same offline rules as
  every other change, and its confirmation must not promise a durability the
  device cannot yet have.
- Converting an item that is the target of an internal page-link relationship:
  the reference must still resolve, because the identity did not change, and
  the link must not be added to the hierarchy.
- Converting a page whose content is unreadable — a corrupt or undecryptable
  body: the destruction must not be presented as routine when the interface
  cannot show what is being destroyed.
- Two devices converting the same item in opposite directions: reconciliation
  must produce one outcome and say which, never an item that is both.
- Converting a folder to a page twice in quick succession: the second must be a
  no-op rather than an error or a duplicated document.

---

## Requirements *(mandatory)*

### Functional Requirements

**The unified item**

- **FR-001**: Pages and folders MUST share one base: a title, a stable
  identity, an owner-chosen position among siblings, and hierarchy children.
- **FR-002**: Both pages and folders MUST be able to hold pages, folders and
  standalone files as hierarchy children.
- **FR-003**: Only a page MUST be able to hold editorial content, and only a
  page MUST be able to hold attachments bound to that content.
- **FR-004**: An item's kind MUST be changeable after creation.

**Conversion**

- **FR-005**: The owner MUST be able to convert a folder into a page.
- **FR-006**: The owner MUST be able to convert a page into a folder.
- **FR-007**: Conversion MUST preserve the item's identity, so that every
  existing reference, including a non-hierarchical internal page link, continues
  to resolve.
- **FR-008**: Conversion MUST preserve every hierarchy child, its parent
  relationship and its order, in both directions and without exception.
- **FR-009**: Converting a folder into a page MUST NOT destroy anything and
  MUST NOT require a confirmation.
- **FR-010**: Converting a page that holds content into a folder MUST require
  an explicit confirmation that names what will be destroyed — the editorial
  content and the attachments bound to it — before anything is changed.
- **FR-011**: That confirmation MUST state that recovery is possible only
  within the revision retention window, not indefinitely.
- **FR-012**: A conversion MUST produce a revision, so the previous state is
  restorable by the existing history mechanism for as long as it is retained.
- **FR-013**: Declining the confirmation MUST leave the item completely
  unchanged.
- **FR-014**: The guarantees in FR-007 to FR-012 MUST hold in the domain rather
  than depending on the interface, so that no client can perform a destructive
  conversion without them.

**Presentation**

- **FR-015**: A page MUST present its hierarchy children and its content
  attachments as two separate disclosures.
- **FR-016**: A folder MUST present the hierarchy disclosure only.
- **FR-017**: The interface MUST make a page visually distinguishable from a
  folder, and MUST reflect a conversion without requiring a reload.
- **FR-018**: Conversion MUST be reachable and completable using the keyboard
  alone, and its confirmation MUST be announced to assistive technology.
- **FR-018a**: Conversion MUST preserve the distinction between a hierarchy
  child and an internal page link; a page link MUST NOT be rendered or stored as
  a new child placement.

**Preserving what exists**

- **FR-019**: This feature MUST NOT weaken any boundary established by feature
  002; document bodies MUST remain sealed.
- **FR-020**: This feature MUST NOT change the revision lineage or mutation
  semantics established by feature 001, beyond making the kind mutable.

### Key Entities

- **Item**: the unified hierarchy element. Carries a title, an identity, a
  position, a kind, and children. Already exists; this feature makes its kind
  mutable and states the base explicitly.
- **Kind**: which capabilities an item has. Today fixed at creation, and
  changeable after this feature.
- **Hierarchy child**: a page, folder or standalone file filed under an item.
- **Content attachment**: a file bound to a page's editorial content. Distinct
  from a hierarchy child, and only a page has any.
- **Conversion**: the named operation changing an item's kind, producing a
  revision and, in the destructive direction, requiring confirmation.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An owner can convert a folder to a page and write in it within 30
  seconds, without documentation.
- **SC-002**: In 100% of conversions, in both directions, every hierarchy child
  is still present, under the same parent, in the same order.
- **SC-003**: In 100% of conversions, the item's identity is unchanged and every
  reference to it still resolves.
- **SC-004**: No conversion that destroys content completes without an explicit
  confirmation naming what is lost.
- **SC-005**: Content destroyed by a conversion is restorable for the full
  retention window, verified by restoring it.
- **SC-006**: A page's hierarchy children and its content attachments never
  appear in the same list, verified across every screen that shows either.
- **SC-007**: Both conversions are completable by keyboard alone.
- **SC-008**: An automated accessibility audit reports no critical or serious
  violations on the conversion flow, including its confirmation.
- **SC-009**: Converting an item in a workspace of 1,000 items completes within
  2 seconds from the owner's perspective.

---

## Assumptions

- **The revision retention window is the existing one.** The confirmation must
  state the limit rather than a number chosen here, so that changing the
  retention policy does not leave the warning lying.
- **A destructive conversion discards content rather than hiding it.** Keeping
  the text invisibly attached to a folder was considered and rejected: it would
  leave data no screen shows and no owner can audit, which is worse than a loss
  they were warned about and can undo.
- **Standalone files remain files.** This feature does not make a file
  convertible into a page or folder; the base is shared by pages and folders
  only.
- **Content attachments follow the content.** When a conversion destroys a
  page's content, the attachments bound to that content go with it, because a
  folder has nothing to bind them to. Files filed in the hierarchy are
  untouched.
- **A broad refactor is acceptable.** The application is not in production, so
  the item model may be reshaped and the existing migrations collapsed into a
  single initial migration rather than carrying compatibility for data that
  does not exist. This assumption expires the moment an installation is
  deployed.
- **Conversion is a single named operation**, not a rename that happens to
  change a field, so that its guarantees can be enforced where the data is
  rather than where the buttons are.

---

## Out of scope

- Attachment behaviour — importing, previewing, quotas, offline availability —
  which belongs to the files feature.
- Converting files into pages or folders, or converting anything into a file.
- Bulk conversion of several items at once.
- Databases, typed properties and views, which the constitution requires to be
  a separate specification.
- Any change to how content is sealed, rotated or recovered.
