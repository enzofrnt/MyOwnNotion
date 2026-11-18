# Tasks — interaction state repairs

- [x] T001 Record unchanged failing assertions, pristine-main evidence and scope.
- [x] T002 Instrument math selection/focus around apply, paragraph click and input.
- [x] T003 Diagnose folder keyboard sensor readiness using actual listener/context state.
- [x] T004 Diagnose Kanban Enter dispatch versus actual entry-value commit.
- [x] T005 Implement and prove the math repair; no lost text or undo regression.
- [x] T006 Implement and prove keyboard folder move/cancel/drop repair.
- [x] T007 Implement and prove Kanban keyboard move with committed-value witness.
- [x] T008 Apply ui-quality/test-quality gates; retain keyboard/mobile/refusal cases.
- [x] T009 Run targeted static/types/unit and browser matrix against immutable builds.
- [x] T010 Record counterfactual tests, evidence and limits; commit/push validated fixes.

No task is done on a green rerun alone. Boot-diagnosis 063 remains separate.

## Outcome

- Math: in-place `setNodeMarkup`, post-apply caret handoff, caret-stealing frame
  repair removed, journey waits for the editor's caret marker.
- Folder: maintained `@dnd-kit/core` patch (synchronous listener + activation
  identity guard), Dockerfiles copy `patches/`, deterministic unit proof.
- Board: first destination takes focus when the move step opens; keyboard focus
  return deferred to the next frame; journey unchanged and green.
- All three journeys pass on chromium desktop/mobile, Firefox and both WebKit
  variants. Assertions unchanged; no sleeps, retries or skips added.
