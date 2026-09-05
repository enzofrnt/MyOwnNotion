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
