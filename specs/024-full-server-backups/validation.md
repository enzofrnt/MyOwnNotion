# Validation — complete server backups

Work in progress on `codex/024-full-server-backups`. No user data, live deployment,
or original development checkout has been migrated or restored. No push or merge.

## Verified local behavior

- Manifest validation: 8 tests pass. Authenticated framing and streaming archive:
  14 tests pass, including altered/truncated/trailing ciphertext, path rejection,
  exclusive publication, symlink refusal and no plaintext staging.
- PG18 tools and read-only source inspection: 11 tests pass with actual PG18.1
  client tools and an isolated PostgreSQL 18 server. Unknown table rows and
  sequences survive restore, snapshots exclude later commits, credentials stay
  outside process arguments, failed SQL restores roll back.
- Pre-migration guard: 4 feature tests plus the existing update-guard integration
  pass. Failed backup leaves old schemas unmigrated; migration failure retains a
  locally verified recovery artifact; source V0/unknown is explicit; remote outage
  does not discard verified local protection.
- Full restore and CLI: 5 integration tests pass. Actual encrypted page data,
  historical unknown records and device identities survive; old cookies fail
  after explicit activation. Incomplete restores block startup and activation.
  CLI inspection succeeds without live database access; a real disposable
  database rehearsal succeeds and leaves source records unchanged.
- Scheduling: 17 tests pass, including boot catch-up, failed-run retry, DST,
  overlapping ticks and remote maintenance when today's local copy is current.
- Full service: real committed upload prefixes exclude uncommitted suffixes;
  remote failure/retry, last-valid-copy retention, missing/corrupted artifact
  detection and corrupt receipt detection pass in an isolated integration test.
- Destination contract: 13 tests pass after atomic filesystem publication and
  bounded/cleaned-up remote transfer handling.
- API types pass after CLI and scheduler integration. The full workspace gate,
  coverage budgets and image builds have not yet run on this feature.

## Evidence still missing at the initial checkpoint

Concurrent upload finalization/deletion, operational status and rehearsal
persistence, settings UI, runtime images for both architectures, image scans,
full local checks, PR CI and main CI remain outstanding. Distribution/recovery
claims must not be inferred from these focused tests.

## Subsequent integration evidence

- The complete feature corpus initially passed 62/68 tests; six old cleanup
  assertions expected no operational metadata. They now distinguish the encrypted
  activity record from unpublished staging and assert the actual outcome.
  All 14 affected service/restore tests pass after the correction.
- The real upload concurrency test passes: PATCH/finalization waits behind the
  exported snapshot, the archive retains the committed prefix even after the live
  file is finalized/deleted, and simultaneous nightly calls publish once.
  All 20 existing upload contract tests pass.
- Full status/rehearsal HTTP routes require owner access and CSRF for rehearsal;
  the complete restoration outcome is durably recorded. Six recovery tests pass,
  including old bootstrap capability/provisional kit invalidation, retained
  device identities, active-tree and symlink-parent target refusal.
- A full operational recovery test compares every public SQL table before
  activation, then logs an absent device back in with its real browser binding.
  Its offline Loro branch merges with restored edits and the device identity is
  retained. Test fixtures were corrected to use the production browser-binding
  UUID-v4 contract; the real route is not bypassed.
- Four Chromium desktop journeys pass: actual full creation/26-hour warning,
  actual full and legacy portable rehearsals, narrow dark-theme status and
  keyboard error/retry, and absent/unfinished protection. The rehearsal button
  retains keyboard focus while busy. Subsequent screenshots were reviewed in
  light mode at 1280 px and dark mode at 320 px; no horizontal overflow or
  misplaced focus remained. The display test now refreshes its simulated
  persisted rehearsal date/outcome after success, matching the real API journey.
- The ARM64 production image builds with PG18.6 clients. A smoke using only its
  bundled admin CLI passes full run, verify, disposable rehearsal, empty-target
  apply, explicit activation and SQL/sequence/blob/upload-prefix comparisons.
  It uses its own PostgreSQL container, Docker network and volume and cleans them.
  This smoke is now included in the image gate for future PR/main runs.

These are focused proofs, not a completed full workspace gate or delivery claim.

## Convergence and current gate status

- Both ARM64 and AMD64 production images build with PG18.6 clients; pinned Trivy
  scans report zero fixed high/critical vulnerabilities on each. Native ARM64
  image restore passes. Running the AMD64 Bun executable through this Mac's
  QEMU environment failed in JavaScriptCore before application code; native
  AMD64 runtime proof belongs to the same image smoke on the Ubuntu CI runner.
  This emulator failure is not recorded as a successful restore.
