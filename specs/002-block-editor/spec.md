# Feature Specification: Block Editor

**Feature Branch**: `codex/block-editor`

**Created**: 2026-08-07

**Status**: Implemented — CI browser and shell evidence pending

**Input**: User description: "Définir les prochaines étapes du produit et commencer la prochaine feature de la roadmap : un véritable éditeur de pages par blocs, utilisable hors ligne et compatible avec les fondations de contenu existantes."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Write and Format a Page (Priority: P1)

As the workspace owner, I can write and structure a page with common block types so that the page is useful for notes, documentation, and simple task lists rather than exposing a raw document value.

**Why this priority**: Page authoring is the central product capability and the next roadmap dependency for links, tasks, databases, and imports.

**Independent Test**: Open a page, enter paragraphs, headings, lists, checklist items, a quote, a code block, and a divider, reload the application, and confirm that structure and content are preserved.

**Acceptance Scenarios**:

1. **Given** an existing page, **When** the owner opens it, **Then** its title and editable document appear with a visible insertion point and understandable empty state.
2. **Given** an open page, **When** the owner enters and formats supported content, **Then** the document preserves paragraph, heading, bullet-list, ordered-list, checklist, quote, code-block, and divider structure.
3. **Given** an accepted edit, **When** the application reloads, **Then** the same document content and structure reappear without data loss.
4. **Given** a folder or file is selected, **When** the detail surface opens, **Then** the page editor is not offered for that content type.
5. **Given** a keyboard-only session, **When** the owner moves through and edits the document, **Then** focus remains visible and every formatting action remains available without a pointer.

---

### User Story 2 - Insert Blocks with Commands (Priority: P2)

As the workspace owner, I can type `/` to discover and insert a block so that I do not need to memorize formatting controls or leave the keyboard.

**Why this priority**: A discoverable command menu makes block editing efficient while keeping the interface compact.

**Independent Test**: Type `/` on an empty line, filter the command list, navigate it with the keyboard, insert each supported block type, and dismiss it without changing content.

**Acceptance Scenarios**:

1. **Given** an editable empty block, **When** the owner types `/`, **Then** a labelled command list shows the supported block types and short descriptions.
2. **Given** an open command list, **When** the owner types a query, **Then** the list filters without changing existing page content.
3. **Given** an open command list, **When** the owner uses arrow keys and confirms a command, **Then** the chosen block replaces the command text and receives focus.
4. **Given** an open command list, **When** the owner presses Escape or clicks elsewhere, **Then** the menu closes without applying a command.

---

### User Story 3 - Use Familiar Markdown Shortcuts (Priority: P3)

As the workspace owner, I can use familiar Markdown-like input patterns so that common formatting remains fast and portable.

**Why this priority**: Keyboard-first authoring should not depend only on toolbars or command menus.

**Independent Test**: At the beginning of empty blocks, type the documented heading, list, quote, task, code, and divider patterns and verify that each becomes the intended block while ordinary text remains unchanged.

**Acceptance Scenarios**:

1. **Given** an empty block, **When** the owner enters a supported Markdown-like prefix followed by its activation key, **Then** the block changes to the documented type.
2. **Given** text that only resembles a shortcut in the middle of a block, **When** the owner continues typing, **Then** it remains ordinary text.
3. **Given** a transformed block, **When** the owner immediately undoes the transformation, **Then** the literal input is recoverable.

---

### User Story 4 - Keep Editing Through Connectivity Changes (Priority: P1)

As the workspace owner, I can continue editing a previously loaded page while offline and understand whether changes are local, pending, synchronized, or conflicted.

**Why this priority**: Offline editing and honest durability status are constitutional guarantees inherited from the content foundations.

**Independent Test**: Load a page, disconnect the server, edit and reload, reconnect, and verify that the local document survives and is submitted once without falsely claiming server durability.

**Acceptance Scenarios**:

1. **Given** a previously loaded page and an unavailable server, **When** the owner edits the document, **Then** the edit is durably stored locally before success is shown.
2. **Given** offline edits, **When** the application reloads before reconnection, **Then** the complete edited document and pending state remain available.
3. **Given** pending edits and a restored connection, **When** synchronization succeeds, **Then** the page shows the synchronized state without duplicating the mutation.
4. **Given** a competing server revision, **When** the pending edit is rejected, **Then** the local version remains recoverable and the interface reports an unresolved conflict.

### Edge Cases

