# Feature Specification: Verifiable Test Evidence and a Preserved Draft

**Feature Branch**: `fix/061-property-draft`

**Created**: 2026-11-16

**Status**: Implemented

**Input**: The nightly run 43856315749 failed on `databases-tasks.spec.ts:35`
(WebKit desktop) with the inline new-property field empty after a cancelled
press. The same assertion had already failed on 2026-11-14 (run 43587332746,
`database-form-lifecycle.spec.ts:143`). Owner request: fix it, and — as for the
UI/UX work — turn the failure into lessons so this class of failure and this
class of fragile test are not written again; the lessons must live where Spec
Kit agents actually read them.

Product canvas: quality and delivery sections (one trustworthy gate). Related
features: 005 (databases), 009 (structured tasks), 060 (wait contracts).

## User Scenarios & Testing

### User Story 1 — Typed text survives a dismissal (Priority: P1)

As the owner, I type a property name, press elsewhere by accident, and find my
text still there when I come back.

**Acceptance**:

1. **Given** a name typed in the inline composer, **when** a press outside
   closes the composer, **then** reopening shows the same name.
2. **Given** the same composer, **when** a property is created or `Escape` is
   pressed, **then** the draft is cleared.
3. **Given** a cancelled press on a type button, **when** no property was
   created, **then** no column exists and the name is not lost.

### User Story 2 — A journey proves a guarantee, not a rendering (Priority: P1)

As a maintainer, a journey that protects a guarantee still fails when the
guarantee breaks, and does not depend on where a pointer landed.

**Acceptance**:

1. **Given** a press whose meaning depends on a portalled menu, **when** the
   menu moved between measurement and press, **then** the journey still asserts
   the guarantee (the draft) after restoring its precondition.
2. **Given** the guarantee's semantics, **then** they are proved once at the
   component level, with a test that fails without the fix.

### User Story 3 — The next agent finds the rule where Spec Kit reads (Priority: P1)

As an agent implementing a future feature, I load the guidance the repository
declares, and I find the rule and the journal of failures there.

**Acceptance**:

1. **Given** the constitution, **then** article III states that a test waits for
   a verifiable state and that a green re-run is not a correction.
2. **Given** `AGENTS.md` and the skill catalogue, **then** a maintained
   `test-quality` skill with its lessons journal is declared and loadable, next
   to `ui-quality`.
3. **Given** a Speckit phase that writes or reviews a test, **then** the skill's
   gates apply, and an unexplained intermittent failure blocks convergence.

## Requirements

- **FR-001**: The inline property composer MUST keep its draft across an implicit
  close and MUST clear it only on creation or `Escape`.
- **FR-002**: The draft guarantee MUST be proved by a component test that fails
  without the fix; journeys MUST restore the precondition and assert the
  guarantee, never re-click until an assertion passes.
- **FR-003**: Article III of the constitution MUST state the evidence rule, the
  prohibition of weakened or retried tests, and the diagnosis obligation.
- **FR-004**: The reusable guidance MUST live in a maintained skill under
  `.agents/skills/`, loaded from `AGENTS.md`, with an append-only lessons
  journal; `docs/testing/wait-contracts.md` remains the normative rule.
- **FR-005**: This feature's artifacts MUST record the treatment of every
  affected journey and the CI evidence, including the pre-existing occurrence.
- **FR-006**: No assertion may be weakened, no sleep, retry or skip added.

## Success Criteria

- **SC-001**: The component test fails without the fix and passes with it.
- **SC-002**: Both journeys are green repeatedly on WebKit and Chromium, with no
  sleep and no weakened assertion.
- **SC-003**: A new agent reading only `AGENTS.md`, the constitution and the
  skill finds the rule, the journal and the checklist.
