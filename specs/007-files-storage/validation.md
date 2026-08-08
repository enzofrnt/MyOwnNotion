# Validation: Files and Durable Storage

## User Story 2 checkpoint — 2026-08-08

The private object-storage and durable streaming checkpoint passes on the local production topology.

### Focused evidence

| Area | Command | Result |
| --- | --- | --- |
| UUIDv7 regression | `node --import tsx` 100,000-identity invariant loop | Passed: every identifier had version 7 and an RFC 9562 variant |
| Domain identity | `pnpm exec vitest run packages/domain/tests/ordering.property.spec.ts` | Passed: 7 tests |
| Streamed API | `pnpm exec vitest run apps/api/tests/files-streaming.contract.spec.ts` | Passed: 7 tests, including abort, invalid input, idempotency, deduplication, and transaction cleanup |
| S3 adapter | `pnpm exec vitest run packages/blob-store/tests/s3.integration.spec.ts` | Passed: bucket privacy, full/range parity, restart, outage, persisted digest, and multipart abort |
| Audit and migration | `pnpm exec vitest run apps/operations/tests/foundation.spec.ts apps/operations/tests/storage-commands.integration.spec.ts` with isolated PostgreSQL | Passed: 12 tests |
| Performance | `pnpm exec vitest run tests/performance/files-storage.perf.spec.ts` | Passed: 256 MiB streaming under the 32 MiB ArrayBuffer ceiling, range response under one second, and 10,000-object audit under one second |
| Production topology | `pnpm test:containers` | Passed: images built; private object storage had no published host port; streamed upload, full and range digests, restart persistence, health proxy, migrations, and storage audit succeeded |

### Fault and recovery evidence

- Missing, mismatched, temporary, and unreferenced objects are reported without deletion or disclosure of internal locators.
- Filesystem-to-S3 migration is dry-run-first, verifies destination bytes before changing a locator, and is idempotent.
- Interrupted multipart uploads are aborted and temporary filesystem uploads are removed.
- The object volume survived complete application container removal and recreation, and the same revision-qualified bytes and range were returned afterward.
- A production-container audit exposed an intermittent UUID variant defect; the generator was corrected and guarded by a 5,000-identity domain test plus the 100,000-identity checkpoint above.

### Remaining gates

Encrypted backup implementation, restore, full browser evidence, coverage, documentation, and the final cross-feature validation remained open after this checkpoint; later sections supersede items as they are completed.

## User Story 3 implementation checkpoint — 2026-08-08

The encrypted backup implementation and isolated fault matrix are complete. A final real-container repository rehearsal remains required before the feature-wide validation tasks can close.

| Area | Command | Result |
| --- | --- | --- |
| Manifest and operations foundation | `vitest` focused manifest/foundation projects | Passed: 18 tests |
| Backup and maintenance isolation | `vitest` focused backup integration/command projects, excluding the temporarily unavailable external PostgreSQL case | Passed: 19 tests plus the manifest/foundation tests; one external snapshot test deferred |
| Operations type safety | operations package strict TypeScript check | Passed |
| Operations production bundle | operations package production build | Passed; bundled Node 24 CLI produced |
| Compose contract | focused production Compose security contract | Passed |

The injected matrix covers database dump failure, missing object, repository write/remote failure, snapshot lookup failure, repository check failure, completion-tag failure, overlap, invalid retention, daily scheduler restart, and redacted persistent status. No failed path returns a recoverable snapshot identity or adds a completion tag before verification.

The external PostgreSQL snapshot case and a real restic/rclone/Docker run could not be repeated at this point because the execution environment temporarily refused further privileged service access after reaching its usage allowance. They remain explicit gates for T058–T060; this is not recorded as recoverability proof.

## User Story 4 implementation checkpoint — 2026-08-08

Restore verification, guarded apply, exact object-key reproduction, API startup refusal, Compose wiring, and the operator rehearsal are implemented. The pure canonical comparison contract is complete; its production-container execution remains open because it requires the currently unavailable Docker/PostgreSQL services.

| Area | Command | Result |
| --- | --- | --- |
| Restore and guard isolation | focused restore verify/apply, API guard, filesystem exact-key, and Compose contract suites | Passed: 37 tests |
| Backup/restore fault set | focused operations suite | Passed: 65 tests; the one real PostgreSQL snapshot test could not start without a container runtime |
| Strict types | blob-store, operations, API, domain, and root TypeScript projects under Node 24 | Passed |
| Canonical contracts | focused OpenAPI, file-storage, and backup/restore comparison suites | Passed: 30 tests |

The restore preflight requires one complete-tagged encrypted snapshot and validates repository state, manifest closure, schema/PostgreSQL compatibility, archive readability, exact staged inventory, and every database/object length and digest before mutation. Apply requires an explicit empty-target confirmation, proves both targets empty, writes a persistent guard before the first mutation, restores the database in one transaction, reproduces collision-suffixed object keys exactly, and removes the guard only after count and digest cross-verification. Injected database/object interruptions and post-apply disagreement preserve the guard; the API refuses initialization with a redacted diagnostic while it exists.

The documented clean-host workflow now uses a distinct Compose project and fresh named volumes, includes exact verify/apply/start/audit/restart commands, and defines whole-target deletion as the only partial-restore rollback. The production smoke now implements encrypted repository initialization, complete backup/list/full-data check, wrong-secret rejection, empty-target restore, canonical export and file-digest comparison, target restart, repository corruption rejection, and API guard rehearsal. Its TypeScript path is valid, but it has not been executed in this checkpoint because Docker is unavailable; T058–T060 therefore remain open rather than being inferred from isolated evidence.

