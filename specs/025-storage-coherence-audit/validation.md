# Validation 025: Storage privacy and code coherence audit

Implementation progress is maintained only in [tasks.md](tasks.md).
The records below preserve their tested checkpoint, failures and limitations;
focused checks do not imply successful complete gates or delivery.

## T050 — protect resumed transitions before new SQL

Independent PostgreSQL reproduction on `1104822c` interrupted a real transition
after cutover, corrupted its original full archive, and supplied a new SQL
migration. The old guard created that migration's table and ledger entry before
refusing the archive. The archive is now authenticated under RUN before the SQL
migrator and again at storage preparation through the same verifier.

Both maintained regressions fail before correction for missing/corrupted
archives. After correction they prove the new table remains absent, the migration
ledger, installation, transition, item/file rows and original blob stay unchanged,
and repairing the exact archive permits the new SQL and completion with the same
backup identity. All eight guarded migration integration cases, API types,
Biome and whitespace checks pass. The first corrected run exposed an incomplete
test migration that omitted its own ledger insertion; after repairing that
fixture, both resume paths pass. No application migration was changed.

Evidence: `/tmp/mon-review-resume-guard.ts`,
`/tmp/mon-guarded-resume-before.log`, `/tmp/mon-guarded-resume-fixed.log`,
`/tmp/mon-guarded-resume-final.log`, `/tmp/mon-guarded-resume-types.log`.
Final complete gates remain required.

At exact checkpoint 75c950ae, refreshed full coverage passes 405 suites and
3,867 tests with unchanged absolute budgets. New tracked files are included:
static scan checks 1,105 sources and secrets scan checks 1,477 files, both with
zero findings. Logs: `/tmp/mon-audit-coverage-75c950ae.log`,
`/tmp/mon-audit-75c950ae-static.log`, `/tmp/mon-audit-75c950ae-secrets.log`.

The complete performance command passes its first six suites, including page
compaction, then fails the seventh default 2 GiB file fixture: baseline 106.5 MiB,
peak 378.3 MiB, additional RSS 271.8 MiB, exceeding the unchanged 256 MiB limit.
Remaining performance suites are not reached. T049 now blocks delivery and
requires production allocation correction plus standard-Bun verification, since
API entrypoints do not use the performance runner's existing --smol setting.
Log: `/tmp/mon-audit-performance-75c950ae.log`.

## T049 — bounded file allocations: focused verification

After that failure, the working tree based on 75c950ae removes redundant
full-payload input/concat/output copies from
`packages/domain/src/security/crypto.ts`. Cipher output owns its storage;
decryption returns only after successful tag verification. The filesystem
adapter hashes persisted bytes through one 64 KiB scratch buffer, preserving
short-read, length/digest, fsync and immutable-publication checks. Its reads
transfer fresh storage directly; protected content equality compares typed
arrays without two further chunk copies. Formats and chunk/consumer ownership
are unchanged. No secret or file bytes are logged.

These historical focused measurements used Bun 1.4.0, the version pinned when
they were recorded on the macOS host, with separate processes and disposable
PostgreSQL on 55433. The current integrated runtime is pinned to Bun 1.4.2.
Baselines ran while root coverage was finishing; all six corrected runs were
sequential after that independent gate had stopped, with no concurrent root
performance or other subagent corpus. The fixture still
ingests and authenticates 2 GiB, compares full length/hash and all three ranges,
and samples every fragment plus a 5 ms timer. Phase diagnostics add one sample
after ingestion. No forced GC or threshold/sampling reduction was introduced.

| State / runtime | Additional RSS | Result | Log |
| --- | ---: | --- | --- |
| Before / standard Bun | 253.3 MiB | PASS, marginal | `/tmp/mon-memory-baseline-standard.log` |
| Before / --smol | 256.8 MiB | FAIL | `/tmp/mon-memory-baseline-smol.log` |
| Corrected / standard Bun 1 | 199.5 MiB | PASS | `/tmp/mon-memory-fixed-standard-1.log` |
| Corrected / standard Bun 2 | 194.3 MiB | PASS | `/tmp/mon-memory-fixed-standard-2.log` |
| Corrected / standard Bun 3 | 193.2 MiB | PASS | `/tmp/mon-memory-fixed-standard-3.log` |
| Corrected / maintained runner 1 | 218.8 MiB | PASS | `/tmp/mon-memory-fixed-smol-1.log` |
| Corrected / maintained runner 2 | 230.1 MiB | PASS | `/tmp/mon-memory-fixed-smol-2.log` |
| Corrected / maintained runner 3 | 206.8 MiB | PASS | `/tmp/mon-memory-fixed-smol-3.log` |

With `TEST_DATABASE_URL` set to the disposable fixture server, each command
below ran three times. The maintained wrapper supplies its existing `--smol`
flag to the child; the first command matches shipped Bun settings.

```sh
bun run --bun vitest run --project performance tests/performance/protected-files.perf.spec.ts --maxWorkers=1
bun scripts/ci/run-vitest-with-postgres.ts run --project performance tests/performance/protected-files.perf.spec.ts --maxWorkers=1
```

