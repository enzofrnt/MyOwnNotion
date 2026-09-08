# Tasks: Notion import

## Phase1 — Specify, plan and analyze

- [x] T001 Specify scope, accepted source formats and preview/apply restrictions.
- [x] T002 Research primary formats and plan canonical/protected integration.
- [x] T003 Analyze source precedence, requirements and task coverage before code.

## Phase2 — Safe source and conversion

- [x] T004 Implement immutable bounded directory/ZIP inventory with safe paths.
- [x] T005 Convert Markdown/wikilinks/CSV/frontmatter and produce exhaustive reports.
- [x] T006 Resolve hierarchy, properties and database026 membership/presentation.
- [x] T007 Test native and converted formats plus unsafe/malformed source boundaries.

## Phase3 — Canonical import and recovery

- [x] T008 Implement explicit target gates, verified024 backup and job lock.
- [x] T009 Apply canonical items/files/database026 sources with encrypted provenance.
- [x] T010 Add transactional checkpoints, stable replay and changed-source refusal.
- [x] T011 Test normal API readback, encrypted storage, interruption and backup failure.

## Phase4 — CLI and delivery

- [x] T012 Add preview-first CLI, compiled entrypoint and setup/recovery documentation.
- [x] T013 Run actual source dry-run only; retain aggregates without private committed data.
- [x] T014 Run focused checks, converge artifacts and hand off integration gates.

## Phase 5: Convergence

- [x] T015 CRITICAL Refuse imports into restored but unactivated targets both at open and before every operation; prove unchanged job, mutations, revisions and blobs on resume per FR-006 and US2/AC4 (partial).

## Phase 6: Convergence

- [x] T016 Detect committed CLI writes in already-open SSE streams through the existing heartbeat; preserve revocation, monotonic cursors and close/error boundaries, and prove separate-process notification and reconnect catch-up per FR-010 (partial).

## Phase 7: Coverage convergence

- [x] T017 Exercise uncovered source/Markdown/CSV/archive integrity and filesystem race boundaries with synthetic input per FR-002/003/009.
- [x] T018 Exercise canonical refusal, interrupted file replay, checkpoint integrity, target readiness and CLI error boundaries per FR-006/007/008.
- [x] T019 Record exact scoped uncovered counts and meaningful remaining limitations after coverage; keep all global thresholds and exclusions unchanged per Constitution VII.

## Phase 8: CSV membership scope

- [x] T020 Correct native CSV row matching in `apps/api/src/imports/notion/plan.ts`: prefer the matching subpage inside that CSV's exported folder before global title/link fallback, refuse ambiguous local matches, and preserve explicit path support. Prove same-title unrelated pages and independent databases retain their own page identities/content/properties using synthetic preview and canonical import tests (FR-004/FR-007; confirmed wrong membership).