- All 3,624 tests passed in the second aggregate coverage run. The absolute
  budgets still failed (1,950 lines, 351 functions, 2,344 statements and 2,602
  branches uncovered), so this was not a green local gate. Budgets and exclusions
  remain unchanged. Additional recovery failure tests are under verification.
- The latest focused safety run passes 56 tests across six files: actual CLI
  creation/listing/preview/apply/activation, restored attachment reads,
  authenticated corrupt metadata, unavailable external keys, remote readback
  repair, last-copy retention during outage, and bounded/killed native processes.
  Three administrative provenance tests also pass, distinguishing known full
  artifacts, portable exports, missing artifacts and unknown prior image/version.
- Spec Kit convergence checked 21 functional requirements, six success criteria,
  17 acceptance scenarios and the implementation boundaries in the plan. It
  found an overly broad PostgreSQL source-major acceptance in the manifest.
  T025 closes that gap: 19 manifest tests pass, including older/future majors,
  malformed provenance, impossible dates and invalid file metadata. Delivery
  evidence in T023/T024 remains open.
- The current feature still requires a green full workspace gate, final image
  verification on the delivered source, PR CI and post-merge main CI. No push,
  merge, live-data restore or Notion import has been performed for feature 024.

### Additional failure-path verification — 2026-09-05

- Aggregate coverage run 4: all 386 files / 3,671 tests passed. The unchanged
  uncovered-code budgets still refused the run: 2,265 statements (limit 2,216),
  1,885 lines (limit 1,866), 2,534 branches (limit 2,465); the function budget
  passed. This is not a successful pre-push gate.
- Subsequent focused checks passed: 10 complete restore tests, 17 complete
  storage/service tests, and 5 unified administration CLI tests. They cover
  active-database hostname aliases, recovery after loss of the old host,
  nonempty/file/symlink targets, activation bound to the target database,
  rollback after device-activation failure, storage alias containment,
  abandoned encrypted staging cleanup, preservation of a remote archive after
  local corruption, and full CLI inventory/creation/verification.
- Whole-workspace strict TypeScript passed after these additions. Aggregate
  coverage run 5 is in progress; full local gates and PR/main checks remain
  outstanding. No user installation or user data was modified for these tests.

- Aggregate coverage run 5: all 3,678 tests passed; statement and branch budgets
  remained over by 23 and 50. Subsequent compatibility/storage/refusal tests
  passed, including V0 activation without authentication tables, native client
  major-version rejection, preflight storage replacement, malformed metadata,
  no-progress writes and recovery CLI provider-key loss. The decryptor now wipes
  its private key copy even if cipher construction rejects the key length.
- Aggregate coverage run 6: all tests passed, with 2,223 uncovered statements
  (limit 2,216) and 2,498 uncovered branches (limit 2,465). Lines and functions
  passed. These results still block the pre-push gate; limits are unchanged.

- Provider convergence T026 exposed and fixed two source-stream lifecycles:
  rejected credentials/session setup left the archive open, and a file-open
  error could arrive after cleanup removed its listener. Upload cleanup now
  waits for stream completion with the error handler retained. The real missing
  file regression previously raised an uncaught ENOENT; it now passes. All 45
  focused provider and native PostgreSQL tests pass, including length mismatch,
  atomic name collision, unavailable destinations, safe provider failures and
  historical `sha-<commit>` provenance. The original seven-statement /
  33-branch aggregate gap remains unclaimed pending a new coverage run.

- Aggregate coverage run 7 passed all 387 files / 3,710 tests and all absolute
  budgets except branches (2,475 versus 2,465). Subsequent focused checks pass:
  62 storage/schedule/metadata tests and 14 remote/recovery tests. They prove
  zero-byte attachment recovery, rejection of directory-shaped upload data,
  idempotent remote retry, loss immediately after remote upload, cancellation
  before rehearsal database creation, invalid restore parents and safe scheduler
  behavior under clock movement/non-Error failures. Final full gates remain open.

- Full gate on bdfdda04 passed all code/style/type checks, 387 files / 3,715
  aggregate tests with every unchanged coverage budget, all eight isolated
  performance benchmarks, database/migration tests and contracts. Chromium then
  found three older journeys assuming the portable panel was expanded. The
  remaining matrix was interrupted gracefully; this was not a green full gate.
- T027 preserves those checks against both the primary full-backup surface and
  explicitly expanded portable exports. All three focused Chromium accessibility,
  320px overflow and settings-history journeys pass. The full gate is rerun on
  the resulting commit, with no skipped required gate or relaxed assertion.