Focused regression evidence on this change:

- **52 crypto tests PASS**: new WebCrypto oracle and independent buffer ownership
  cases at 0/1/17/4 MiB, valid-size tag substitution, and existing envelope and
  recovery properties. Log `/tmp/mon-memory-focused-crypto-blob.log` selects
  the three domain suites despite its historical filename.
- **57 blob-store tests PASS**: authenticated chunk boundaries/corruption,
  cancellation, durable publication, actual modified/truncated/extended writes,
  short reads with bounded scratch space and independent returned buffers.
  Log `/tmp/mon-memory-blob-tests.log`.
- **36 API tests PASS** across `protected-file-service`, `protected-files`,
  `protected-file-rotation` and `protected-file-references` integration suites:
  resumed uploads, ranges, duplicate content, maintenance locks, corruption,
  exact repair/resume and eventual key revocation. Two workers, log
  `/tmp/mon-memory-api-files-tests.log`.
- **Types PASS** for domain, blob-store, API and root tooling:
  `/tmp/mon-memory-domain-types.log`, `/tmp/mon-memory-blob-types.log`,
  `/tmp/mon-memory-api-types.log`, `/tmp/mon-memory-root-types.log`.
- **Biome PASS** for the six changed production/test files:
  `/tmp/mon-memory-biome.log`. `git diff --check` passes.

The complete command and allocation record is
`/tmp/mon-memory-t049-evidence.md`. T049 implementation and focused verification
are complete. These host results do not claim a new complete performance run,
coverage, image/native compatibility or PR/main CI pass. T038/T040/T041 retain
those final integration and delivery obligations.

### T049 complete performance reproduction at 83726de3

The maintained complete performance command passes all **9/9 suites** at
83726de3, exit 0. Log: `/tmp/mon-audit-performance-bounded-memory.log`.
The default 2 GiB fixture records baseline RSS 105.2 MiB, peak 316.4 MiB and
additional RSS **211.2 MiB**, below the unchanged 256 MiB limit. The 10,000-update
page workload records ingest 26,850.3 ms, catch-up 32,705.9 ms, compaction
11,692.7 ms and peak live heap growth 135.4 MiB. No threshold was changed.
This closes T049's complete-performance reproduction; it does not replace
`checks:local` on the final change including the later T045 test additions.

## T045 — joined offline and portable privacy proof

Read-only review found existing secured structured-write SQL checks and
page/file portable checks, but no canonical SQL inspection after actual UI
offline replay and no protected structured portable target round trip. The
existing database/page-tab journeys and protected-file portable fixture now
join those proofs, with no production behavior change.

- `protected-files.integration.spec.ts`: **14/14 API tests PASS**, including the
  expanded portable round trip. A separately secured target reopens the exact
  page/file, database definition and view, entry values, relation targets and
  relationship metadata. A later value edit preserves its title/relations and
  both retained revision values. SQL inspection before and after the edit finds
  no sentinels in items, documents, revisions, definitions, values, relationships
  or envelopes. Log `/tmp/mon-t045-portable-api.log`.
- Existing `databases-offline-sync.spec.ts` retains actual disconnected schema
  and value edits, restart, replay, compatible merge, explicit conflict choice,
  visible values and two-parent lineage, then checks canonical SQL. Existing
  `page-multi-tab-convergence.spec.ts` retains browser offline editing,
  cross-tab adoption and retry after a committed response is lost; independent
  UI and authorized API reads verify the body before SQL inspection. The new
  `canonical-storage.ts` helper also inspects operational states, updates and
  checkpoints, and requires protected envelopes to be present.
- **10/10 journeys PASS across all 5 profiles**, two unchanged journeys per
  profile: Chromium desktop/mobile, Firefox desktop, WebKit desktop/mobile.
  The official matrix runs two isolated stacks at a time and keeps Firefox/
  WebKit in the maintained Linux container. Summary
  `/tmp/mon-t045-browser-matrix.log` reports 5/5 projects in 90 s, exit 0;
  preserved logs `/tmp/mon-t045-chromium-desktop.log`,
  `/tmp/mon-t045-firefox-desktop.log`, `/tmp/mon-t045-webkit-desktop.log`,
  `/tmp/mon-t045-chromium-mobile.log`, `/tmp/mon-t045-webkit-mobile.log`.
- API and root tooling types PASS: `/tmp/mon-t045-api-types.log` and
  `/tmp/mon-t045-root-types.log`. Biome checks the four changed test/helper
  files; `git diff --check` and feature prerequisites pass.

These results supplement the secured canonical-write/structured-export and
historical migration tests already recorded at 75c950ae. That checkpoint's
coverage log also records **13 full-restore tests PASS**: activation invalidates
old trust, a new owner session reads exact protected file/range bytes, and
private names reopen. Those earlier full-restore tests were not rerun as part
of this test-only T045 addition. T045's targeted proof is complete; T038/T040/
T041 still require the final integrated gates and delivery.

