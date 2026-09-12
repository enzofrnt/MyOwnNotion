# Validation: Code block UI

Date: 2026-09-05. Isolated branch `codex/027-code-block-ui`, based on e38ccd3b.
No push, PR or merge from this subtask; complete integration gate owned by parent.

## Specification and design

Spec Kit specify → plan → tasks → read-only analyze preceded source changes.
Analysis: 8/8 functional requirements covered; 4 success criteria covered;
0 conflicting requirements, 0 unresolved ambiguities, quality checklist 5/5.
No extension hooks configured. Constitution and product canvas reviewed;
canonical block shape, API, export and migration history remain unchanged.

Convergence found one behavior gap: native mobile Enter bypassed the code
keymap and lost its newline. T013 adds a narrowly scoped, composition-safe
beforeinput handler with real transaction tests and mobile browser coverage.

## Completed checks

- 74 focused Vitest tests across 9 Web suites: highlighter (all 12 offered
  grammars, two themes, 100-line Unicode/markup/whitespace sample), toolbar,
  native code input, editor input/adapter/remote adoption, property round-trip,
  content security and existing rich blocks.
- Web TypeScript and root E2E TypeScript checks.
- Biome changed source format/lint/import checks and `git diff --check`.
- E2E and ordinary production Web bundle builds using Bun 1.4.0, the version
  pinned when this isolated feature evidence was recorded. Integrated delivery
  uses the repository's current pinned Bun 1.4.2 toolchain.
- Production dependency audit: no high/critical findings; license policy:
  384 production packages, zero violations; static security: zero findings.

## Browser and visual evidence

The final official container matrix passed all 15 journeys across Chromium,
Firefox and WebKit desktop plus Chromium and WebKit mobile (5/5 projects,
79 seconds, two projects maximum, retries disabled). Log:
`/private/tmp/mon-code-ui-matrix-final.log`. Screenshots `code-light.png`,
`code-dark.png` and `code-narrow.png` in each project result were inspected;
the final 320 px view contains horizontal source scrolling within its frame.

Journeys exercise
selected token replacement/undo, language changes/undo/redo, source typing,
native Enter, both themes, 320 px scroll containment, unknown language, empty
source, stable Copy pointer cancellation/Enter/Space/retry, synthetic composition,
real second-owner-device update, offline API reload and canonical persistence.

The browser composition scenario sends real composition events and commits
Unicode through insertText; it does not automate an operating-system IME.
Offline reload deliberately keeps the static application shell reachable while
blocking API/WebSocket routes, matching the existing repository outage tests.
Grammar/theme imports are static in precached app assets and use the JavaScript
regex engine; no CDN, new network API or CSP exception is needed.

## Local runner notes

An initial raw container invocation failed before test code because Docker
Desktop could not write its bind-mounted results directory in the new worktree
(EIO reproduced with standalone Bun.write and shell write). The ignored local
`test-results` path was redirected to a writable `/private/tmp` directory, then
the unchanged official matrix runner was used. No tracked runner code changed.
The wrapper's unused `myownnotion-postgres-1` service was briefly started and
restored to stopped; the user's `myownnotion-dev-postgres-1:5432` remained running
and untouched. All test data used isolated databases on PostgreSQL 55433.

## Delivery boundary

T012 remains pending: complete `bun run checks:local` on integrated changes,
then branch push, PR CI, review and merge. No standalone full-gate or release
claim is made by this feature subtask.

Global `format:check` and `lint:ci` additionally identify one inherited formatting
error in `apps/api/tests/administrative-recovery.integration.spec.ts:162–182` at
the base commit. This audit-owned file is outside feature 027 and was reported
to the integration owner; changed feature files pass Biome. Secret scanning
passes with zero findings. These facts do not replace T012's complete gate.

## Final convergence

All eight functional requirements and four success criteria have implementation
and focused evidence. Native mobile input and cold grammar compilation findings
are resolved. No remaining feature implementation task was found; T012 remains
the explicit integration/delivery boundary. Canonical `{type: "code", text,
language}` data remains suitable for future importers without a migration.

## Integration against the current audit

Feature 027 and the four feature 026 commits were applied without conflicts to
audit base `1104822c` in a new isolated integration branch. Frozen installation,
repository-wide formatting, Biome and types pass there; the inherited format
issue above is absent from that base. Focused integration checks pass 31 suites
and 235 distinct tests. Convergence task T014 fixes the missing code-block E2E
journey declaration in the CI impact inventory. Details and pending audit T050
and delivery gates are recorded in
[the shared integration report](../026-linked-databases/integration-validation.md).
The browser evidence above remains historical feature-branch evidence; T012
is still pending on the eventual delivery combination.
