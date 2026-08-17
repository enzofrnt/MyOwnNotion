# Validation: CI Cache and Selective Tests

**Date**: 2026-08-17

**Branch**: `agent/ci-cache-selective-tests`

**Status**: Ready for pull-request validation

## Targeted evidence

- The impact policy and plan schema are covered by 29 contract tests in
  `tests/contract/test-impact.spec.ts`.
- Workflow and publication cache invariants are covered by 25 release-gate
  tests and 22 release-artifact tests.
- Generated `none`, `related`, `direct`, and `full` plans validate against the
  versioned JSON schema; an invalid mode is rejected.
- Both sides of Git renames are retained, deleted TypeScript sources fail closed
  to full Vitest, and missing comparison bases select the complete corpus.
- All 24 maintained Playwright journeys are declared exactly once, have at least
  one owner, and use the five projects declared by Playwright configuration.
- GitHub Actions workflow files parse successfully; formatting, lint, type
  checks, and targeted contract tests pass. Lint reports only the two existing
  non-blocking CSS specificity warnings.
- Live runner checks passed for a related domain source, an editor source with
  mapped E2E ownership, a changed direct test, and an explicit no-op plan.

## Quickstart scenarios

Every scenario in `quickstart.md` produced the expected conservative result:

| Change | Expected result | Result |
|---|---|---|
| Unconsumed documentation | No Vitest or E2E process | PASS |
| Domain block source | Related Vitest groups and three owned E2E journeys | PASS |
| Editor source | Related unit tests and two owned E2E journeys | PASS |
| Dependency lockfile | Full Vitest and all 24 E2E journeys | PASS |
| Unknown executable path | Full fallback with the unknown path reported | PASS |
| Empty valid selection | Successful explicit no-op | PASS |

The same planner also produced full plans for push, release/workflow-call, and
manual events, each with an isolated trusted cache scope.

## Complete pre-push gate

`pnpm checks:local` passed in full on Node.js 24 with the repository-pinned tool
versions. Evidence included:

- toolchain, shell formatting/static checks, repository formatting, lint, and
  TypeScript checks;
- 1,947 unit tests across 135 files with 90.04% statement/line coverage;
- 281 database integration tests and 6 explicit migration tests;
- 827 contract tests across 51 files;
- 704 Chromium/WebKit desktop/mobile E2E tests with 24 expected skips;
- 174 Firefox desktop E2E tests in the documented container path with 8
  expected skips;
- application build plus API and web multi-architecture image builds for
  `linux/amd64` and `linux/arm64`, including provenance and SBOM generation;
- production dependency audit (one allowed moderate finding), secret scan,
  static security analysis, license policy, and Compose contract validation.

The first local attempt stopped before the test suites because the host had
`shfmt` 3.13.1 while the repository requires 3.12.0. The successful run used
the official 3.12.0 binary, so no required gate was skipped or weakened.

## Spec Kit review

- Requirements checklist: 16/16 items complete.
- Cross-artifact analysis: no HIGH or CRITICAL finding.
- Convergence: 21 functional requirements, 10 success criteria, 16 acceptance
  scenarios, 7 plan decisions, and 8 constitution principles checked; no
  missing, partial, contradictory, or unrequested implementation found.

The pull-request CI remains the required validation of the exact proposed
commit before merge.
