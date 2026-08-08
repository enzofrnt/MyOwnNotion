# Validation: Freeform Canvas

**Date**: 2026-08-08

**Environment**: macOS, Node.js 24.14.0, pnpm 10.33.3, isolated PostgreSQL 18, Docker Compose v2.

## Automated evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Toolchain policy | Pass | 334 tracked files accepted with Node.js 24. |
| Formatting | Pass | Biome checked 238 files with no formatting changes required. |
| Static analysis | Pass | Biome CI completed; two pre-existing-order CSS specificity advisories remain non-blocking. |
| Strict types | Pass | All eight TypeScript workspace projects plus the root test configuration pass. |
| Coverage | Pass | 49 files, 409 tests; 91.73% statements/lines, 93.68% functions, 88.61% branches. |
| Canvas domain/web/client/performance focus | Pass | 10 files, 151 tests; full-scale canvas p95 remained below 107 ms under coverage and 20 ms focused. |
| API/OpenAPI/export/log-redaction focus | Pass | 5 files, 54 tests, including two exact version-6 export paths. |
| Chromium/WebKit canvas matrix | Pass | 24 journeys across desktop/mobile Chromium and WebKit; final two-width drawing change rechecked in all four projects. |
| Canvas revision restore | Pass | Exact version-6 canvas identities, page occurrence, connection, stroke, and viewport restored. |
| Production build | Pass | API bundles and web PWA/service worker built successfully. |
| Production Compose restart | Pass | Local images built; health/migrations passed; exact cards, geometry, connection, stroke, page target, viewport, and page-card relationship survived `down`/`up`. |

## Manual quickstart evidence

- Inserted a canvas from the page toolbar in the running application.
- Added and arranged text cards, created a labelled connection, changed zoom, and confirmed semantic controls.
- Exercised page cards, current-name resolution, navigation, backlink projection, and unavailable state through automated browser journeys.
- Exercised complete-stroke preview/commit, incomplete gesture rejection, removal, offline reload/reconnect, and explicit conflict retention.
- Review screenshots for empty, arranged, connected/drawing, and page-card states are attached by the Chromium desktop/mobile Playwright projects and retained by the existing GitHub artifact step.

## Environment limitation

The local macOS Firefox binary stalled before the first test body and produced no browser event for more than 90 seconds, so that local run was stopped. Chromium and WebKit passed on the same API, web server, database, and fixtures. The existing Linux GitHub Playwright job remains the authoritative Firefox gate and will execute the same committed journeys before merge.

## Outcome

All implementation, persistence, accessibility, performance, export, recovery, production-build, and Compose-restart evidence available locally passes. Final completion of the full browser gate depends only on the Linux CI Firefox run.
