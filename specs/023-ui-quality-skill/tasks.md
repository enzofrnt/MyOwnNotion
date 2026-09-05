# Tasks: Shared UI quality skill

## Phase 1 — Setup

- [x] T001 Verify active UI paths and tokens in `apps/web/src/global.css` and `apps/web/src/ui/tokens.css`; record decisions in `specs/023-ui-quality-skill/research.md`.

## Phase 2 — Foundations

- [x] T002 Record cross-artifact requirement coverage and resolve inconsistencies in `specs/023-ui-quality-skill/analysis.md` before implementation.

## Phase 3 — US1: Actionable UI guidance

**Goal**: A contributor can make coherent decisions from one reusable skill.
**Independent validation**: Review form, toolbar and nested-radius examples.

- [x] T003 [US1] Create `.agents/skills/ui-quality/SKILL.md` covering FR-001–FR-006 and FR-008 with existing components, states, spacing and radius examples.
- [x] T004 [US1] Validate skill metadata and review practical examples; record evidence in `specs/023-ui-quality-skill/validation.md`.

## Phase 4 — US2: Workflow discovery

**Goal**: UI phases find the same guidance from shared and active feature artifacts.
**Independent validation**: Follow each new link and verify canonical authority.

- [x] T005 [US2] Link the custom skill and clarify generated-vs-maintained guidance in `AGENTS.md` and `docs/development.md`.
- [x] T006 [US2] Link UI phase guidance in `docs/product/product-canvas.md` section 39 and active `specs/009-databases-structured-tasks/`, `specs/014-desktop-clients/`, `specs/017-v1-notion-like-workspace/` plans and tasks.

## Phase 5 — Convergence and delivery

- [x] T007 Check links, Spec Kit prerequisites, requirement coverage and `git diff --check`; record accurate limits in `specs/023-ui-quality-skill/validation.md`.
- [ ] T008 Deliver this increment after desktop merge, verify applicable PR and main CI, and update `specs/023-ui-quality-skill/validation.md` with provenance.

## Dependencies and implementation strategy

T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008.
US1 is independently useful before US2. No runtime changes or application tests
are introduced. Link inspection and example review may be performed independently
after their referenced files exist; implementation is otherwise sequential.
