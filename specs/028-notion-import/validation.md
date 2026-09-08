# Validation evidence — 2026-09-05

## Focused behavior and coverage convergence

The final scoped run passes 104 tests across 9 API suites in 22.24s, using only
synthetic sources and disposable PostgreSQL databases on 55433. API strict
typecheck, Biome and whitespace checks pass. Earlier API production build,
compiled CLI help, dependency audit and license-policy checks also passed;
this final increment changes tests and maintained validation artifacts only.
The full repository gate remains an integration responsibility.

The initial comparable 72-test run measured 90.38% statements, 80.05% branches,
93.67% lines, with 87 uncovered statements and 145 uncovered branches. T017–T019
add 32 behavioral cases and meaningful assertions to existing cases. The final
measurement is 98.12% statements, 92.43% branches, 99.39% functions and 99.24% lines:
17 statements, 55 branches, 1 function and 6 lines remain uncovered. Global
thresholds and exclusions are unchanged. No test-only production API, mocked
canonical mutation, fabricated checkpoint or coverage exclusion was added.

| Module | Statements | Branches | Remaining statements / branches |
| --- | --- | --- | --- |
| `canonical-file-import.ts` | 100% | 100% | 0 / 0 |
| `apply.ts` | 96.62% | 82.55% | 5 / 15 |
| `cli.ts` | 95.65% | 98.11% | 2 / 1 |
| `markdown.ts` | 100% | 92.12% | 0 / 13 |
| `model.ts` | 100% | 50% | 0 / 2 |
| `plan.ts` | 98.31% | 93.75% | 6 / 18 |
| `source.ts` | 97.31% | 94.68% | 4 / 5 |
| `target.ts` | 100% | 93.75% | 0 / 1 |
| `change-stream-heartbeat.ts` | 100% | 100% | 0 / 0 |

Boundary evidence:

- Native ZIP/Markdown/CSV and converted YAML/wikilinks/Bases retain source
  originals, metadata, hierarchy, independent memberships and exported table
  displays. Tests cover empty folders/ZIPs/sources, 10,001 empty archive entries,
  encrypted or malformed archives, CRC/ratio/path/symlink/UTF-8 violations,
  filesystem replacement/growth/mtime/containment races and handle closure.
  Filesystem race injection uses real temporary files with controlled
  filesystem responses; no production I/O or size limits are changed.
- Conversion tests cover ambiguous CSV members, blocking canonical document
  and definition validation, missing configurations, unsafe/missing/ambiguous
  links, Notion-ID links, reference images/links, inline HTML, footnotes,
  frontmatter outside databases, large integers/nonfinite values and invalid
  civil dates. Missing Notion view settings are never fabricated.
- Actual protected apply takes a verified full backup. Ordinary HTTP readback
  verifies pages, links, typed properties/relations and exact attachment bytes.
  Refused folder/file publication leaves no accepted content or checkpoint.
  Folder/file mutation collisions refuse replay. Resuming a committed file
  leaves its logical record and revisions identical; completed replay preserves
  owner edits. Tampered GCM job metadata refuses before new mutations or blobs.
- Job locking, failed backups, inactive owners, installation/workspace changes,
  pending migrations, rotation blocks and missing deployment keys refuse
  writes. A real encrypted full-restore marker inserted after a committed step
  blocks both opening and resuming; job, mutations, revisions and blobs remain
  identical. Human-readable and JSON CLI output, argument failures, preview,
  dry-run precedence, empty apply and completed replay are exercised.
- A real separate Bun writer is observed by the running API SSE stream; the
  canonical durable feed catches up after reconnect. The heartbeat covers
  revocation before reads, unchanged/regressing cursors, overlapping ticks,
  local notification races, late resolutions/rejections after close and bounded
  transport/database failure handling without sensitive logs.

Remaining uncovered paths are recorded explicitly, rather than presented as
full coverage:

