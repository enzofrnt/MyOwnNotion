# Tasks: MCP access

## Phase 1 — Specification and design

- [x] T001 Specify V1 scope, acceptance and release direction in spec.md/canvas/roadmap.
- [x] T002 Research current MCP transport and design token, scope and recovery boundaries.
- [x] T003 Analyze spec/plan/task consistency before code.

## Phase 2 — Authorization foundation

- [x] T004 Add migration 0017 and protected connection labels, digest-only codes/tokens.
- [x] T005 Implement grant/exchange/list/revoke/audit with recent owner auth and expiry.
- [x] T006 Test concurrent exchange, expiry, revoke and restoration trust invalidation.

## Phase 3 — Canonical tools

- [x] T007 Implement scope-limited list/search/read/file tools using canonical resolvers.
- [x] T008 Implement create/rename/edit/trash with canonical services, guards and audit.
- [x] T009 Integrate official SDK stateless HTTP transport with strict bearer and Origin checks.
- [x] T010 Test actual protocol, scope isolation, encrypted mutations and stale/blocked writes.

## Phase 4 — Owner journey and delivery

- [x] T011 Add authorization/settings panel with explicit scope and one-use code instructions.
- [x] T012 Add desktop/narrow Playwright grant/exchange/revoke journey and setup docs.
- [x] T013 Run focused checks, converge artifacts and record evidence/remaining full gate.

## Phase 5: Convergence

- [x] T014 Complete the owner authorization/settings UI, including recent-auth retry, explicit scope, code, effective status, audit and revocation per FR-001/FR-011 (completed; see ui-validation.md).
- [x] T015 Validate grant/exchange/revoke on desktop and narrow Playwright profiles, then record evidence per SC-003 (completed; see ui-validation.md).

- [ ] T016 Integration owner: run all required local gates on combined changes
  before push, then PR CI/review; record the delivery result. Focused MCP/UI
  evidence does not replace this full gate.

- [x] T017 Refuse unsupported file-permission platforms before consuming an exchange code in `apps/api/src/mcp/exchange-cli.ts`; verify the newly opened POSIX file's ownership/mode before receiving credentials, retain no-secret/refusal cleanup tests, and document the helper's host boundary in `docs/mcp.md` (FR-005/FR-008).
- [x] T018 Strengthen meaningful MCP boundary evidence in `apps/api/tests/mcp*` for recursive scope redaction/immutability, independent actions, pagination, mutation replay/collisions, availability and expired/revoked inventories, rate limits, and CLI failure cleanup; correct confirmed defects in `apps/api/src/mcp/` or `apps/api/src/routes/mcp.ts`, record focused coverage and remaining limitations without exclusions or budget changes (FR-002–FR-009). Completed focused evidence: 45 tests, API types and Biome pass; 12 MCP branches remain unmeasured, and the combined gate remains T016 (see quickstart.md and analysis.md).

## Phase 6: Convergence

- [x] T019 Register tests/e2e/mcp-access.spec.ts in ci/test-impact.json and verify its complete inventory contract per plan: Validation and Constitution III/VII (resolved; focused contract passes; final delivery gate remains).
- [x] T020 Prove with the real protocol client that reusable source displays grant no implicit access to unplaced entries or entries placed outside the allowed hierarchy, while explicit permitted placements and allContent remain usable per FR-004/FR-006 and canvas section 14 (partial integration evidence).

## Phase 7: Convergence

- [x] T021 Complete the app-routing security API fixture with the three MCP inventory methods mounted by the settings route; rerun the routing suite without an unhandled rejection and record the integrated gate finding per FR-001/FR-011 and T016 (partial test integration).

## Phase 8: P1 audit convergence

- [x] T022 Add RED/GREEN integration coverage for invalid, consumed, expired and revoked exchange credentials plus invalid, expired and revoked bearer credentials; persist fixed, redacted refusal classifications through the canonical `AuditService`, expose them in the owner MCP audit inventory, and record focused evidence (FR-008, canvas §35; full T016 gate remains pending).

## Requirement traceability

| Requirement | Tasks |
| --- | --- |
| FR-001 | T005, T011, T014, T021 |
| FR-002 | T004–T006, T010, T018, T022 |
| FR-003 | T005, T006, T014, T018 |
| FR-004 | T005, T007–T010, T018, T020 |
| FR-005 | T009, T010, T012, T017, T018 |
| FR-006 | T006–T010, T018, T020 |
| FR-007 | T008, T010, T018 |
| FR-008 | T005, T006, T008, T010, T014, T017, T018, T022 |
| FR-009 | T005, T006, T010, T014, T018, T022 |
| FR-010 | T010, T012, T020 |
| FR-011 | T011, T012, T014, T015, T021 |
| SC-001 | T009, T010, T012, T018 |
| SC-002 | T006, T010, T018, T020, T022 |
| SC-003 | T011, T012, T014, T015, T021 |