## Prepared integration with current desktop and UI guidance

The local backup branch now includes desktop code checkpoint `1159ce45` and
the UI skill's pointer-cancellation/typography guidance. The only merge conflict
was the introductory desktop plan: both the native ACL design and the shared
UI pointer are retained, in the same order as the dedicated UI branch.
Whole-workspace formatting, Biome and TypeScript pass:
`/tmp/mon-backup-integration-format.log`, `/tmp/mon-backup-integration-lint.log`,
`/tmp/mon-backup-integration-types.log`. No backup runtime code changed during
this merge. This preparation does not claim a new complete local gate, a push
or delivery; the final branch must incorporate verified main before those gates.

## T028 — Historical deployment-key recovery (2026-09-05)

Candidate: `codex/024-backup-key-history`, based on `4877f7c6`; tests executed on
the T028 working tree before its dedicated commit. Fixture material is generated
under temporary directories and removed; no owner data or personal stack is used.
Bun 1.4.0, PostgreSQL 18 client binaries from `/opt/homebrew/opt/libpq/bin`,
`TEST_DATABASE_URL` points to the disposable-test server on `127.0.0.1:55433`,
with `--maxWorkers=2`. The source/restore databases are distinct disposable DBs.

The original review reproduced the defect: after A→B wrapping rotation an A
archive remained readable with A only, B saw zero historical receipts, and
retention left the expired A copy outside its catalogue. The former completion
message additionally instructed destroying A. The correction preserves external
A custody and current B writes without rewriting any archive.

Focused validation: **14 suites / 186 tests PASS**, log
`/tmp/mon-backup-key-history-validation.log`. Run with
`bun run --bun vitest run --project api-contract --project workspace-contract
--project database-integration --maxWorkers=2`, selecting:

- API `full-backup-key-history.integration.spec.ts`, `full-backup-read-keys.spec.ts`,
  `full-backup-archive.spec.ts`, `full-backup-metadata.spec.ts`,
  `full-backup-service.integration.spec.ts`, `full-restore.integration.spec.ts`,
  `full-backup-consistency.integration.spec.ts`, `full-backup.integration.spec.ts`,
  `backup-config.spec.ts`, `wrapping-key-rotation.integration.spec.ts`, and
  `backup-admin-commands.spec.ts` under `apps/api/tests/`.
- `packages/database/tests/update-guard.integration.spec.ts`.
- `tests/contract/compose-security.spec.ts` and `test-impact.spec.ts`.

The new real rotation test proves: both A receipts and A activity authenticate
after B rotation; old archives verify through CLI; rehearsal restores A into
isolation; actual restore refuses B even with A configured in history; explicit
A restore/activation reopens the original data key with A and refuses B. The
separate cutover case creates an outer A archive after SQL rewrap B, restores and
activates with A, verifies the A marker is gone, then starts `buildApp` with B,
reads the original data key and canonical private page, refuses SQL key A, and
gets HTTP 200 from health. Remote retry preserves immutable A bytes and writes
its new receipt with B; subsequent B scheduling opens only with B and coalesces
a second run; retention prunes old A receipts/archives, including remote copies,
while retaining the final verified B copy.

Read-key tests cover bounded JSON/file sizes, relative/duplicate/NUL paths,
missing/malformed/permissive secrets, non-files, symlink aliases into data,
external secrets replaced after service construction, configured secret failures
before catalogue filtering, and owned-buffer cleanup. Archive tests additionally
prove historical key ownership and component corruption refusal after manifest
key selection. Existing interrupted-key activity behavior remains intact.

Targeted Istanbul measurement for the new `read-keys.ts` module: **100% lines,
100% functions, 98.36% statements, 97.14% branches**. Report:
`/tmp/mon-backup-key-history-coverage/coverage-final.json`, log
`/tmp/mon-backup-key-history-coverage.log`. The remaining defensive branch rejects
ENOENT for the filesystem root during canonicalization; the root exists on our
target and no impossible filesystem state was fabricated just to mark it covered.
This scoped measurement is not a full-project coverage gate. No thresholds or
exclusions changed; combined coverage remains an integration gate.

API and root TypeScript checks, whole-repository Biome CI/format checks, secret
scan, static security scan and Compose contract check all PASS. The new optional
override also passes actual `docker compose -f compose.yaml -f
compose.backup-key-history.yaml config --format json` with synthetic external
paths: both API/migrate resolve a read-only bind with `create_host_path: false`,
and receive the explicit container-path JSON. No services or user volumes were
started or changed. Expanded Compose/test-impact contracts pass.

