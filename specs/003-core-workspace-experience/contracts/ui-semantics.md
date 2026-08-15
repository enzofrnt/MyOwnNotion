# Contract: keyboard, semantics, and announcements

**Requirements**: FR-015, FR-017 to FR-021, SC-003, SC-004, SC-008

An interface contract, in the sense the plan template means: what the client
exposes to a keyboard, to assistive technology, and to a narrow screen. It is
written as a contract rather than as guidance because these are the properties
the Playwright journeys assert, and an assertion needs a fixed target.

## The tree (FR-012, FR-017, FR-019)

Follows the ARIA authoring-practices tree pattern, which is chosen over
inventing one so that the behaviour matches what a screen-reader user already
expects.

| Element | Role |
|---------|------|
| the sidebar tree | `tree` |
| a page, folder, or file | `treeitem`, with `aria-expanded` when it has children and `aria-selected` on the current item |
| a group of children | `group` |

**Keys**, all required by SC-003:

| Key | Effect |
|-----|--------|
| `↑` / `↓` | previous / next visible item |
| `→` | expand, or move to the first child if already expanded |
| `←` | collapse, or move to the parent if already collapsed |
| `Home` / `End` | first / last visible item |
| `Enter` | open |
| `F2` | rename |
| `Delete` | delete, with confirmation |
| typing a letter | jump to the next item starting with it |

**One tab stop.** The tree takes a single position in the page's tab order, and
arrow keys move within it (roving tabindex). A tree where every item is a tab
stop is technically keyboard-accessible and unusable at a hundred pages, which
is the distinction FR-017 and SC-003 are about.

## The editor (FR-002, FR-003, FR-004, FR-017)

| Key | Effect |
|-----|--------|
| `/` at the start of an empty block | slash menu |
| `# ` `## ` `### ` `- ` `1. ` `> ` ``` ``` ``` `[] ` | the matching block, with the shortcut characters consumed (US1 scenario 1) |
| `Ctrl/⌘ Z`, `Ctrl/⌘ ⇧ Z` | undo, redo |
| `Ctrl/⌘ ⇧ ↑ / ↓` | move the current block |
| `Escape` | leave the editor for the surrounding page — the escape hatch that keeps the editor from being a keyboard trap |
| `Tab` / `⇧ Tab` inside a list | indent, outdent |

`Tab` indents **only** inside a list item; everywhere else it moves focus. An
editor that swallows `Tab` unconditionally is a keyboard trap, which is a
failure of FR-017 rather than a convenience.

The slash menu is a `listbox` with `aria-activedescendant`; the block controls
are real buttons with accessible names, not icons with a title attribute.

## States (FR-015)

Every list or branch renders exactly one of: **loading**, **empty**,
**unavailable offline**, **error**, or content. Each is a distinct, readable
statement — never a blank area, and never two of them at once. Loading uses
`aria-busy`; error and offline are `role="status"` regions so they reach
assistive technology.

The rule that makes this testable: a branch with no content and no explanation
is a defect, not a rendering state.

## Announcements (FR-020)

A polite live region carries state changes an owner would otherwise have to
watch for: a save failing, a conflict appearing, a write becoming blocked, a
block being moved or deleted. Ordinary typing is not announced — a live region
that narrates everything is one an owner turns off, after which it announces
nothing.

## Focus (FR-018)

A visible focus indicator on every interactive element, meeting contrast in
both themes, never removed without a replacement. After a destructive or
navigational action, focus moves somewhere deliberate: to the next sibling
after a delete, into the new item after a create, back to the trigger after a
dialog closes. Focus landing on `<body>` is a defect.

## Narrow viewport (FR-021, SC-008)

At 320 pixels: no horizontal page scrolling, on any core screen. The sidebar
becomes an overlay that is dismissable by `Escape` and by a visible control, and
returns focus to whatever opened it. Wide content — a code block, a long
unbroken link — scrolls inside its own container rather than widening the page.
Touch targets are at least 44 by 44 pixels.

The single assertion behind SC-008, used by every viewport test:

```ts
document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
```

## Audit (SC-004)

`@axe-core/playwright` on the workspace, the editor, and the settings screens.
No `critical` or `serious` violation. The audit does not replace the journey
tests: axe cannot tell whether `→` expands a folder, and that is most of what
FR-017 asks for.