Commands (all databases disposable; no development database used):

```sh
TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/postgres bun run --bun vitest run --project api-contract apps/api/tests/protected-files.integration.spec.ts --maxWorkers=1
DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:55433/postgres MYOWNNOTION_E2E_API_PORT_BASE=3701 MYOWNNOTION_E2E_WEB_PORT_BASE=5873 MYOWNNOTION_E2E_JOBS=2 bun scripts/e2e/run-local-matrix.ts tests/e2e/databases-offline-sync.spec.ts tests/e2e/page-multi-tab-convergence.spec.ts --grep 'survives restart|same-origin tabs adopt offline'
bun run --filter @myownnotion/api typecheck
bun run tsc -p tsconfig.json --noEmit
bun run biome check apps/api/tests/protected-files.integration.spec.ts tests/e2e/canonical-storage.ts tests/e2e/databases-offline-sync.spec.ts tests/e2e/page-multi-tab-convergence.spec.ts
```

## Complete coverage after allocation and joined privacy changes

At historical code checkpoint `82df5084`, the complete coverage command passes **406 suites
and 3,875 tests**, with no changed thresholds (2,452 uncovered branches, budget
2,465). Log `/tmp/mon-audit-coverage-t045.log`, exit 0. This includes the production
buffer changes, durable blob verification and T045's expanded protected portable
fixture. It is complete coverage evidence, not the remaining full `checks:local`
or a main-delivery result.

## T051 — active page response rejection and frontier monotonicity

Starting from `585b595b`, the focused public transport tests now use real Loro
transactions, a genuinely synchronized baseline at page sequence 1, encrypted
IndexedDB, and otherwise valid response metadata/canonical digests. The existing
missing-acknowledgement test is enriched rather than duplicated. Four new write
cases reject a foreign acknowledgement, a regressive acknowledged vector, an
incompatible server vector and a remote update that reuses a local identity.
Four passive pull cases reject a corrupted digest, omitted announced operations,
a regressive cursor and a regressive previously confirmed server frontier.

Each refusal preserves the complete sealed state row (checkpoint, cursor and
projection), and write refusals preserve the exact local operation bytes and
semantic changes. Reopening the local database/editor recovers the authored
content. The four passive cases then synchronize successfully with a healthy
response. Blocked write batches remain recoverable: tests do not reset them using
an otherwise unconnected helper to claim automatic retry. No private reconciler
method is called and no internal detail is mocked.

The eighth new case reproduced a production defect before its correction:
`/tmp/mon-t051-regression-repro.log` records **7 PASS / 1 FAIL**. A passive response
with a server vector older than the sealed confirmed frontier was accepted and
persisted together with a cursor advance from 1 to 2. With one exchange allowed,
the observable result was `pending / page-operations.exchange-limit`, not the
required refusal. **No false `synced` result or loss of authored bytes was
observed.** This is a confirmed rollback of durable causal metadata, not a claim
of a broader reproduced data-loss scenario.

`packages/client-core/src/page-sync/page-reconciler.ts` now requires every new
server vector to dominate the previously confirmed vector before reconstructing
or persisting a response. This also covers empty submitted batches, for which
per-update acknowledgement checks cannot enforce monotonicity. Failure follows
the existing blocked-response path without changing checkpoint/cursor/journal; a
healthy subsequent pull is still allowed. No timeout, budget, format, unrelated
response behavior or coverage exclusion changed.

Focused verification:

- **48 PASS** across rejection (8), existing reconciler (19), encryption (5)
  and atomicity (16), 1.66 s: `/tmp/mon-t051-page-rejection.log`.
- **31 PASS** for active editing sessions (13) and legacy editing/conversion
  sessions (18), 2.01 s: `/tmp/mon-t051-editing-composition.log`.
- Client-core typecheck PASS: `/tmp/mon-t051-client-types.log`.
- Focused Biome (`/tmp/mon-t051-biome.log`) and `git diff --check` PASS. Feature prerequisites and all 16
  existing requirements-checklist items pass.

```sh
bun run --bun vitest run --project client-core packages/client-core/tests/page-reconciler-rejection.spec.ts packages/client-core/tests/page-reconciler.property.spec.ts packages/client-core/tests/page-operation-encryption.spec.ts packages/client-core/tests/page-operation-atomicity.spec.ts --maxWorkers=2
bun run --bun vitest run --project client-core packages/client-core/tests/page-editing-session.spec.ts packages/client-core/tests/legacy-page-editing-session.spec.ts --maxWorkers=2
bun run --filter @myownnotion/client-core typecheck
bun run biome check packages/client-core/src/page-sync/page-reconciler.ts packages/client-core/tests/page-reconciler-rejection.spec.ts packages/client-core/tests/page-reconciler.property.spec.ts
```

Only disposable IndexedDB fixtures were used. This pass did not run browser/native
journeys, full coverage or `checks:local`; T037/T038/T040/T041 remain open for
combined integration and delivery.


## T052 — Historical source keys during resumed migration