New canonical exports explicitly carry file content and revision identities beside byte length and SHA-256. Legacy version-1 exports without the two added identity fields remain valid, while the recovery comparison rejects changes to file digest/content/revision, placement, relationship, document, cursor, or any other canonical field. The isolated comparison suite passes 8 tests; the real source-versus-restored export assertions are wired into the pending container rehearsal.

## Cross-cutting quality gates — T058 — 2026-08-08

Toolchain and focused suites were re-run on Node.js 24.19.0 with pnpm 10.33.3, ShellCheck 0.11.0, and shfmt 3.12.0. One TypeScript fixture arity mismatch in `apps/operations/tests/restore-verify.integration.spec.ts` was corrected so every CLI exit-2 case supplies an environment object.

| Area | Command | Result |
| --- | --- | --- |
| Toolchain policy | `pnpm toolchain:check` | Passed (412 tracked files) |
| Shell policy | `pnpm shell:check` | Passed (pinned tools present; no first-party tracked shell scripts) |
| Formatting | `pnpm format:check` | Passed (281 files) |
| Biome CI | `pnpm lint:ci` | Passed (282 files) |
| Exact types | `pnpm typecheck` | Passed (all workspace packages + root) |
| Migrations | `pnpm db:test-migrations` | Passed: 5 tests |
| Unit | `pnpm test:unit` | Passed: 306 tests |
| Property | `pnpm test:property` | Passed: 56 tests |
| Integration | `pnpm test:integration` | Passed: 44 tests |
| Contract | `pnpm test:contract` | Passed: 148 tests |
| Performance | `pnpm test:performance` | Passed: 11 tests |
| Operations focused | `vitest run --project operations` | Passed: 72 tests |

## Cross-cutting quality gates — T059 — 2026-08-08

Coverage, production builds, Chromium journeys, and CI artifact wiring were re-verified after the backup/restore and e2e polish fixes.

| Area | Command | Result |
| --- | --- | --- |
| Coverage | `pnpm test:coverage` | Passed: 567 tests; All files 90.93% statements / 87.07% branches / 93.64% functions / 90.93% lines (above 90/85 floors) |
| Production builds | `pnpm build` | Passed: API, web (including injectManifest service worker), and operations bundles |
| Chromium matrix | `pnpm exec playwright test --project=chromium-desktop --project=chromium-mobile` with `CI=true` | Passed: 123 tests, 1 skipped (mobile performance project) |
| CI artifacts | `.github/workflows/ci.yml` | Confirmed: `coverage/` upload; Playwright `playwright-report/` + `test-results/` (images/traces) on always; full five-project e2e job on Ubuntu |

### Browser-matrix residual notes

- Feature-specific service-worker HEAD rewriting journeys in `tests/e2e/files-storage.spec.ts` skip WebKit by design; Playwright service-worker-aware HEAD routing is Chromium-only. Preview/download/reuse remain covered on every project.
- Local Firefox launch on this macOS host was blocked by the seatbelt sandbox in earlier full-matrix attempts. The authoritative Firefox/WebKit desktop+mobile matrix remains the Ubuntu CI `e2e` job, which installs browsers with `--with-deps` and retains report/trace artifacts.
- A prior local WebKit-inclusive run showed offline/conflict flakes outside the Chromium-proven path; they are not treated as recoverability proof and are deferred to CI rather than inferred green.

## Compose recoverability — T060 — 2026-08-08

`pnpm test:containers` completed successfully after correcting restore apply (`pg_restore --dbname=`), post-tag restic snapshot identity lookup, process-env merging for operations runners, shared named backup volume for macOS Docker, and `chmod u+w` before intentional pack corruption.

| Area | Evidence |
| --- | --- |
| Command | `pnpm test:containers` |
| Result | Passed with closing message: private object storage, encrypted backup, clean-target exact restore/restart, wrong-secret/corruption faults, restore guard, audit, health proxy, migrations, and v6 wiki/task/database/canvas persistence |
| Topology | Isolated Compose projects with disjoint source/restore host ports; encrypted restic repository initialized; complete-tagged backup; empty-target verify/apply; canonical export/digest comparison; target restart; wrong-secret rejection; corrupted pack rejection after writable pack mutation; API restore-guard refusal path exercised |
| Follow-up ops isolation | `vitest run --project operations` Passed: 72 tests after the restore/backup fixes |

Feature `007-files-storage` Phase 7 polish tasks T058–T063 are complete on recorded evidence above.

## Convergence pass — Phase 8 — 2026-08-08

Spec Kit converge against the live codebase appended three residual gaps, then implement closed them:

| Task | Result |
| --- | --- |
| T064 FR-001 hierarchy file actions | `HierarchyFilePanel` exposes metadata, download/preview via `FilePreview`, and labelled placement removal when a hierarchy file is selected |
| T065 FR-025 400% zoom | `tests/e2e/files-storage.spec.ts` asserts metadata/download visibility and horizontal containment under `documentElement.style.zoom = 400%` |
| T066 plan restic 0.19.1 | Operations image installs official `restic` 0.19.1 Linux binaries with SHA-256 verification; CLI default tool version is `0.19.1` |
