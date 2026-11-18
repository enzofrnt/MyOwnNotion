# Plan — interaction state repairs

Read `ui-quality`, `test-quality`, their lessons and the normative wait contracts.
Use immutable, separately served browser artifacts and per-project databases/ports.

1. Capture event, focus and selection state for the failed math gesture. Do not
   assume replacing an inline node necessarily destroys its React node view.
2. Capture activation/listener/measurement state for folder keyboard dragging.
   `data-dragging` alone is not keyboard-sensor readiness. Do not fix with a delay.
3. Capture Kanban menu keyboard focus, click dispatch and committed move state.
   Preserve semantic click activation and cancelled-release semantics.
4. Implement the smallest proven fixes in their owning editor, hierarchy and
   board components; use local test witnesses only when they expose real state.
5. Add deterministic regressions and prove that disabling each fix fails them.
   Run unchanged original journeys on Chromium desktop/mobile and required
   Firefox/WebKit Linux variants. Run affected types/static/unit checks.

Loading, pending, success and refusal states retain their current geometry and
accessible roles. Failures keep content and actionable local recovery. No new
permission, API, storage schema, or data migration is intended. No screenshot
baseline update without a visible design change and review.