Limits: no full application gate, production image build or real Windows ACL
execution was run for this isolated correction. The existing authoritative key
loader remains responsible for Windows ACL validation. These delivery/runtime
checks belong to T023/T024 and parent integration. No push, PR or merge.

## T029 — Bounded reader resources — 2026-09-08

A public synthetic `openFullStream` probe reproduces 100 retained FileHandle
close listeners after 100 reads. Completed and cancelled stream regressions
both fail before correction. Bounded positional reads preserve the borrowed
handle and leave zero listeners after the same probe. No listener limit is
raised and no warning is suppressed.

Five archive, consistency, PostgreSQL restore and historical-key suites pass
56 cases, including truncated/tampered input and actual A→B recovery. The
existing 1,000-item backup/restore and 2 GiB protected-file budgets pass; the
latter measures 224.6 MiB additional RSS under its unchanged 256 MiB limit.
These are distinct checks; the protected-file benchmark is not a measurement
of the new complete-archive component loop. Root types, Biome and whitespace
checks pass. Evidence:
`/tmp/mon-full-backup-listener-probe.log`,
`/tmp/mon-full-backup-listener-probe-final.log`,
`/tmp/mon-backup-reader-resources-red.log`,
`/tmp/mon-backup-reader-recovery-final.log`,
`/tmp/mon-backup-reader-performance.log`.

The integrated gate at `51baab5f` was deliberately interrupted during coverage
(exit 130) to fix this reproduced issue. It is not delivery evidence:
`/tmp/mon-pre-v1-entry-activation-full-gate.log`. The complete gate must restart
on the corrected commit; PR and main remain pending.

The first restarted gate on `85a1cd68` stops at API typechecking: the pinned
Node types omit FileHandle's EventEmitter methods. The resource test now narrows
the actual runtime object with `instanceof EventEmitter` before counting its
listeners. API types and all nineteen archive tests pass; application code is
unchanged. Failed gate: `/tmp/mon-pre-v1-reader-resources-full-gate.log`.
Focused proof: `/tmp/mon-backup-reader-api-types.log` and
`/tmp/mon-backup-reader-typed-final.log`.

### Remote retention and retry fairness convergence — 2026-09-12

The RED regression reproduced two safety gaps in `FullBackupService`: retention
could remove a local artifact when a configured provider returned success for an
idempotent delete of an absent remote object, and `retryRemote()` repeatedly
selected the newest failed receipt, starving older failures. The GREEN correction
requires a `verified` receipt plus an exact remote read-back before remote/local
deletion, and records optional authenticated `remoteRetryCount` and
`remoteLastAttemptAt` fields. Receipts written before these fields remain valid;
missing values default to zero/null during retry ordering. One retry remains the
per-tick bound, and the persisted ordering survives a new service instance
without changing `createdAt` or local `verifiedAt`.

The focused integration file `apps/api/tests/full-backup-service.integration.spec.ts`
passes **2/2 tests** (including the pre-existing upload/remote scenario). The new
scenario first fails against the previous selector, then passes after correction:
three durable remote failures are retried oldest-first across a service restart;
failed receipts keep their local files when the remote has no object and delete
is idempotent; a later exact remote verification permits pruning only the verified
old copy. This is focused evidence only; full local, image, PR and main delivery
gates remain T023/T024.

### Backup delivery branch refresh (2026-09-08)

The standalone 024 delivery branch now includes desktop corrections through
`a2f2eb9b` and the T029 bounded-reader/type correction from the integrated audit.
At `c31eabe0`, all 56 archive, PostgreSQL, consistency, complete restore and
actual A→B wrapping-history cases pass (`/tmp/mon-024-reader-delivery-focus.log`).
The full 024 local gate and PR/main checks remain required; these focused cases
are not permission to push. Delivery order remains desktop, UI guidance,
complete backups, then the integrated audit and remaining pre-V1 features.
# T030 — Image verifier host boundary

PR 173 run 34246091846 reaches the complete image recovery check, then fails
because the host has no Bun executable. The original script reproduces that
failure locally with Bun absent from PATH. With the receipt parsed by the tested
image's Bun, the same restricted-host check passes real SQL/blob restoration,
committed upload prefix, rehearsal and activation against the retained ARM64
full-backup fixture image. The renewed exact-commit complete local gate and
remote image verification remain pending. No host runtime dependency or skipped
recovery assertion was introduced.