The new real CLI fixture first failed against the merged 024 implementation:
receipt history worked but the resumed-archive verifier still supplied only B
to an archive sealed under A (`/tmp/mon-t052-red.log`). Wrapping-key rotation
is actually permitted after interrupted storage cutover, so this is reachable.

The verifier now uses owned current/historical keys from `FullBackupService`,
authenticates the original immutable archive, and clears every owned buffer in
`finally`, including archive-open failures. It still runs before any SQL and
again when preparing the storage transition. No live SQL key fallback is added.

Two focused suites pass, 10 tests total (`/tmp/mon-t052-final.log`): all nine
guarded migration scenarios and the full historical-backup lifecycle. The new
case rotates A→B through the real security CLI, confirms B opens the live root
while A cannot, refuses missing history and missing/corrupt archives without
changing ledger/data/transition/source bytes, then resumes the same transition
with explicit A history and reads the original file under B. Owned key buffers
are zeroed on refusal and success; the source archive remains byte-identical.
API typecheck and focused Biome pass. Only generated keys and disposable
PostgreSQL fixtures were used. Full local, PR and main gates remain pending.


### T053 — selective graph test selection (2026-09-08)

A changed `packages/graph/src/layout.ts` yields a related unit plan, but its
launcher excluded `graph`. The new consumer contract failed with exactly that
missing project against the real Vitest inventory. Adding it restores the
existing dependency selection; full-run commands and thresholds are unchanged.
Forty-one impact/Bun quality contracts pass. Executing the generated related
command passes 18 suites and 79 cases, including the graph tests. Strict root
types and focused Biome pass. Logs: `/tmp/mon-graph-selection-red.log`,
`/tmp/mon-graph-selection-green.log`, `/tmp/mon-graph-selection-runtime.log`,
`/tmp/mon-graph-selection-types.log`. This is focused correction evidence only;
T038/T040/T041 remain the complete local/PR/main delivery gates.


### A34 integration — structured review and history

The 014 T100 correction is merged with 026 independent sources and the 025
protected snapshot paths. All 60 selected cases pass (15 database, nine actual
page-history and 36 impact-policy cases), with strict root types passing.
Evidence: `/tmp/mon-resolution-integrated-history.log` and
`/tmp/mon-resolution-integrated-types.log`. The unchanged native offline
journey also passes twice across every browser profile on the desktop branch.
No full integrated gate or delivery is inferred from these focused results.

On integrated commit `c0ed3096`, the original offline convergence/restart and
explicit structured-resolution journey passes twice on native Linux WebKit
mobile (49 seconds, no retries). The run uses its own PostgreSQL database and
retains independent source placement plus protected canonical storage. Evidence:
`/tmp/mon-resolution-integrated-webkit.log`. Complete local and PR/main gates
remain pending.

## T054 — title reflow after a width change

The integrated Chromium `code-narrow.png` at 320 px shows the second title line
clipped after a desktop-to-narrow resize. `PageTitleEditor` previously measured
height only when its draft changed; no title edit occurs during this resize.
A new component regression fails on the previous implementation (one failure,
eleven passes, `/tmp/mon-title-reflow-red.log`). The correction observes available
width, remeasures the live textarea value and avoids reacting to its own height
changes. It keeps focus, selection, text and the original element intact, does
not trigger a save, shrinks after widening and disconnects on unmount.

All twelve component cases, strict workspace types and Biome pass
(`/tmp/mon-title-reflow-green.log`, `/tmp/mon-title-reflow-types.log`,
`/tmp/mon-title-reflow-biome.log`). The maintained code-block journey now checks
actual title overflow at 320 px in both themes and height recovery at 1280 px.
The native title/code journeys pass on all five profiles, including 320 px, both
themes and restored wide geometry. An original-code native run also reproduced
the clipped title. The renewed complete integration gate remains required.


## T055 — multipart conflict recovery

Actual PostgreSQL serialization/deadlock rollback after encrypted ingestion
reproduces the old 500 response. The corrected server returns the dedicated safe
409 without replaying its consumed stream. The client retains the File and
mutation identity across at most three fresh multipart bodies; stale, unrelated,
unauthorized, offline and uncertain failures retain their existing outcomes.
Replacement replay binds the accepted identity to the original workspace, command
and item. Tests verify exact recovered bytes, unchanged original replacement
content, one canonical acceptance and no repeated ingestion on accepted replay.

The combined title/file component and real API suites pass 46 cases. The original
client fails a native injected-conflict journey, then the corrected hierarchy
upload and all existing file journeys pass on every browser profile. Complete
integration and remote delivery remain pending.

## T056 — stable editor loading geometry

Holding a real pointer on property save while releasing the initial page
checkpoint reproduces a 32 px WebKit displacement. Containing the history toolbar
margin fixes desktop; the same regression then identifies a 12 px touch-target
difference. Sharing the existing compact/touch size with the negative toolbar
margin fixes both. All ten activation/cancellation journeys pass across the five
profiles, including release outside followed by keyboard activation. Original
property, code and file journeys also pass in their selected profile runs.
These focused checks do not claim the complete integration gate has passed.