- The owner opens an empty or legacy page document whose body does not yet contain editor blocks.
- The owner pastes plain text containing line breaks, extremely long words, or unsupported rich formatting.
- The command menu has no result for a query.
- A block contains only whitespace and is changed to another block type.
- A checklist item contains nested text formatting.
- The browser closes while a local save is in progress.
- A delayed older save completes after a newer edit.
- The page is trashed or becomes unavailable while still open in the editor.
- The stored document contains an unknown future block or mark type.
- A document is large enough that rendering or saving cannot meet the normal interaction target.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a page-only editing surface that never appears as an editable document for folders or files.
- **FR-002**: The editor MUST support paragraphs, three heading levels, bulleted lists, ordered lists, checklist items, block quotes, fenced code blocks, and horizontal dividers.
- **FR-003**: Text blocks MUST support bold, italic, strike-through, and inline-code emphasis.
- **FR-004**: The owner MUST be able to create, change, split, join, reorder through editing operations, and remove supported blocks without editing a raw serialization.
- **FR-005**: The editor MUST preserve supported document structure and text across save, reload, offline restart, synchronization, export, and later re-editing.
- **FR-006**: An empty page MUST present a clear writing affordance without inserting visible placeholder content into the saved document.
- **FR-007**: The editor MUST expose a discoverable `/` command menu for every supported block type.
- **FR-008**: The command menu MUST support query filtering, keyboard navigation, confirmation, dismissal, and an explicit empty-result state.
- **FR-009**: The editor MUST document and support Markdown-like input shortcuts for headings, lists, checklist items, quotes, code blocks, and dividers.
- **FR-010**: Shortcut recognition MUST be limited to the documented input context and MUST NOT transform matching text unexpectedly in the middle of ordinary content.
- **FR-011**: The owner MUST be able to undo and redo content and structural editing operations during the active editing session.
- **FR-012**: Each accepted local edit MUST update the durable local page projection and pending-change record atomically before the interface reports it as saved.
- **FR-013**: Rapid edits MUST be coalesced safely so an older delayed save cannot overwrite a newer document state.
- **FR-014**: Reconnection MUST submit each pending document mutation idempotently with its causal base revision.
- **FR-015**: Rejected concurrent edits MUST preserve the local document, its base revision, and the competing revision as recoverable conflict data.
- **FR-016**: Saving and synchronization states MUST distinguish editing, saving locally, saved locally, pending synchronization, synchronizing, synchronized, and conflicted states.
- **FR-017**: The document format MUST be versioned and MUST preserve stable block structure without depending on rendered HTML as the canonical value.
- **FR-018**: Unknown future block or mark types MUST fail visibly or remain losslessly preserved; they MUST NOT be silently deleted during editing or saving.
- **FR-019**: Copying selected content MUST provide useful plain text, and pasting plain text MUST create editable content without requiring network access.
- **FR-020**: Every editing and formatting action MUST be keyboard accessible with visible focus and meaningful accessible names.
- **FR-021**: The editor MUST remain usable on the supported desktop and mobile viewport matrix without horizontal page-level overflow.
- **FR-022**: Document persistence and diagnostic output MUST NOT log private page content.
- **FR-023**: Canonical workspace export MUST represent the versioned editor document without omitting supported blocks or text formatting.
- **FR-024**: The feature MUST provide a documented compatibility path for legacy empty page bodies created by the content-foundations feature.

### Key Entities

- **Page Document**: The versioned canonical editable content associated with exactly one page.
- **Block**: An ordered structural document element with a supported type and type-specific attributes or content.
- **Text Span**: Text content within a compatible block, optionally carrying supported emphasis marks.
- **Editor Selection**: The current caret or range used for commands and formatting; it is session state rather than canonical content.
- **Editor Mutation**: One locally accepted document change with a stable mutation identity and causal base revision.
- **Command Item**: A discoverable action that converts the current input context into a supported block.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Automated acceptance journeys create every supported block and mark, reload the page, and recover 100% of the entered text, structure, order, and checklist state.
- **SC-002**: A keyboard-only owner can create a formatted page containing a heading, paragraph, checklist, quote, code block, and divider without using a pointer.
- **SC-003**: Every documented command and Markdown shortcut produces the intended block in acceptance tests, while the complete negative fixture set remains ordinary text.
- **SC-004**: After an offline edit and full client reload, 100% of the accepted document and its pending state remain available before reconnection.
- **SC-005**: Repeated delivery of a pending document mutation results in one logical server change, and every simulated competing revision preserves both recoverable versions.
- **SC-006**: For a representative 2,000-block page, 95% of measured local keystroke-to-visible-update samples complete within 100 milliseconds on the reference test device.
- **SC-007**: Automated accessibility checks find zero critical violations in the editor, toolbar, and command menu, and all controls expose meaningful names and visible focus.
- **SC-008**: Export round-trip validation preserves 100% of supported editor blocks, text, marks, and document format-version metadata.
- **SC-009**: Across all supported responsive viewports, the page editor introduces zero horizontal page-level overflow and keeps the active block visible during keyboard editing.
- **SC-010**: Private page text appears in zero application diagnostic records across successful saves, validation failures, offline retries, and conflict handling tests.

## Assumptions

- This feature serves the permanent single owner and does not add authentication, permissions, or collaborative cursors.
- The existing page identity, revision, local projection, outbox, reconciliation, export, and deployment foundations remain authoritative.
- Rich automatic merge of concurrent document edits is out of scope; conflicts preserve both versions for a later resolution feature.
- Wiki links, backlinks, database properties, embeds requiring remote providers, file previews, comments, and public sharing require separate specs.
- Block drag-and-drop is not required for the first editor release; keyboard and standard editing operations provide the initial ordering behavior.
- The supported Markdown-like shortcut set is documented with the product and may be expanded only with corresponding acceptance tests.
- Unsupported pasted rich formatting may be reduced to supported structure and plain text, but private content must not leave the device during conversion.
- The production composition remains loopback-only until authentication and authorization are implemented.

## Scope Boundaries

### Included

- Page-only rich block editing for the specified block and mark set.
- Toolbar and slash-command discovery.
- Markdown-like input shortcuts.
- Undo and redo within the active editing session.
- Offline-first local durability, reconciliation, and conflict preservation for page documents.
- Versioned canonical document persistence and export compatibility.
- Responsive and accessible keyboard operation.

### Excluded

- Authentication, permissions, sharing, comments, and collaborative presence.
- Real-time co-editing, CRDTs, operational transforms, and automatic rich-text conflict merge.
- Wiki links, backlinks, graph visualization, database properties, tasks aggregation, and search indexing.
- Images, remote embeds, file previews, drawing, and canvas behavior.
- Import from or exact visual compatibility with Notion or other editors.
