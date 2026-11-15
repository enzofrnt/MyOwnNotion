# Tasks: Tests Wait for States, Not for Time

- [X] T001 Verify the audit's conclusions in code; confirm the 7 Date.now-only files (fixtures and measurements, no wait).
- [X] T002 L0: per-attempt lane artifacts and lane selection in the gate (`.github/workflows/ci.yml`, `scripts/ci/select-lane-blobs.sh`).
- [X] T003 L1: witnesses over committed state (`tests/e2e/waits/local-state.ts`), observation helpers (`tests/e2e/waits/observation.ts`), React `until` (`apps/web/tests/support/until.ts`).
- [X] T004 L1: creation helpers wait for the committed item.
- [X] T005 Witness sensitivity journeys (`tests/e2e/wait-witnesses.spec.ts`).
- [X] T006 L2: W-01…W-07.
- [X] T007 L3: E2E P2/P3 sites (see validation.md).
- [X] T008 L4/L4bis: unit, integration and API sites; owned clocks.
- [X] T009 L5: `tests/contract/test-wait-contracts.spec.ts`, `docs/testing/wait-contracts.md`, links from `docs/development.md` and `AGENTS.md`; impact policy entries.
- [ ] T010 Five-browser local regression with repetitions, then two complete CI runs green on their first attempt.
