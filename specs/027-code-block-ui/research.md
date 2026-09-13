# Research: Code block UI

## Existing editor source (BlockNote 0.54.0, installed source)

`SyntaxHighlightingExtension` collects plain-content specs declaring
`implementation.meta.highlight`. Its lazy parser uses prosemirror-highlight and
Shiki, preserving contentDOM and applying text decorations. It supports dual
light/dark loaded themes through `--shiki-light` / `--shiki-dark`. Our custom
block currently has neither metadata nor the extension and is styled twice.

Decision: use this public extension and retain canonical custom block. Replacing
with default BlockNote block or a textarea overlay risks canonical props,
keyboard behavior or selection. No bespoke parser/plugin is warranted.

## Offline highlighting and CSP

Decision: explicit Shiki 4.4.3 core, JavaScript regex engine, selected grammars and
GitHub light/dark themes. Include static imports in the app bundle. Core uses no
filesystem and JS engine needs no WASM/eval exception. Plain/unknown inputs fall
back to text. Language matching normalizes for highlighting only.

Primary sources consulted 2026-09-05:

- [Fine-grained bundles](https://shiki.style/guide/bundles)
- [Regex engines](https://shiki.style/guide/regex-engines)
- [Performance guidance](https://shiki.style/guide/best-performance)

Alternatives: full lazy language registry (unnecessary offline bundle footprint),
Oniguruma WASM (unnecessary CSP/runtime requirement), handwritten regex
highlighter (insufficient language fidelity), generated highlighted HTML
(replaces editable ownership and risks caret/composition).

## UI decisions

One framed surface, compact language at left and copy at right. Native select
keeps familiar keyboard/touch behavior and remains focusable. Unknown stored
language appears verbatim until explicitly changed. Copy feedback is a separate
visible live status below the toolbar, preserving button identity/width.

## Browser evidence: native mobile Enter

The first Chromium mobile journey exposed a missing newline after Enter.
Instrumentation shows Android ProseMirror skips its Enter keymap, letting
`beforeinput(inputType=insertParagraph)` split the custom React contentDOM's
wrapper. Its parsed plain block loses that separator. This is not a syntax
color or persistence change. Add a narrowly scoped ProseMirror beforeinput
handler for insertParagraph/insertLineBreak inside one code block, outside
composition and only when editable. Prevent the native DOM split and insert a
literal newline through the existing transaction. Desktop keymaps already
consume Enter, so their gesture does not generate this fallback event.

The final handler covers native mobile line breaks without user-agent sniffing.
ProseMirror iOS schedules a synthetic Enter after native input; a per-view weak
set consumes that synthetic fallback exactly once when beforeinput already
inserted the newline. Every fresh DOM keydown clears the marker, preserving
rapid repeated Enter gestures. Browser assertions compare exact textContent as
well as stored text, including after offline reload (no whitespace normalization).

## Cold grammar compilation

Focused repeated runs exposed a cold JavaScript-regex compilation exhausting
Shiki's default per-line tokenization budget, leaving JavaScript comments and
following lines uncolored. Compile each shipped grammar against a fixed, tiny
trusted sample before the shared highlighter resolves. Only this fixed sample
disables the timeout; actual owner source keeps the default time budget.