Final combined focused verification passes 61 tests across five title, file API,
retry-client and table interaction suites. Strict workspace types and changed
source Biome checks pass; Spec Kit prerequisites and unique task identifiers
were checked for 025/026. Complete delivery checks remain open.

## T057 — bounded multipart browser evidence

The complete integration gate on 210ea535 failed an overly strict WebKit
assertion after the injected 409, a genuine `file.concurrent-write` 409,
and a successful 201 with the same mutation identity. Production remained
within its three-attempt contract. The corrected fixture verifies every
intermediate response, the final acceptance, stable identity and unique
hierarchy entry. The focused native journey passes all five browser profiles
with one worker (48 seconds). Production retry policy is unchanged.
The previous complete gate failed; renewed complete delivery remains open.


## T058 — direct bounded reads under Bun 1.4.2

The integrated gate on d4274088 failed the unchanged 2 GiB fixture at
265.5 MiB additional RSS (90.8 MiB baseline, 356.4 MiB peak). Replacing
FileHandle.readFile with one stat-sized destination and direct positional
reads removes transient read allocation amplification. Short reads are
completed; premature EOF, an extra tail byte, or a digest mismatch refuses
the result. Each successful call returns independently owned storage.

The original failed gate is recorded in `/tmp/mon-integrated-142-full-gate.log`.
The initial correction passes at 193.8 MiB. Three subsequent isolated runs
pass at 181.5/224.3/195.1 MiB with the maintained `--smol` mode, and
220.2/216.7/222.9 MiB with ordinary Bun 1.4.2. The fixture, 256 MiB budget,
sampling and authentication assertions are unchanged; no forced GC is added.
Logs are `/tmp/mon-142-direct-read-{smol,standard}-{1,2,3}.log`.

All 61 blob-store tests pass, including real file modification, truncation and
growth after stat, short reads, empty files, immutable publication and output
independence. Strict workspace types and changed-source Biome checks pass.
Complete integration and PR/main delivery remain open under T040/T041.

## T059 — explicit security and Compose CI responsibilities

The delivery inventory in `docs/development.md` listed `test:security` and
`compose:check` as blocking PR/main responsibilities, but the workflow had no
explicit jobs for either command. The correction adds independently observable
`security-tests` and `compose-check` jobs to `.github/workflows/ci.yml`, and
adds both to `quality-gate.needs`. The security job uses the repository's
standard Bun/PostgreSQL setup and runs the complete `bun run test:security`
entry point; the Compose job uses the standard Bun setup and runs the complete
`bun run compose:check` entry point. No existing affected test or security job
was removed or weakened.

The workflow contract suite passes **31/31 tests**, including assertions for
both job declarations, exact commands and aggregate dependencies. This is
focused CI topology evidence only; it does not claim `checks:local`, PR CI or
main CI completion. Those delivery obligations remain T040/T041.

## T060 — WebKit response lifecycle during reload

Main run `34707930251` attempt 1 failed only the WebKit mobile lane because an
HTTP 200 workspace change-feed response was canceled while its JSON body was
being read during `page.reload()`. The same durable internal link was visible
after reload and the Playwright retry passed; the maintained
`--fail-on-flaky-tests` policy kept the job red and retained its trace.

The focused `ContentApi` regressions resolve a 2xx `Response`, reject only its
`json()` body read with the observed `TypeError` or an `AbortError`, expect the
canonical offline result, and prove that exactly one network request occurred.
A malformed 2xx JSON body retains its `SyntaxError` instead of being mislabeled
as offline. The corrected browser journey waits for both the page save and
workspace synchronization before navigation, verifies no page error during the
operation, and retains its post-reload link assertion.

The exact failing WebKit mobile scenario passes **20/20** repetitions with one
worker and fail-on-flaky enabled. The complete block-editor file then passes
**11/11 tests on each of the five browser profiles**. Focused unit, web type and
changed-file Biome checks pass; the renewed exact local, PR and main evidence
remains part of T040/T041.

## T061 — rollback-safe protected ciphertext cleanup

The protected ingest path previously published an encrypted chunk before its
canonical SQL rows. A real transaction that ingests bytes and then rejects the
placement leaves one extra ciphertext file after rollback, while the existing
bounded cleanup sees no candidate and reports `deleted: 0` (RED evidence from
`af13f4acd682162ef649c58f8835ad5aa97796a7`).

The corrected path inserts the opaque storage key into the existing bounded
`protected_file_garbage` ledger through an independent short transaction before
the filesystem publication. The surrounding SQL transaction removes that
intent after staging the chunk reference; the removal commits only with the
authenticated manifest and owning rows. A rollback, late publication/SQL
error, or process crash therefore leaves a bounded candidate for the next
cleanup run. Cleanup still holds the exclusive
FILE maintenance lock and checks every current chunk/quarantine/legacy
reference before deleting; a reused or canonical blob is preserved and its
stale candidate is retired.

