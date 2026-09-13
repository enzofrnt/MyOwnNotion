# Tasks: Code block UI

## Phase 1 — Setup

- [x] T001 Read governing artifacts, inspect installed BlockNote and record decisions in specs/027-code-block-ui/research.md.
- [x] T002 Create spec.md, plan.md and design contracts in specs/027-code-block-ui/ before implementation.

## Phase 2 — Foundation

- [x] T003 Add pinned Shiki dependency to apps/web/package.json and bun.lock; implement explicit offline language/highlighter module in apps/web/src/features/editor/code-highlighting.ts.

## Phase 3 — US1: Read and edit code

Independent acceptance: syntax colors, exact text, preserved language, editable
caret, confined scrolling and both themes.

- [x] T004 [US1] Add meaningful grammar/alias/round-trip checks in apps/web/tests/code-highlighting.spec.ts.
- [x] T005 [US1] Enable BlockNote decorations in apps/web/src/features/editor/page-editor.tsx and custom-blocks/code-block.tsx.
- [x] T006 [US1] Consolidate surface and theme/overflow styles in apps/web/src/global.css and readable language options in custom-blocks/code-block.tsx.
- [x] T007 [US1] Add browser keyboard/undo/composition, themes/320 px, offline reload and incoming update coverage in tests/e2e/code-block-ui.spec.ts.

## Phase 4 — US2: Copy source

Independent acceptance: exact plain source, visible success/refusal, retry and
single semantic activation from stable pointer/keyboard control.

- [x] T008 [US2] Implement local copy lifecycle with Button/AppIcon in apps/web/src/features/editor/custom-blocks/code-block.tsx using existing labels in apps/web/src/ui/copy/fr.ts.
- [x] T009 [US2] Cover clipboard success/refusal/unavailable and stable activation in apps/web/tests/code-block-toolbar.spec.tsx and tests/e2e/code-block-ui.spec.ts.

## Phase 5 — Verification and convergence

- [x] T010 Run focused unit/browser tests, typecheck, format/lint, production build and visual inspection; record results in specs/027-code-block-ui/validation.md.
- [x] T011 Converge implementation and artifacts; record any residual work in specs/027-code-block-ui/tasks.md and commit locally for integration.
- [ ] T012 Parent delivery: run complete docs/development.md gates (`bun run checks:local`) on integrated branch before push, then PR CI, review and merge; record evidence in specs/027-code-block-ui/validation.md.

## Dependencies and parallel opportunities

T001 → T002 → read-only analysis → T003 → T004–T006 → T007 → T008–T009 →
T010 → T011 → T012. Tests may be drafted independently after contracts; CSS and
highlighter implementation can be reviewed independently. Incremental strategy:
ship coloring/editing correctness first, copy feedback second, complete gates.

## Phase 6 — Convergence: native mobile line breaks

- [x] T013 [US1] Fix FR-004/FR-005 native mobile insertParagraph/insertLineBreak lost by the custom plain code block: add a composition-safe ProseMirror beforeinput handler in apps/web/src/features/editor/code-block-input.ts, focused editor tests, and retain the mobile newline regression in tests/e2e/code-block-ui.spec.ts.

## Phase 7: Convergence

- [x] T014 Register tests/e2e/code-block-ui.spec.ts and its editor owners in ci/test-impact.json, run tests/contract/test-impact.spec.ts, and record integrated 026/027 validation per plan: Validation and delivery and Constitution III/VII (resolved; focused contract passes; final delivery gate remains).

## Requirement traceability

| Requirement | Tasks |
| --- | --- |
| FR-001 | T005–T007, T010 |
| FR-002 | T003–T007, T010 |
| FR-003 | T003, T004, T006, T007 |
| FR-004 | T004, T005, T007, T013 |
| FR-005 | T004, T006, T007, T013 |
| FR-006 | T008, T009 |
| FR-007 | T003–T005, T007, T010 |
| FR-008 | T005, T008, T009 |
| SC-001 | T004–T007 |
| SC-002 | T004, T005, T007, T013 |
| SC-003 | T008, T009 |
| SC-004 | T003, T004, T007, T010 |
