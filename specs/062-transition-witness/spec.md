# Feature Specification: A Transition Witness That Cannot Miss Its State

**Feature Branch**: `fix/062-transition-witness`

**Created**: 2026-11-16

**Status**: Implemented

**Input**: With PR #210 still open, the WebKit lane failed again in
`files.spec.ts:26` — "No active grid-template-rows transition was found" — the
same message as run 43803790517 on a commit the diff never touched. Lessons
L-008 (`.agents/skills/test-quality/lessons.md`): a transient state is recorded
before the action that produces it, never sampled after. Owner's standing
requirement: tests wait for the real state, and no arbitrary delay.

## User Scenarios

### User Story 1 — The witness cannot arrive too late (Priority: P1)

As a maintainer, a journey that proves an intermediate animation frame passes on
a loaded runner.

**Acceptance**:

1. **Given** a click that starts a 210 ms transition, **when** the driver would
   have needed a second round trip, **then** the transition is observed in the
   same browser task and cannot be missed.
2. **Given** a state that never appears, **when** the witness waits, **then** it
   fails within a maximum bound with a message naming the missing transition.

## Requirements

- **FR-001**: No helper may sample a transient state after a driver round trip.
- **FR-002**: The wait for the transient state MUST be a maximum bound with a
  diagnostic, never a duration the test relies on.
- **FR-003**: The unsound helper MUST be removed so the pattern cannot return.
- **FR-004**: No assertion may be weakened: the sampled intermediate frame is
  still asserted (height between closed and open).

## Success Criteria

- **SC-001**: `files.spec.ts` proves the same intermediate frames through the
  in-page witness.
- **SC-002**: A probe shows the witness fails with its diagnostic when no
  transition exists.
- **SC-003**: The three consuming specs are green on WebKit and Chromium desktop
  with repetitions.