The focused real PostgreSQL/filesystem regression passes GREEN: the failed
ingest produces one extra encrypted file, cleanup removes exactly that file,
and the committed content remains byte-identical. The complete API file suite,
strict API types and changed-source Biome checks are recorded with the final
commit; complete delivery remains T040/T041.

Focused commands and results:

```sh
bun run --bun vitest run --project api-contract apps/api/tests/protected-file-service.integration.spec.ts --maxWorkers=1
# 14 tests PASS
bun run --bun vitest run --project api-contract apps/api/tests/protected-files.integration.spec.ts apps/api/tests/protected-file-rotation.integration.spec.ts apps/api/tests/protected-file-references.integration.spec.ts --maxWorkers=2
# 25 tests PASS
bun run --filter @myownnotion/api typecheck
bun run --filter @myownnotion/database typecheck
bun run --filter @myownnotion/blob-store typecheck
bun run biome check apps/api/src/files/protected-file-cleanup.ts apps/api/src/files/protected-file-rotation.ts apps/api/src/files/protected-file-runtime.ts apps/api/src/files/protected-file-service.ts apps/api/src/files/protected-upload-service.ts apps/api/tests/protected-file-service.integration.spec.ts packages/blob-store/src/blob-store.ts packages/blob-store/src/encryption/encrypted-chunk-store.ts packages/blob-store/src/filesystem-blob-store.ts packages/database/src/schema/index.ts
```

All focused commands exit 0 and `git diff --check` passes.

## T062 — direct Buffer-backed reads under Bun 1.4.2

The renewed exact `checks:local` run on
`ef38a163c05fe5500528259516926e055cf559fd` stopped at the unchanged SC-004
fixture: baseline RSS 89.2 MiB, peak RSS 358.1 MiB and **268.9 MiB additional
RSS**, above the strict 256 MiB limit. The receipt is
`integrated-release-final4-20260912-packaged.json`; its log records the exact
commit, unchanged worktree and failing assertion.

`af7899830d600eac7d9492462cd69a5fb06557cd` changes only the destination used
by `FilesystemBlobStore.get`: Bun reads directly into exact-sized `Buffer`
storage, the existing positional loop proves complete initialization, the
tail/digest checks reject truncation, growth or corruption, and callers receive
an exact `Uint8Array` view. Empty files and independently mutable return values
retain their existing behavior. An independent source review found no P0–P3
issue, and the 15 filesystem durability cases pass.

At final integrated source commit
`1083cdd9ced890637b5945c9b382a25caeb924d3`, including T063's reserved
journal lane, three sequential maintained `--smol` runs pass at
**198.9/172.0/190.2 MiB**, and three ordinary Bun 1.4.2 runs pass at
**228.8/221.8/224.8 MiB** additional RSS. Each run uses the same
2 GiB ingest/full-read/range fixture, 5 ms sampling and strict `< 256 MiB`
assertion. No threshold, payload, sampling, concurrency or GC behavior changed.
Durable logs are `integrated-sidecar-memory-{smol,standard}-{1,2,3}-20260912.log`.
The combined blob-store suite passes 61/61; exact full delivery is still owned
by T040/T041.

## T063 — reserved write-ahead database lane

The saturation regression at
`97f0818bf4e23c659882c713e2b2f201bf4528f9` holds nine clients from the
primary ten-connection pool, starts a protected ingest on the final slot, and
requires the ciphertext intent to complete within one second. The first T061
implementation requests that intent from the same pool: the test receives
`blocked` and fails 1/15 while the other 14 service cases pass. Releasing the
nine fixtures lets the pending operation finish cleanly, so the RED proof leaves
no background transaction or blob.

`1083cdd9ced890637b5945c9b382a25caeb924d3` adds one lazily used,
single-connection journal pool to each `DatabaseHandle` and wires every server,
CLI, migration, restore, import, test and performance runtime explicitly to it.
The same saturated ingest now completes while all primary slots remain occupied.
Closing the handle closes that lane together with the primary pool.
`9045b1866c6d435ee8d18cb2876d6e73ad2ee166` replaces the RED proof's
one-second observation with the pool's own waiting counter: the maintained
regression now fails exactly when the journal asks the saturated primary pool
for another slot, without imposing a machine-speed budget on healthy CI.

Focused GREEN results: protected file service **15/15**, related protected
file/upload/rotation/reference suites **25/25**, database client lifecycle
**2/2**, strict workspace TypeScript and changed-source Biome all pass.
Logs are `integrated-orphan-journal-pool-{red,green}-20260912.log`,
`integrated-journal-sidecar-protected-suites-20260912.log` and
`integrated-journal-client-lifecycle-20260912.log`. Complete exact local, PR
and main delivery remains T040/T041.

## T064 — exact protected display-name placeholder