- `apply.ts`: defensive lookups after dependency ordering at 180/210, missing
  definition heads at 195/311, missing snapshot file at 249; 15 branches also
  include optional field/head fallbacks and document parsing already validated
  before opening a target. Real stale editorial/source heads and canonical
  refusals are tested.
- `cli.ts`: the process-entrypoint stdout adapter at 89–90 is exercised by the
  compiled CLI help smoke, outside the Vitest instrumented process. All exported
  CLI runner behavior is covered.
- `markdown.ts`: 13 branch alternatives concern guaranteed regex captures,
  parser-provided positions/definitions/alt text and recursive-call defaults;
  all conversion statements are exercised. `model.ts`: 2 zero-byte fallbacks
  follow a fixed 16-byte SHA-256 slice. `target.ts`: 1 owner-ID fallback follows
  the ready-installation non-null check.
- `plan.ts`: statements 375/406/542/769 guard array/map values constructed in the
  same pass; 521 guards a relation target already resolved during relation type
  selection; 718 propagates unexpected internal exceptions. The 18 remaining
  branches include these and optional fallback paths. External malformed
  definitions/documents and ambiguous/cyclic source inputs are tested.
- `source.ts`: aggregate 256 MiB budget overflow at 101 is not exercised with a
  large in-memory corpus in this bounded suite; per-file and entry/ratio limits
  are tested. The depth guard at 115 follows normalized path depth validation.
  Stream-size fallback guards 185/189 follow yauzl size validation; malformed
  archive refusal is exercised through the parser. The fifth branch is the
  equal-path sort comparison, after normalized duplicate paths are refused.

Repeated native backup fixtures emit Bun FileHandle listener warnings without
a failed test. No application behavior needed correction during this coverage
pass. Scope-restricted percentages cannot establish that the integration-wide
absolute uncovered budgets pass; that conclusion requires the full gate.

```bash
PATH=/opt/homebrew/opt/libpq/bin:$PATH \
TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/myownnotion \
bun run --bun vitest run --project api-contract \
  apps/api/tests/notion-import.integration.spec.ts \
  apps/api/tests/notion-import-source.spec.ts \
  apps/api/tests/notion-import-source-races.spec.ts \
  apps/api/tests/notion-import-cli.spec.ts \
  apps/api/tests/notion-import-stream.contract.spec.ts \
  apps/api/tests/change-stream-heartbeat.spec.ts \
  apps/api/tests/change-stream.contract.spec.ts \
  apps/api/tests/uploads.contract.spec.ts \
  apps/api/tests/protected-files.integration.spec.ts \
  --maxWorkers=2 --coverage \
  --coverage.include='apps/api/src/imports/notion/*.ts' \
  --coverage.include='apps/api/src/sync/change-stream-heartbeat.ts' \
  --coverage.include='apps/api/src/files/canonical-file-import.ts' \
  --coverage.reporter=text --coverage.reporter=json \
  --coverage.reportsDirectory=coverage/notion-import-boundaries
```

## Authorized actual-source preview

Only source inventory and preview were run against the candidate folder. No
connection to a personal target was opened; no personal import was applied.
No source filenames, note text, detailed private report or real attachments
are committed. Aggregate observations:

| Measure | Result |
| --- | --- |
| Source files / bytes | 342 / 34,244,166 |
| Canonical pages | 278, including3 synthesized display hosts |
| Canonical folders | 100, including source-original mirrors and empty folders |
| Independent database sources / displays | 8 / 9 |
| Database memberships | 110 |
| Attachments / preserved originals | 58 / 284 |
| Reported links | 536 |
| Blocking observations | 0 |
| Invalid canonical documents / definitions | 0 / 0 |

202 observations explicitly cover1 shortened display title,9 exported Bases
settings retained in originals,15 HTML blocks and106 HTML inline fragments
preserved inertly,22 Markdown tables preserved as source,39 missing and2
ambiguous content links, plus7 ambiguous and1 missing property links. Those
counts identify conversion limits, not successful reconstruction of missing
Notion settings.

