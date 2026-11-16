# Tasks: Verifiable Test Evidence and a Preserved Draft

- [X] T001 Prove the product behaviour before changing it: a temporary probe shows the draft is lost when the composer is dismissed (`"Notes"` → closed → `""`).
- [X] T002 Locate the pre-existing occurrence of the same failure (run 43587332746, `database-form-lifecycle.spec.ts:143`) so the cause is not attributed to the last merge (lessons L-005).
- [X] T003 Keep the draft across an implicit close in `table-view.tsx`; clear it on creation and on `Escape`.
- [X] T004 Component test for the three semantics; it fails without T003 (`expected '' to be 'Notes'`).
- [X] T005 `ensureNewPropertyComposer` helper; both journeys restore the precondition and keep their draft assertion.
- [X] T006 Amend the constitution (article III, 4.0.0 → 4.1.0) with the Sync Impact Report.
- [X] T007 Create the maintained `test-quality` skill and its lessons journal (`L-001`…`L-007`); point `AGENTS.md`, `docs/testing/wait-contracts.md` at it.
- [X] T008 Validation on WebKit and Chromium, repeated; record evidence in `validation.md`.
- [X] T009 Pull-request CI green on the first attempt on the final commit (`fff46ef6`, run 43915711937).
