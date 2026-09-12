# Implementation Plan: Code block UI

**Branch**: `codex/027-code-block-ui` | **Date**: 2026-09-05
**Spec**: [spec.md](spec.md)

## Summary

Activate BlockNote 0.54's `SyntaxHighlightingExtension` for the existing custom
`codeBlock` via `meta.highlight`. Ship an explicit Shiki 4.4.3 fine-grained
language bundle with the JavaScript regex engine and light/dark themes. Use
ProseMirror decorations over the existing `contentRef`, never a second editable
surface or generated HTML. Remove duplicate framing and retain native select
keyboard behavior with common Button/AppIcon controls and local copy feedback.

## Technical Context

Repository-pinned Bun 1.4.2; TypeScript; React 19; BlockNote 0.54; Shiki 4.4.3; existing operational
page sessions, canonical domain code blocks and theme tokens. Browser tests use
Playwright production preview; focused Vitest tests prove grammar and lossless
metadata handling. No storage, API, permission, migration or deployment change.

## Constitution Check

Pass before and after design: one owner, same encryption/persistence boundaries,
offline grammar assets, canonical export unchanged, no code execution or CSP
relaxation. Source remains managed by ProseMirror and existing CRDT adapter.
Canvas sections 4, 7, 10, 13, 18–20, 27 and 43.6 govern this refinement. UI uses
`.agents/skills/ui-quality/SKILL.md`, actual global.css loaded by main.tsx, common
Button/AppIcon and semantic theme colors. Dedicated isolated worktree only.

## Architecture and files

- `apps/web/src/features/editor/code-highlighting.ts`: explicit grammar imports,
  language labels and alias lookup; bounded single shared highlighter.
- `apps/web/src/features/editor/page-editor.tsx`: install highlighting extension.
- `apps/web/src/features/editor/custom-blocks/code-block.tsx`: highlight metadata,
  visible language control, unknown value preservation, copy feedback lifecycle.
- `apps/web/src/global.css`: single code surface, horizontal scroll, token colors
  through dual-theme Shiki CSS variables, stable toolbar, responsive targets.
- `apps/web/src/ui/copy/fr.ts`: localized feedback and copy labels.
- `apps/web/tests/code-highlighting.spec.ts`, `tests/e2e/code-block-ui.spec.ts`:
  grammar fidelity, unknown aliases, editing, themes, copy, overflow and reload.

## Security, ownership and operations

Source is only tokenized locally and copied as plain text. Grammar definitions
and themes are static imports in the application build/precache, without CDN,
fetch, WASM or eval. Shiki tokens decorate text nodes, not HTML injection.
Selection, IME, history and remote adoption retain the existing editor authority.
Unsupported metadata has a fallback select option and no silent normalization.
No changes to canonical conversion/export APIs; no migrations or new secrets.

## Validation and delivery

Implement T001 onward after read-only consistency analysis. Verify grammar
round trips and existing editor suites, typecheck, format/lint and production
build. Run meaningful browser editing/clipboard/theme/320 px/offline journeys and
inspect screenshots. Parent coordinates complete `bun run checks:local`, branch
push, PR and merge against the integrated changes; this subtask commits locally
only. Record actual results and limitations in validation.md, converge and keep
pending delivery gates visible in tasks.md.

## Convergence refinement

Native Android Enter needs a small `code-block-input.ts` BlockNote extension
using a ProseMirror beforeinput handler. It inserts a literal newline into the
current code selection for insertParagraph/insertLineBreak only, preserving
composition, readonly behavior, undo and the same operational adapter. See the
reproduced browser evidence in research.md and T013. Focused tests live in
`apps/web/tests/code-block-input.spec.ts`; toolbar tests are in
`apps/web/tests/code-block-toolbar.spec.tsx` alongside highlighter tests.

The native beforeinput handler also prevents iOS wrapper splitting. Its per-view
weak set consumes the subsequent synthetic ProseMirror Enter once, then resets
on a new DOM keydown. This uses public plugin events, without private editor
state or user-agent branching; every source change remains a normal transaction.