## Delivery boundary

No0018 migration was needed. Feature026 source/embedding foundation is a
dependency; feature013's backend is the branch base. The root integration task
owns complete `checks:local`, independent review and publication. No push,
pull request, merge or personal-stack operation was performed for028.

## Final convergence

The review checked11 functional requirements,4 success criteria,11 acceptance
scenarios,10 implementation decisions and8 constitution principles. The single
critical partial finding (activation guard during resume) becameT015 and was
implemented with a failing-then-passing regression. A second convergence pass
found no remaining implementation gap and left the task list unchanged.

## Separate-process synchronization convergence

A second independent finding concerned live discovery of the CLI's committed
changes. The healthy API SSE stream formerly received only its own process's
notifications. The60s operational-page sweep was not a workspace metadata
poll, so an idle folder view could remain stale until another write, reload
or reconnect. A real Bun child writer reproduced the missing announcement
while the stream continued receiving keep-alives.

T016 adds canonical cursor reconciliation to the existing SSE heartbeat
(20s by default), after access verification. It suppresses unchanged/older
cursors, concurrent ticks, late completions after closure and unhandled
transport/database failures. Existing immediate notifications remain intact.
No new bus, network write endpoint or alternate content path was added.

Validation:2 cross-process/reconnect socket tests,10 heartbeat boundary tests,
6 existing SSE contract regressions and2 Web reconnect/online tests pass.
The child uses the same submitCanonicalMutation service as the CLI; the
reconnected client reads the ordinary durable feed from its applied cursor.
API typecheck/build pass after the change.

AfterT016, final convergence reports no remaining gap in the specified import
and synchronization scope. Integration-wide delivery gates remain with the
root task.

## Integration with MCP, sources 026 and current audit

The requested feature commits were applied to `codex/pre-v1-features`, based on
the validated 026/027 integration `29fb2688`, followed by audit T050. Frozen
installation, monorepo types, formatting and Biome pass. The focused combined
selection passes 21 suites and 222 distinct tests, including all 20 protected
import cases, 13 full restore cases and 8 guarded migration cases using native
PostgreSQL 18 tools. Explicit imported placements and independent source heads
remain intact; the API/CLI share canonical accepted-write guards and the
protected file service. See [the shared report](../026-linked-databases/integration-validation.md)
for exact commits, initial environment failures, corrected CI inventory,
cross-feature MCP scope evidence and remaining delivery gates.

Coverage convergence checks the same 11 functional requirements, 4 success
criteria, 11 acceptance scenarios, 11 plan decisions and 8 constitution
principles. No new functional finding was identified after T017–T019; the
remaining instrumented coverage paths above stay visible to integration.


## T020 — Native CSV source membership (2026-09-08)

A synthetic preview bound a CSV row to an unrelated root note with the same
title, leaving its actual exported subpage outside the database and reporting
no blocking issue (`/tmp/mon-notion-csv-scope-repro.log`). Regression tests also
showed that a globally unique note concealed ambiguous local subpages; two
negative tests failed before correction (`/tmp/mon-notion-csv-scope-red.log`).

The planner now prefers the CSV's own same-title subpages, blocks multiple local
matches and only falls back globally when there are no local matches. Explicit
row paths remain supported. The native fixture covers two separate databases
with same-title entries and an unrelated root note. Canonical SQL/API readback
proves two correct memberships and three distinct bodies; replay changes no
membership. No personal data was applied.

Source and protected integration suites pass 40 tests
(`/tmp/mon-notion-csv-scope-final.log`), API types and focused Biome pass. The
first integration assertion used the wrong fixture field `entryId`; correcting
it to the actual `entryItemId` preserved the intended membership assertion.
Full integrated coverage and delivery gates remain required.
