# Tasks: Core Workspace Experience

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Branch**: `003-core-workspace-experience`

**Design inputs**: [research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests are mandatory here, not optional.** Constitution principle III requires
automated tests for changed behaviour and a Playwright journey for every changed
user-visible interactive flow. Test tasks are therefore listed inside each story
rather than deferred to a polish phase, and a story is not done when its
implementation compiles.

**Organisation**: one phase per user story, in priority order. Each story phase
is a complete, independently testable increment — US1 alone is a shippable
improvement over today's raw-JSON textarea.

---

## Phase 1: Setup

- [X] T001 Add Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`) to `apps/web/package.json` and refresh `pnpm-lock.yaml` — *deferred to the Phase 3 batch, where the dependency is actually used; adding it earlier would land an unused dependency*
- [X] T002 [P] Add `@axe-core/playwright` as a root dev dependency in `package.json` for the SC-004 audit — *deferred to the Phase 8 batch, for the same reason*
- [X] T003 [P] Create the `packages/domain/src/document/` module directory with an `index.ts` barrel exported from `packages/domain/src/index.ts`
- [X] T004 [P] Amend `docs/product/roadmap.md` to move canvas section 14 (databases and views) out of feature 003 into its own future feature, per constitution principle VIII and the spec's Assumptions — *the roadmap turned out to contradict itself as well: section 14 was claimed by both 003 and 008*

**Checkpoint**: dependencies resolve, `pnpm typecheck` passes, the roadmap and the spec no longer disagree about scope. ✅

---

## Phase 2: Foundational — the document model

**Blocking**: every user story depends on this. Nothing in Phase 3+ can start until the checkpoint passes.

**Why first**: the model is the one artifact FR-005 makes a requirement in its own right, and it is the only part of this feature that is pure, fast to test, and independent of a browser. Getting it wrong later means rewriting stored documents.

- [X] T005 Define block and inline types in `packages/domain/src/document/block.ts` — the eight known block types, `Inline`, the five marks, and the known-type registry, per [data-model.md](./data-model.md)
- [X] T006 Define the document envelope and its invariants in `packages/domain/src/document/document.ts` — `blocks` array, unique ids across nesting, document order
- [X] T007 Implement normalisation in `packages/domain/src/document/document.ts` — sort marks by type, merge adjacent equally-marked inline nodes, drop empty text nodes
- [X] T008 Implement `validateDocument` in `packages/domain/src/document/validate.ts` — returns a typed document or an explanation, never throws for content reasons; unknown block types pass, malformed known blocks fail
- [X] T009 [P] Reject unsafe link hrefs in `packages/domain/src/document/validate.ts` — only `http:`, `https:`, `mailto:` absolute URLs; a `javascript:` href is a validation failure, not a rendering choice
- [X] T010 [P] Implement lossless legacy reading in `packages/domain/src/document/legacy.ts` — a non-`{blocks}` body is preserved verbatim and wrapped as a `legacyBody` unknown block only on the owner's first edit
- [X] T011 [P] Implement `exportMarkdown` in `packages/domain/src/document/export-markdown.ts` — the mapping table in [contracts/document-format.md](./contracts/document-format.md), with unknown blocks emitted as labelled fenced JSON
- [X] T012 Document `formatVersion: 2` in `packages/contracts/src/content-api.ts` — the body shape and the rule that an unknown version is opaque and preserved
- [X] T013 [P] Unit tests for validation in `packages/domain/tests/document-validate.spec.ts` — unknown type accepted, `heading` with `level: 9` rejected, `checkbox` without `checked` rejected, `javascript:` href rejected
- [X] T014 [P] Unit tests for legacy reading in `packages/domain/tests/document-legacy.spec.ts` — a v1 body survives a read unchanged and is only wrapped on an edit
- [X] T015 [P] Property test in `packages/domain/tests/document-normalise.property.spec.ts` — normalisation is idempotent over generated documents
- [X] T016 [P] Property test in `packages/domain/tests/document-export.property.spec.ts` — `exportMarkdown` is total: never throws on any valid document, including ones containing unknown blocks

**Checkpoint**: `pnpm test:unit -- document` and `pnpm test:property -- document` pass — 40 tests. The model exists, is validated, and exports, with no editor in the picture. ✅

---

## Phase 3: User Story 1 — Write a page that reads like a document (P1) 🎯 MVP

**Goal**: an owner produces a heading, paragraph, list, checkbox, quote, and code block, moves blocks, and undoes — and the document survives a reload exactly as left.

**Independent test**: create a page, produce each block type by both the slash menu and the Markdown shortcut, reorder two blocks, undo, reload, and confirm the document is unchanged.

### The conversion boundary

- [X] T017 [US1] Define the ProseMirror schema mirroring the model in `apps/web/src/features/editor/tiptap-schema.ts` — one node per known block type, lists nesting through children rather than a container
- [X] T018 [US1] Implement the opaque unknown node in `apps/web/src/features/editor/unknown-block.ts` — an atom, non-editable, movable and deletable, carrying the original block JSON verbatim in an attribute
- [X] T019 [US1] Implement `toTiptap` in `apps/web/src/features/editor/to-tiptap.ts` — model → ProseMirror doc, routing any unrecognised type to the unknown node **before** ProseMirror sees it
- [X] T020 [US1] Implement `fromTiptap` in `apps/web/src/features/editor/from-tiptap.ts` — ProseMirror doc → model, re-emitting each unknown node's stored JSON rather than reconstructing it
- [X] T021 [US1] Render the unrenderable placeholder in `apps/web/src/features/editor/unknown-block.ts` — names the unknown type visibly, never an empty gap (FR-006)

### The editing surface

- [X] T022 [US1] Build the editor surface in `apps/web/src/features/editor/editor-view.tsx`, replacing the raw-JSON control in `apps/web/src/features/pages/page-document-form.tsx`
- [X] T023 [US1] Configure the input rules in `apps/web/src/features/editor/editor-view.tsx` — `# `, `## `, `### `, `- `, `1. `, `> `, ``` ``` ```, `[] `, with the shortcut characters consumed (FR-002, US1 scenario 1)
- [X] T024 [P] [US1] Build the slash menu in `apps/web/src/features/editor/slash-menu.tsx` as a `listbox` with `aria-activedescendant`, offering every known block type (FR-002)
- [X] T025 [P] [US1] Build block controls in `apps/web/src/features/editor/block-controls.tsx` — select, move, transform, duplicate, delete, as buttons with accessible names (FR-003)
- [X] T026 [US1] Wire undo and redo over every action from FR-002 and FR-003 in `apps/web/src/features/editor/editor-view.tsx` (FR-004)
- [X] T027 [US1] Wire the editor to the existing mutation path in `apps/web/src/services/local-content.ts` so document writes go through feature 001's outbox unchanged (FR-025)
- [X] T028 [US1] Refuse editing when the device key is unavailable in `apps/web/src/features/editor/editor-view.tsx` — a stated refusal, not a degraded plaintext write (FR-026, spec edge case)
- [X] T029 [US1] Reduce unrepresentable pasted rich text to plain text in `apps/web/src/features/editor/editor-view.tsx`, so nothing is stored that the export path cannot emit (spec edge case)

### Tests

- [X] T030 [P] [US1] Property test in `apps/web/tests/editor-round-trip.property.spec.ts` — model → Tiptap → model is the identity over generated documents
- [X] T031 [P] [US1] Property test in `apps/web/tests/editor-unknown-block.property.spec.ts` — an unknown block round-trips to identical JSON (SC-009), with the numeric-key limit from [data-model.md](./data-model.md) stated in the test
- [X] T032 [US1] Playwright journey in `tests/e2e/block-editor.spec.ts` — each block type by both routes, reorder, undo, reload, unchanged
- [X] T033 [P] [US1] Playwright case in `tests/e2e/block-editor.spec.ts` — a document seeded with an unrecognised block type shows the placeholder and still saves that block unchanged
- [X] T034 [P] [US1] Playwright case in `tests/e2e/block-editor.spec.ts` — a legacy v1 document opens read-only without being rewritten, and upgrades only on an edit

**Checkpoint**: US1 is independently shippable — 9 journeys green, 271 e2e tests passing overall. An owner can write a structured note and it survives. ✅

---

## Phase 4: User Story 2 — Know whether the work is saved (P1)

**Goal**: the owner can always tell whether their words are local, sending, saved, or blocked — and never sees "saved" before the server confirms.

**Independent test**: type offline, observe the state, come back online, observe it resolve, with no premature claim of success.

- [X] T035 [US2] Add `blocked` to `OutboxStatus` in `packages/client-core/src/local-store/schema.ts` and bump `LOCAL_SCHEMA_VERSION` with a Dexie upgrade that widens without rewriting rows
- [X] T036 [US2] Write `blocked` on a server refusal in `packages/client-core/src/outbox/outbox.ts`, carrying the reason and what would resolve it (FR-010)
- [X] T037 [US2] Implement `deriveSaveState` in `packages/client-core/src/save-state/derive.ts` — pure, total, worst-first precedence, per [contracts/save-state.md](./contracts/save-state.md)
- [X] T038 [P] [US2] Unit tests in `packages/client-core/tests/save-state.spec.ts` — each of the four states, the offline presentation of `unsaved`, and the precedence when several rows exist
- [X] T039 [US2] Build the save-state indicator in `apps/web/src/features/save-state/save-state-indicator.tsx` — four visually distinct states (FR-007, SC-010)
- [X] T040 [US2] Ensure `saved` is only shown on the absence of outbox rows in `apps/web/src/features/save-state/save-state-indicator.tsx` — never on optimistic application or a timer (FR-008)
- [X] T041 [P] [US2] Present the blocked state in `apps/web/src/features/save-state/blocked-notice.tsx` — what is refused, that existing content is still readable, what would resolve it (FR-010)
- [X] T042 [P] [US2] Surface conflicts in `apps/web/src/features/save-state/conflict-notice.tsx` — the conflict visible and both versions reachable, never a silent loss (FR-011)
- [X] T043 [US2] Announce transitions into blocked and conflict through a polite live region in `apps/web/src/features/save-state/save-state-indicator.tsx` (FR-020)
- [X] T044 [US2] Playwright journey in `tests/e2e/save-state.spec.ts` — the offline round trip, asserting no moment at which "saved" appears before confirmation
- [X] T045 [P] [US2] Playwright case in `tests/e2e/save-state.spec.ts` — a rotation write block produces the blocked state with all three statements present
- [X] T046 [P] [US2] Playwright case in `tests/e2e/save-state.spec.ts` — an unexpected close leaves the last completed edit present on reopen (FR-009, US1 scenario 4)
- [X] T047 [P] [US2] Playwright case in `tests/e2e/save-state.spec.ts` — a page open in two tabs: the second does not silently overwrite the first tab's newer content (spec edge case)

**Checkpoint**: US1 and US2 together are the product's core promise — writing that works and a truthful statement about it.

---

## Phase 5: User Story 3 — Find and organise things without the mouse (P2)

**Goal**: the whole workspace is navigable from the keyboard, with visible focus and an explicit state for every branch.

**Independent test**: create a folder, create a page inside it, rename it, move it to the root, and open it, keyboard only, focus visible throughout.

- [X] T048 [US3] Build the tree in `apps/web/src/features/navigation/tree.tsx` with `tree`/`treeitem`/`group` roles, `aria-expanded`, and `aria-selected` (FR-019)
- [X] T049 [US3] Implement roving tabindex and the key map in `apps/web/src/features/navigation/use-tree-keyboard.ts` — arrows, `Home`/`End`, `Enter`, `F2`, `Delete`, type-ahead, one tab stop for the whole tree (FR-017)
- [X] T050 [P] [US3] Implement create, rename, move, and delete from the keyboard in `apps/web/src/features/navigation/tree-actions.ts`, reusing feature 001's mutations unchanged (FR-012, FR-025)
- [X] T051 [P] [US3] Render pages, folders, and standalone files at the same level in `apps/web/src/features/navigation/tree.tsx` (FR-016)
- [X] T052 [P] [US3] Implement the four branch states in `apps/web/src/features/navigation/branch-state.tsx` — loading, empty, unavailable offline, error, each a distinct readable statement (FR-015)
- [X] T053 [P] [US3] Add favourites, recents, and settings entry points to `apps/web/src/features/navigation/sidebar.tsx` (FR-012)
- [X] T054 [P] [US3] Show connection and synchronization state in `apps/web/src/features/navigation/sidebar.tsx` (FR-013)
- [X] T055 [US3] Persist navigation state in `packages/client-core/src/local-store/navigation-state.ts` — expanded branches, last visited item, and scroll positions bounded to 50 entries (FR-014)
- [X] T056 [US3] Restore document position on return in `apps/web/src/features/editor/editor-view.tsx` (FR-014, US3 scenario 4)
- [X] T057 [P] [US3] Move focus deliberately after every destructive or navigational action in `apps/web/src/features/navigation/tree.tsx` — next sibling after delete, into the new item after create; never `<body>` (FR-018)
- [X] T058 [US3] Playwright journey in `tests/e2e/keyboard-navigation.spec.ts` — the full create/rename/move/open journey with no pointer input, asserting a visible focus indicator at each step (SC-003)
- [X] T059 [P] [US3] Playwright case in `tests/e2e/keyboard-navigation.spec.ts` — each of the four branch states is reachable and distinguishable (FR-015)
- [X] T060 [P] [US3] Playwright case in `tests/e2e/keyboard-navigation.spec.ts` — `Escape` always leaves the editor, so it is never a keyboard trap

---

## Phase 6: User Story 4 — Use it on a phone (P2)

**Goal**: read, write, navigate, and see the save state at 320 pixels, with no horizontal scrolling and no finger-hostile control.

**Independent test**: complete User Story 1 at a 320-pixel viewport with no horizontal page scrolling at any point.

- [X] T061 [US4] Make the workspace layout responsive from 320 pixels in `apps/web/src/styles.css` and `apps/web/src/app.tsx` (FR-021)
- [X] T062 [US4] Turn the sidebar into a dismissable overlay at narrow widths in `apps/web/src/features/navigation/sidebar.tsx` — closable by `Escape` and a visible control, returning focus to its trigger (US4 scenario 2)
- [X] T063 [P] [US4] Contain wide content — code blocks, long links — inside their own scroll containers in `apps/web/src/styles.css` so the page never widens
- [X] T064 [P] [US4] Ensure touch targets are at least 44×44 pixels across the editor and tree controls in `apps/web/src/styles.css`
- [X] T065 [US4] Playwright journey in `tests/e2e/narrow-viewport.spec.ts` — US1 completed at 320 pixels, asserting `scrollWidth <= clientWidth + 1` on every core screen (SC-008)

---

## Phase 7: User Story 5 — Trust the connection (P3)

**Goal**: the owner can see which server they are on, whether it is reachable and compatible, and whether the channel is secure.

**Independent test**: point the client at a non-local server over plain HTTP and confirm the warning is clear and unmistakable.

- [X] T066 [US5] Report reachability, protocol compatibility, channel security, and authentication state in `apps/web/src/features/connection/connection-status.tsx` (FR-023)
- [X] T067 [US5] Warn on a non-local address over an insecure channel in `apps/web/src/features/connection/connection-status.tsx` — plainly, not as a subtle badge (FR-024)
- [X] T068 [P] [US5] State a protocol-version mismatch at connection time in `apps/web/src/features/connection/connection-status.tsx`, rather than failing unrelatedly later (US5 scenario 2)
- [X] T069 [US5] Playwright journey in `tests/e2e/connection-trust.spec.ts` — the insecure non-local warning and the version-mismatch statement

---

## Phase 8: Polish & cross-cutting

- [X] T070 Extend `tests/e2e/accessibility.spec.ts` with `@axe-core/playwright` over the workspace, editor, and settings screens, failing on any critical or serious violation (SC-004)
- [X] T071 [P] Add `tests/e2e/editor-performance.spec.ts` — a generated 500-block document, asserting keystroke-to-visible under 100 ms at p95 (SC-005) and open-to-editable under 2 seconds (SC-006)
- [X] T072 [P] Document the content model and its export path in `docs/` and link it from the product documentation, since FR-005 requires the model to be documented and not merely to exist
- [X] T073 [P] Create `specs/003-core-workspace-experience/validation.md` recording evidence per FR and SC, with SC-002 and SC-007 marked pending because they need ten human participants
- [X] T074 Run the full local gate — `pnpm checks:local` then `pnpm test:e2e` — before the pull request, per constitution principle III

---

## Phase 9: User Story 6 — Internal page links (P2)

**Goal**: an owner can mention a locally available page without changing the
hierarchy, and the mention remains a stable, visibly distinct internal link.

**Independent test**: create `Index`, child page `Child`, and separate page
`Reference`; insert a link to `Reference`, reload, rename/move it, and confirm
the tree still contains only the real child while the mention resolves to the
same target.

- [X] T075 [P] [US6] Add `pageLink` mark validation, normalisation, and model round-trip tests in `packages/domain/tests/document-validate.spec.ts`, `packages/domain/tests/document-normalise.property.spec.ts`, and `apps/web/tests/editor-round-trip.property.spec.ts` (FR-001a, FR-027)
- [X] T076 [US6] Implement the `pageLink` mark and target identity conversion in `packages/domain/src/document/block.ts`, `packages/domain/src/document/validate.ts`, `apps/web/src/features/editor/to-tiptap.ts`, and `apps/web/src/features/editor/from-tiptap.ts` (FR-001a, FR-028)
- [X] T077 [US6] Add an accessible page picker and internal-link mark extension in `apps/web/src/features/editor/page-link-control.tsx`, `apps/web/src/features/editor/page-link.ts`, and `apps/web/src/features/editor/editor-surface.tsx`, using locally available page-compatible items and a distinct visual affordance (FR-027, FR-028)
- [X] T078 [US6] Reconcile `page:link` relationship edges atomically with page-document replacement and preserve them in the local projection in `packages/database/src/mutations/execute-command.ts`, `packages/client-core/src/outbox/apply-to-projection.ts`, and `apps/web/src/features/editor/editor-view.tsx` (FR-025, FR-027)
- [ ] T079 [US6] Add the responsive Playwright journey proving child placement and page link remain separate through reload, offline use, rename, move, and conversion in `tests/e2e/page-links.spec.ts` (US6/AC1–AC4, SC-011, SC-012)

---

## Dependencies

**Phase order**: Setup → Foundational → US1 → US2 → US3 → US4 → US5 → US6 → Polish.

**Hard blocks**:

- Phase 2 blocks everything. Every story reads or writes the document model.
- T017–T021 (the conversion boundary) block T022–T029; there is no editor surface until there is something to convert.
- T035 (the `blocked` status and schema bump) blocks T036–T043.
- T048 (the tree) blocks T049–T057.
- US4 depends on US1 and US3 having screens to be responsive about — it is a phase over existing surfaces, not new ones.
- T074 depends on everything.
- US6 depends on the document model (Phase 2), the editor surface (US1), and
  feature 001's typed relationship mutation and local projection.

**Soft ordering**: US5 is independent of US2, US3, and US4 and could move earlier if the deployment story becomes urgent. It is last because it is P3.

---

## Parallel opportunities

- **Phase 2**: T009, T010, T011 are separate files; T013–T016 are four independent test files.
- **Phase 3**: T024 and T025 are separate components; T030, T031, T033, T034 are independent tests.
- **Phase 4**: T041 and T042 are separate components; T045–T047 are independent cases.
- **Phase 5**: T050–T054 and T057 touch different files; T059 and T060 are independent.
- **Phase 8**: T071, T072, T073 are fully independent.
- **Phase 9**: T075 and T079 are independent test/documentation work; T077 is
  independent of the domain and persistence tasks once the conversion contract
  is fixed.

---

## Implementation strategy

**MVP is Phase 1 + Phase 2 + Phase 3 (US1).** That alone replaces a raw-JSON
textarea with a working block editor and is worth shipping on its own — which is
the test of whether the story boundaries are real.

**Then US2**, because the two P1 stories together are the actual promise: the
writing works, and the interface tells the truth about it.

**Then US3, US4, US5, and US6** in priority order, each a self-contained
increment. US6 is the first consumer of the explicit distinction between
hierarchy placement and page-link relation.

**Batching**: per the standing preference for large pull requests, group
Phases 1–2 into one, Phase 3 into one, Phase 4 into one, Phases 5–6 into one,
and Phases 7–9 into one. Each still has a green local gate and a green CI before
it merges — the batching changes how much lands per pull request, not what has
to pass.
