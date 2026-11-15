# Feature Specification: Tests Wait for States, Not for Time

**Feature Branch**: `test/060-wait-contracts`

**Created**: 2026-11-15

**Status**: Implemented

**Input**: After PR #202 merged, the `main` run 43722479700 failed one WebKit
mobile journey and passed when the failed job was re-run, on an identical tree.
The journey selected a page, saw its title, and closed the browser page about
18 ms later, while the device-local navigation record was still being written;
the restarted device restored the previous page. The audit in
`docs/audits/2026-11-wait-contracts/` searched the whole suite and the CI
history for the same class: a test that proceeds on the start of an operation
instead of proof that it finished. Requirement from the owner: the robustness
of every test, present and future, rests on verifiable states proving the next
step may start; elapsed time, a merely visible element, a received network
response or an `idle` state are never proof of completion.

Product canvas: quality and delivery sections (one trustworthy gate, no
retries). Related features: 003 (navigation state, FR-009), 005 (storage limit,
FR-017), 017 (save-state journeys), 058 (gate without retries).

## User Scenarios & Testing

### User Story 1 — A green gate means the behaviour was proved (Priority: P1)

As the owner, when the gate is green I can trust that each journey waited for
the operation it depends on, so the same commit is not red on one runner and
green on another.

**Acceptance**:

1. **Given** a journey that restarts a device after a selection, **when** the
   navigation write is slower than the close, **then** the journey waits for the
   committed record instead of restoring the previous page by chance.
2. **Given** a witness, **when** its operation is aborted or never happens,
   **then** the test fails with a message naming the missing precondition.
3. **Given** a negative claim ("never synchronized"), **when** a forbidden
   value appears at any moment in the window, **then** the test fails.

### User Story 2 — The rule survives the next contributor (Priority: P1)

As a maintainer or agent writing a new test, I find the rule, the witnesses and
their producers in one document, and the gate rejects a sleep I add.

**Acceptance**:

1. **Given** a new `waitForTimeout` or an awaited timer sleep in any test root,
   **then** the contract test fails, unless the timer is declared with a reason
   that is not synchronization.
2. **Given** a declared timer that no longer exists, **then** the contract fails
   so the declaration cannot excuse a later sleep.

### User Story 3 — The evidence of a red attempt is kept (Priority: P2)

As the owner investigating a red attempt, its browser reports are still there
after a re-run.

**Acceptance**: lane artifacts are named per attempt; the gate merges each
lane's newest attempt and records which attempt it used.

## Requirements

- **FR-001**: Every wait in a test MUST observe a state written by the code that
  completes the operation, correlated with that operation (identity, revision,
  captured counter, command type, device).
- **FR-002**: Timeouts MUST only bound a wait and MUST carry a diagnostic; no
  general timeout increase, retry or skip is introduced.
- **FR-003**: Tests whose subject is time MUST own the clock.
- **FR-004**: Deliberate races (abrupt close, network cut, concurrent write)
  MUST stay covered and be triggered by controlled barriers.
- **FR-005**: No assertion is weakened; a changed assertion is justified in
  `validation.md`.
- **FR-006**: Observability added for witnesses MUST read real committed state;
  no E2E-only behaviour flag.
- **FR-007**: CI MUST keep per-attempt browser evidence and merge one attempt
  per lane.
- **FR-008**: A product defect revealed by a witness is fixed or recorded with a
  proposal, never waited out.

## Success Criteria

- **SC-001**: The 56 audited sites each have a recorded treatment.
- **SC-002**: Witness sensitivity is demonstrated by injection (aborted write,
  no gesture, broken serialization, unbounded retry).
- **SC-003**: Two complete CI runs on the final commit are green on their first
  attempt, with no retry.
