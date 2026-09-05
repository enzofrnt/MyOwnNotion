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

- [ ] T011 Add authorization/settings panel with explicit scope and one-use code instructions.
- [ ] T012 Add desktop/narrow Playwright grant/exchange/revoke journey and setup docs.
- [ ] T013 Run focused checks, converge artifacts and record evidence/remaining full gate.

## Phase 5: Convergence

- [ ] T014 Complete the owner authorization/settings UI, including recent-auth retry, explicit scope, code, effective status, audit and revocation per FR-001/FR-011 (missing; T011 implementation delegated).
- [ ] T015 Validate grant/exchange/revoke on desktop and narrow Playwright profiles, then record evidence per SC-003 (missing; T012 validation delegated).
