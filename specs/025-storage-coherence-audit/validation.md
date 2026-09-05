# Validation 025: Storage privacy and code coherence audit

Implementation progress is maintained only in [tasks.md](tasks.md).
The records below preserve their tested checkpoint, failures and limitations;
focused checks do not imply successful complete gates or delivery.

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

Pinned Bun 1.4.0 on the current macOS host, separate processes, disposable
PostgreSQL on 55433. Baselines ran while root coverage was finishing; all six
corrected runs were sequential after that independent gate had stopped, with
no concurrent root performance or other subagent corpus. The fixture still
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