At RED commits `96d48eea` and `77763fcd`, the exact U+FFFD storage placeholder
was accepted through page, file, resumable-upload, MCP, retained-revision and
Notion/Obsidian preview boundaries. Creation could fail as an internal error;
rename and restoration could silently retain an earlier protected name. The
shared domain reservation at `a5ffa05c` rejects only the exact trimmed value and
keeps longer authored names containing that character. Six focused suites pass
128/128, with workspace types and changed-source Biome checks green. Durable
logs are `integrated-reserved-placeholder-{red,green}-20260912.log`,
`integrated-reserved-placeholder-surfaces-red-20260912.log` and
`integrated-reserved-placeholder-biome2-20260912.log`.

The historical transition initially refused a legitimate V0 title or filename
equal to that future marker. RED commits `74f11897` and `a8a2f8e3` cover a page,
file and both retained snapshots. `aec033bd` records the legacy fact in the
authenticated source checkpoint, publishes the envelope once, and requires the
protected value for every post-write digest and source retirement. The complete
canonical migration file records 10/10 focused cases; workspace types and Biome pass. Logs are
`integrated-legacy-placeholder-migration-{red,green}-20260912.log`,
`integrated-legacy-placeholder-migration-red2-20260912.log`,
`integrated-legacy-placeholder-typecheck-20260912.log` and
`integrated-legacy-placeholder-biome2-20260912.log`.

An independent final review then deleted the newly published name envelope
before global verification. At `e0e6a48`, `finishVerification` incorrectly
advanced because fresh inventory reclassified the remaining marker as legacy.
`92d3899` re-digests each authenticated source with protected content required;
the transition remains in `metadata-protected` until the exact envelope is
restored. The complete migration file records 10/10 focused cases. RED/GREEN logs are
`integrated-finish-verification-placeholder-red-20260912.log` and
`integrated-finish-verification-placeholder-green2-20260912.log`.

These focused results do not replace the exact complete local, PR and main
delivery checks owned by T040/T041.

## T065 — exact protected structured-payload marker

At `3bfa3c2`, the focused RED matrix records eight failures. The API matcher
classified every object containing `$myownnotionProtected: 1` as storage state;
the exact one-key object produced a 500 on page creation, silently retained the
old body on replacement and history restoration, was accepted as relationship
metadata, and blocked V0 page/revision/relationship migration. Domain validators
also accepted the reserved value, while the matcher rejected legitimate
multi-key authored objects.

`559fea3` defines one exact domain marker and matcher, rejects it at shared page
and relationship boundaries, and validates retained page documents before any
restore mutation. Objects with additional own keys round-trip as authored
content. A separate authenticated V0 provenance authorizes only initial
publication of current page bodies, retained snapshots and ordinary relationship
metadata. Values opened from their envelope remain historical content; strict
post-publication digest, global verification and retirement never use the
plaintext exception.

Focused GREEN passes 114/114 across two domain and three API suites, including
two complete V0 transitions through retirement. Full workspace TypeScript and
changed-source Biome checks pass. Durable evidence:

- `integrated-protected-payload-marker-red-20260912.log`
- `integrated-protected-payload-entry-red2-20260912.log`
- `integrated-protected-payload-marker-green1-20260912.log`
- `integrated-protected-payload-typecheck1-20260912.log`
- `integrated-protected-payload-biome2-20260912.log`

Exact complete local, PR and main evidence remains governed by T040/T041.

## T066 — strict envelope revalidation

`ded9429b` moves the protected-metadata assertion to a shared completion helper
and invokes it before `finishVerification`, `cutover` and final `retireNext`
completion. The focused destructive regression removes a published envelope and
keeps the transition before the next lifecycle phase until the exact envelope
returns. This is targeted evidence; T037/T038/T040/T041 remain open.

## T067 — authenticated V0 provenance and v2 inventory

`983384ba` authenticates the full-backup receipt, manifest, installation
identity and source application-version evidence, requiring the absence of
`0006_installation_application_version` for the V0 exception. The version-2
inventory persists source backup ID and provenance across resume and re-inventory
and rejects a mismatched or modern source. Focused migration and guarded-backup
checks are recorded; no final delivery gate is claimed.

## T068 — portable archive V1/V2 and streaming validation

### T068a — canonical content and TAR framing

`bfd14c12`, `4315e7ef`, `6508c532`, `7b55a1fc`, `3cfef6fa`, `d7d20ddf` and
`037570b` retain V1 compatibility while enforcing V2 markers, exact graph and
file invariants, fatal UTF-8 decoding, raw-byte digests, portable USTAR framing,
positive structured versions and PostgreSQL-representable JSON. Validation runs
before any archive byte is emitted or any restore-target mutation begins. The
real V1 database restore remains covered by the integration path.

### T068b — page-operation archive

`c8ce0df9`, `2e3c6f1d`, `1385efbc`, `33b7e1e9`, `7b1e1b4e`, `c12a13eb`,
`10a8acf4`, `037570b` and `e003264` validate the complete operational inventory, protected
references, digests, frontiers, compaction receipts and restore preflight. At
`e003264`, the final combined command passes **7 files / 168 tests** and the
focused PostgreSQL/API command passes **5 files / 41 tests**. The separate
90-day, 10,000-change convergence case passes in 150.0 seconds. Full workspace
types, changed-source Biome and `git diff --check` pass. Durable logs are
`integrated-final-archive-focused-20260913.log`,
`integrated-final-page-operations-focused-db-20260913.log` and
`integrated-final-page-operations-db-20260913.log` under the delivery artifact
directory. These focused results do not replace T037/T038/T040/T041.

