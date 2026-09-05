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
