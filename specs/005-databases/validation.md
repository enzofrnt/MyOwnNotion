# Validation: Structured Databases

**Date**: 2026-08-08
**Branch**: `codex/databases`
**Result**: Passed, with the two repository shell tools deferred to Linux CI because they are not installed on the local macOS host.

## Spec Kit convergence

- `spec.md`, `plan.md`, `tasks.md`, the database schema contract, projection contract, data model, research, and quickstart describe the same page-owned version-5 database model.
- Every one of FR-001 through FR-025 and SC-001 through SC-010 maps to an implemented task and focused automated evidence.
- No database table, migration, endpoint, local cache, service, dependency, environment variable, or Compose service was introduced.
- Existing version-1 through version-4 documents remain valid; unsupported future versions and malformed version-5 content are rejected without replacing the last valid document.
- Convergence found no unbuilt requirement and no additional task to append.

## Quality gates

| Gate | Evidence | Result |
| --- | --- | --- |
| Repository formatting and lint | `biome ci .` checked 224 files without changes or diagnostics | Pass |
| Exact TypeScript | Recursive package typechecks plus the root `tsc --noEmit` completed successfully | Pass |
| Toolchain policy | The policy checker validated 308 tracked files | Pass |
| Production build | API, migration runner, web app, PWA service worker, and both production bundles built successfully | Pass |
| Full Vitest coverage | 46 files and 381 tests passed; 91.48% statements/lines, 93.30% functions, and 88.25% branches | Pass |
| Database scale target | 1,000 records × 20 properties validated, searched, sorted, and grouped at 38.1 ms p95, below the one-second requirement | Pass |
| API and storage contracts | Version-5 create, replace, reject, restore, export, log-redaction, migration, and reconciliation suites passed | Pass |
| Production Compose smoke | Images built, migrations and both health paths passed, and a complete version-5 wiki/task/database fixture survived a full stop/start | Pass |
| Shell static analysis | The gate was invoked but local `shellcheck 0.11.0` and `shfmt 3.12.0` are unavailable; no shell file changed in this feature | CI confirmation required |

The production web bundle reports the existing non-blocking chunk-size advisory (835.18 kB minified); it does not violate a current database requirement or build gate.

## Browser and responsive evidence

- The database edit, table, board, and gallery journeys passed 20/20 cases across Chromium desktop/mobile and WebKit desktop/mobile.
- The focused offline database journeys passed on Chromium, including reload, reconnection, single synchronization, removal, and competing-revision recovery.
- The database retained-revision restore journey passed on Chromium.
- Critical Axe checks, focus handoff, keyboard activation, deterministic view parity, explicit empty/unavailable states, and contained mobile overflow are asserted by the journeys.
- Deterministic property, empty-table, board, and gallery screenshots are attached by the Playwright tests. The existing GitHub workflow uploads `playwright-report/` and `test-results/` for 14 days even on failure.
- Local Firefox startup on this macOS host is blocked by Playwright's sandboxed plugin container/software compositor. The same journeys remain configured for Firefox desktop in the Linux CI matrix; Chromium and WebKit results provide the local cross-engine evidence.

## Quickstart traceability

1. **Schema and records**: toolbar/slash insertion, all six property types, options, records, leap-day dates, cleanup, reload, rename/move, export, and restore are covered by domain, web-unit, API-contract, and database-edit journeys.
2. **Table search and sorting**: title/value search, every supported type-aware ascending/descending order, exact counts, live updates, long values, overflow, and empty results are covered by domain and table journeys.
3. **Board and gallery parity**: one shared filtered/sorted identity set, option/unassigned grouping, no-select guidance, bounded summaries, focus handoff, mobile layout, and screenshots are covered by view journeys.
4. **Relations and offline recovery**: stable same-database identities, rename resolution, explicit missing targets, atomic local commits, accepted heads, catch-up, snapshots, reconnect-once, and recoverable conflicts are covered by domain, client-core, and offline journeys.
5. **Export and production restart**: exact canonical round trips, retained revisions, image construction, migrations, same-origin proxying, and persisted schema/record/relation/view state are covered by contract, E2E, and isolated Compose tests.

## Final assessment

The implementation satisfies the structured-database specification and preserves the constitution's ownership, offline, privacy, accessibility, reproducibility, and incremental-delivery principles. Linux CI must still supply the repository-pinned shell tools and execute Firefox before merge.
