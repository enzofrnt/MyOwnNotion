# Validation evidence — 2026-09-05

## Focused behavior

- 22 dedicated tests pass: 11 immutable-source/conversion tests and 11 encrypted
  target/CLI tests. A21-test run before the final activation regression measured
  feature-scoped coverage. The final22-test run passed in11.83s after the
  activation guard correction.
- 20 ordinary upload contract tests and 12 protected-file HTTP integration
  regressions passed after extracting shared canonical file publication.
- API strict typecheck and Bun production build pass; the compiled CLI help
  entrypoint executes successfully. Biome and whitespace checks pass.
- Production dependency audit reports no high/critical vulnerability; license
  policy passes for404 production packages with no violations.

Dedicated coverage:90.11% statements,79.74% branches,97.46% functions and93.35%
lines for `apps/api/src/imports/notion/*.ts`. This targeted measurement does not
replace the repository's complete coverage gate. No threshold or exclusion was
changed. The final instrumented run took66.84s under concurrent integration
load; earlier uninstrumented20-test run took16.09s. Repeated native backups emit
Bun FileHandle listener warnings without a failed test.

```bash
PATH=/opt/homebrew/opt/libpq/bin:$PATH \
TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/myownnotion \
bun run --bun vitest run --project api-contract \
  apps/api/tests/notion-import.integration.spec.ts \
  apps/api/tests/notion-import-source.spec.ts --maxWorkers=2

bun run --filter @myownnotion/api typecheck
bun run --filter @myownnotion/api build
bun apps/api/dist/imports/notion/cli.js --help
bun run security:audit
bun run security:licenses
```

## Properties demonstrated

Synthetic fixtures exercise native ZIP/Markdown/CSV and converted YAML/wikilinks/
Bases; unsafe paths, symlinks, normalization collisions, oversized text, ZIP
CRC failures and compression bombs; malformed CSV/YAML, aliases and tags;
literal code examples, large integer preservation and invalid dates. Empty
directories and generated-page collisions are accounted for.

Apply uses an actual verified full backup, then ordinary API readback verifies
pages, links, attachments, independent database sources, two displays sharing
one membership reference, typed values and relations. SQL inspection excludes
imported editorial plaintext; protected reads recover exact attachment bytes.
Interrupted operations resume after closing/reopening the target. Completed
replay preserves owner edits; partial replay refuses newer editorial and
independent definition revisions. Job locks, failed backups, inactive owners,
rotation write blocks and missing external keys refuse protected publication.
An independent review found that resumed jobs also needed the full-restore
activation guard. The new regression first failed against the old code, then
passed with assertFullRestoreActivated at open and before every operation. A
real encrypted data-restored marker inserted after an accepted step causes
refusal; job payload, mutation/revision/item/change counts and recursive blob
inventory remain identical. Both existing-target resume and new-target opening
refuse the unactivated state.
The CLI itself is tested for source-only preview, explicit configuration, apply
and idempotent replay.

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
