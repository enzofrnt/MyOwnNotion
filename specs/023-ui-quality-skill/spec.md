# Feature Specification: Shared UI quality skill

**Feature Branch**: `codex/023-ui-quality-guidance`
**Created**: 2026-09-05
**Status**: Specified
**Input**: The owner requests a reusable in-repository UI skill covering buttons,
spacing, nested rounded surfaces and UX fundamentals, used during UI phases.

## Product direction and scope

Refines product canvas sections 39 (development workflow), 43.4 (practical
keyboard interaction), 43.5 (French interface), 43.6 (visual consistency), and
44 (definition of done). This feature delivers development guidance after the
desktop change; it does not redesign existing screens or add product behavior.
The constitution and active feature artifacts remain authoritative.

## User Scenarios & Testing

### User Story 1 — Implement a coherent interface (Priority: P1)

A contributor working on a visual feature finds one reusable skill explaining
how to use the application's existing visual system and verify the result.

**Why this priority**: Repeated ad hoc decisions produce inconsistent interfaces.
**Independent Test**: Read the skill with a representative form and toolbar in
mind; each required design decision has actionable guidance and an example
where a rule can otherwise be misinterpreted.

**Acceptance Scenarios**:

1. **Given** a form with primary, secondary and destructive actions, **when** a
   contributor follows the skill, **then** action labels, emphasis, click areas,
   loading, disabled and error states are addressed without losing entered data.
2. **Given** two closely nested rounded surfaces, **when** their shapes are
   chosen, **then** guidance accounts for the real inset and explains when the
   concentric-radius rule applies and when it does not.
3. **Given** dense content and long labels, **when** spacing and layout are
   reviewed, **then** related controls remain grouped and essential actions stay
   usable with keyboard, narrow screens and both themes.

### User Story 2 — Find and apply the skill from a specification (Priority: P2)

A contributor entering a UI phase sees a direct reference from the shared
workflow and the active UI feature artifacts, without searching chat history.

**Why this priority**: Guidance only helps if subsequent work actually finds it.
**Independent Test**: Follow the repository entrypoint and active UI plan links;
all resolve to the same maintained source with no duplicated product rules.

**Acceptance Scenarios**:

1. **Given** a new UI specification, **when** its plan and tasks are prepared,
   **then** the workflow instructs the contributor to use the skill and record
   the feature's relevant visual states and interaction checks.
2. **Given** an existing UI feature, **when** work resumes, **then** its active
   artifacts point to the skill without claiming that old screens passed a new review.

### Edge Cases

- A small button inside a large panel does not necessarily follow its contour.
- Icon artwork size differs from the actual click area.
- A historical stylesheet may exist without being loaded by the application.
- An explicit owner design decision can supersede a default convention.
- Automated checks alone do not prove spacing or visual hierarchy is correct.

## Requirements

### Functional Requirements

- **FR-001**: Provide one discoverable, reusable repository skill for UI work.
- **FR-002**: Cover button/link semantics, action hierarchy, precise labels,
  stable click areas and loading, disabled, failure and recovery states.
- **FR-003**: Cover spacing scales, grouping, alignment and container insets.
- **FR-004**: Explain concentric nested radii using the outer radius minus the
  actual inset, a concrete example, and the free-standing-control exception.
- **FR-005**: Cover readable typography, semantic colors, keyboard focus,
  overlays, narrow widths, long content, themes and reduced motion.
- **FR-006**: Require inspection of the actual rendered surface, relevant states
  and the stylesheet actually loaded; retain feature-specific evidence and limits.
- **FR-007**: Reference the skill in shared development guidance and active UI
  planning artifacts; preserve canonical product requirements in the specs.
- **FR-008**: Reuse the existing component and token vocabulary and avoid
  introducing a new design system or application dependencies for this guidance.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All eight requirements map to an explicit skill rule or workflow link.
- **SC-002**: Every newly added guidance link resolves to an existing repository file.
- **SC-003**: A contributor can determine button states, spacing and nested radii
  from one skill without consulting the original conversation.
- **SC-004**: The guidance introduces no new runtime behavior, dependency or
  claim of completed visual verification for unchanged screens.

## Assumptions

- The owner explicitly authorizes a custom maintained UI workflow skill.
- The existing visual system remains the starting point; redesigns require their
  own feature acceptance criteria.
- No user data, synchronization state, permissions or migration changes are needed.
