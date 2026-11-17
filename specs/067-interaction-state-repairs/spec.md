# Interaction state repairs

Status: diagnosis in progress. Branch: `058-multi-user-accounts` (PR #213).

## Scope and source of truth

Correct three failures reproduced on pristine main `a27f700d` and on the
reconciled branch. Preserve main's assertions, keyboard journeys and test-evidence
rules. Product canvas: priorities (data integrity and predictable local editing),
identity/content and UI quality sections; no new product capability or boundary.
Evidence: `specs/064-multi-user-accounts/evidence/reconciliation/`.

## Required behaviour

1. After editing an inline equation and clicking an empty paragraph, typing
   reaches that paragraph immediately. Keyboard focus and the editor selection
   must agree; content is not lost and equation editing remains undoable.
2. A folder's keyboard drag moves from the first child to the next destination
   on ArrowDown after activation. The preview and eventual committed order
   correspond to the same source/destination; cancellation leaves order intact.
3. Choosing a Kanban destination with Enter commits that card's group change,
   just as pointer activation does. The entry remains canonical across views.

## Acceptance witnesses

- Equation: editor document contains the typed text in the selected paragraph,
  and the committed document preserves the equation; existing math journey stays.
- Folder: actual drag destination identifies the second child, then the unchanged
  existing keyboard/cancel/drop assertions verify preview and committed order.
- Board: the moved entry's committed group value is the chosen destination;
  existing board/gallery/calendar journey and negative/refusal cases stay.

No timing sleeps, repeated gestures until green, added retries, skipped coverage
or weakened assertions are accepted. A passing rerun alone is not a correction.
A deterministic test must demonstrate the broken state and fail without the fix.

## Boundaries

Do not mix the separate 063 boot-diagnosis worktree into these repairs. Do not
rewrite storage, synchronization or permissions to hide an interaction failure.
Exact selection and drag-measurement causes remain hypotheses until observed.