## T069 — protected history fail closed

`1ac10b32` and `cce42dea` prove that GET and restore distinguish a missing
protected envelope (500) from an expired snapshot (410). Compaction and restore
refuse raw fallback, while `6fb9a8ac` and `38896281` remove raw fallback from
legacy-branch conversion and require an explicit client base with bounded
retention. Focused refusal suites pass; complete delivery remains open.

## T070 — exact reflection matcher

The domain matcher now uses `Reflect.ownKeys` and an exact one-own-string-key
check. Symbol and non-enumerable properties cannot alter protected-marker
classification, and multi-key authored objects remain accepted. The focused
domain evidence is retained with T065; final local, PR and main gates remain
T040/T041.

## T071 — authenticated historical V1 inventory resume

`f78b4594` accepts only a V1 inventory bound to the authenticated source backup,
receipt, installation, transition, exact entry set and digests, then persists
the V2 replacement before resuming. Both modern and V0 source evidence are
supported; V0 remains mandatory only for marker exceptions. The historical
file-only metadata supplement is restricted to `inventoried` or `backfilling`,
and absent/mismatched provenance refuses continuation. The focused migration
matrix passes **3 files / 41 tests**, with workspace types green. Durable output
is `integrated-final-v1-inventory-migration-20260913.log` under the delivery
artifact directory.

## T072 — archive SQL representability

At `037570b` and `e003264`, zero definition/value versions
and nested U+0000 in canonical or page-operation string values/object keys fail
preflight. This includes free operational failure codes and ambiguity keys.
Direct and streaming producers refuse before any archive byte is emitted;
inspection reports the invalid archive; `applyArchive` leaves `target.begin`
untouched. The final
T068 matrix records the aggregate counts after both corrections.

## T073 — initializing operational state

An empty format-v3 `initializing` state with sequence zero now passes export,
inspection, verification and full restore. Checkpoints, updates, frontiers,
digests, windows, device receipts, ambiguities or conversions on that state are
rejected in shared preflight. Archive/restore contract and the PostgreSQL full
round trip are included in the 168/41 final matrices above.

## T074 — retained update causality

Every retained update blob is checked against its declared Loro base. Its
authored result is reconstructed and joined with the preceding server frontier,
then compared with the retained cumulative receipt even when covered by the
current checkpoint. Reproductions for a forged base and a covered forged result
fail before any archive byte is emitted or any restore-target mutation begins;
concurrent valid histories and compacted receipt-only updates pass.

## T075 — checkpoint head bounds

A non-current checkpoint beyond `lastUpdateSequence` previously passed archive
inspection and restore. Shared preflight now rejects every checkpoint beyond the
complete contiguous journal head; current, candidate and retained positive paths
remain covered by page-operation archive and compaction suites.

## T076 — operational timestamp order

Focused negative cases cover checkpoint verification before creation, update
compaction before acceptance, ambiguity resolution before opening, legacy
conversion before creation and page update before bootstrap. Each is refused
before any archive byte is emitted or any restore-target mutation begins; valid
canonical millisecond UTC timestamps continue to round-trip.

## T077 — checkpoint sequence/frontier binding

A crafted checkpoint at sequence zero whose snapshot already contained update 1
was accepted before `037570b`. Shared preflight now equates genesis with update
1's base frontier and checkpoint N with update N's result frontier. Snapshot
opening still verifies that frontier and canonical digest; current head may move
beyond it only through successful replay. The compacted full-backup restore
integration passes with the earlier expected refusal moved to preflight.

## T078 — legacy operational-state isolation

`legacy` now denotes an empty pre-activation operational state. A checkpoint,
update, frontier, operational digest, revision window, device receipt, ambiguity
or conversion makes the archive invalid before any archive byte is emitted or
any restore-target mutation begins. The valid legacy canonical-page path remains
covered by the archive contract suite.

## T079 — placementless reusable database export

The first exact complete local gate at `b0245c6` stopped during coverage in
`apps/api/tests/linked-databases.contract.spec.ts`: canonical export required
exactly one hierarchy placement for every active non-file item. A reusable
database source item and a database-entry item are intentionally independent
canonical records, so after every display host is purged both may have zero
hierarchy placements. The validator therefore rejected a valid source/entry
export and the complete gate correctly failed.

`38eb48e` scopes that cardinality rule to ordinary active non-file items while
retaining the dedicated database source, entry, membership and view
relationship invariants. The focused purge/restore regression passes in
**2 files / 45 tests**. Durable output is
`integrated-linked-db-canonical-fix-20260913.log`; the failed complete-gate
output remains `integrated-release-final-b0245c6-20260913.log` under the delivery
artifact directory. This correction does not close T037/T038/T040/T041; the
exact complete gate and PR/main delivery must be rerun on the corrected commit.
