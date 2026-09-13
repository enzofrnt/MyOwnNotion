# Feature Specification: Readable editable code blocks

**Feature Branch**: `codex/027-code-block-ui`

**Created**: 2026-09-05

**Status**: Implemented; focused integration validated, delivery gate pending

**Input**: The owner finds the existing code blocks unattractive and missing syntax colors.

## Product direction and scope

Refines the product canvas sections 4.1–4.3 (ownership and local resilience),
7 (320 px and supported browsers), 10 (canonical content), 13 (editable blocks,
undo and local durability), 18–20 (offline and concurrent owner devices), 27
(portability), and 43.6 (visual quality). Depends on the existing block editor,
local editing sessions and themes. No product boundary changes, execution of
code, new editor authority, import feature, schema migration, or extra account.

## User Scenarios & Testing

### User Story 1 - Read and edit code comfortably (Priority: P1)

The owner reads and edits source code in one tidy surface with a visible
language choice, useful syntax colors and preserved whitespace.

**Independent Test**: Insert a code block, choose a supported language, type and
edit a multiline snippet, then switch light/dark themes and use a narrow viewport.

**Acceptance Scenarios**:

1. Given a supported language, when its code is displayed or edited, keywords,
   strings and comments have distinguishable theme-appropriate colors; source
   text, caret and selection remain editable in place.
2. Given a long line at 320 px, when the owner reads it, the code surface scrolls
   horizontally without causing page overflow or hiding the toolbar.
3. Given an empty, plain-text or unknown-language block, when opened, it remains
   readable and editable; an unknown stored language remains visible and intact.
4. Given a cached page offline, when editing or changing language and undoing /
   redoing, the exact source and language survive reopening and synchronization.
5. Given an ongoing composition or an incoming edit from another owner device,
   when syntax decorations update, composition, caret and source are preserved.

### User Story 2 - Copy source confidently (Priority: P2)

The owner copies the exact plain source using a stable button and sees success
or recoverable failure beside the action.

**Independent Test**: Copy a multiline source containing markup and Unicode;
verify exact plain text. Refuse clipboard access, retry, and inspect feedback.

**Acceptance Scenarios**:

1. Given a block, when Copy succeeds, exact source is copied and local success
   feedback appears temporarily without moving or replacing the control.
2. Given a clipboard refusal or unavailable clipboard, when Copy is activated,
   local failure is visible and a later retry remains possible.
3. Given pointer or keyboard interaction, when activation completes, the action
   runs once; releasing outside the button cancels it. Read-only blocks allow
   copying while language edits remain disabled.

### Edge Cases

Empty source; tabs and trailing newlines; markup is text, never executable HTML;
unknown or aliased language from older data; long lines; denied clipboard;
repeated copy; active IME composition; undo after language change; incoming owner
device edits; highlighting initialization while a block is being edited.

## Requirements

### Functional Requirements

- **FR-001**: Code blocks MUST have a single coherent surface, aligned toolbar,
  readable monospace source, and keyboard-visible language/copy controls.
- **FR-002**: Supported source languages MUST receive syntax colors in both
  themes during editing using only assets shipped with the application.
- **FR-003**: Plain text and unknown languages MUST remain editable and preserve
  their original language value; selecting a known language is an explicit edit.
- **FR-004**: Source, language, block identity, caret/selection, undo/redo,
  composition and incoming owner-device edits MUST retain existing semantics.
- **FR-005**: Code whitespace MUST remain exact; long lines MUST scroll inside
  the code surface at widths of 320 px and above.
- **FR-006**: Copy MUST write plain source only and display temporary local
  success or failure feedback with a stable, retryable action.
- **FR-007**: Rendering MUST NOT require network access, execute source, weaken
  content security policy, add persistence fields or alter exports.
- **FR-008**: Read-only content MUST remain readable and copyable while the
  language control disallows changes.

### Key Entities

- Code block: existing stable block identity, plain source and optional language.
- Copy feedback: transient local UI state; never synchronized or persisted.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Browser journeys demonstrate distinguishable source token colors
  in light/dark themes, keyboard edits and confined scrolling at 320 px.
- **SC-002**: Automated checks show exact text/language through edit, undo/redo,
  offline reload and incoming owner-device update without syntax markup in data.
- **SC-003**: Clipboard success and refusal are visible beside a stable control,
  and copied multiline Unicode/markup equals the original source exactly.
- **SC-004**: A 100-line code sample remains editable with syntax colors; all
  highlighting assets are available from the built application offline.

## Assumptions

No auto-detection: plain text is the default, language choice is explicit. Cover
existing languages and common Python, JSX, YAML and Markdown, preserving aliases
and unsupported metadata for future import. Code execution, line numbers,
formatting, autocomplete and wrapping preferences are outside this change.
