# Validation: Tasks and Planning Views

**Date**: 2026-08-08  
**Branch**: `codex/tasks`  
**Result**: Implemented; local quality gates pass except for two host-tool limitations documented below. The GitHub quality gate remains authoritative for Linux Firefox and pinned shell binaries.

## Spec Kit convergence

- All 27 functional requirements and 10 measurable outcomes are represented by the version-4 document contract, pure task projection, editor controls, planning views, local-first reconciliation, export, production smoke, or automated acceptance journeys.
- All 43 implementation tasks are complete.
- The implementation introduces no task table, migration, endpoint, service, dependency, or second synchronization protocol. Task views derive from canonical page documents as planned.
- The requirements checklist remains 16/16 complete, and no clarification marker or unresolved scope decision remains.

## Automated quality gates

| Gate | Evidence | Result |
| --- | --- | --- |
| Format | `pnpm format:check` over 206 files | Pass |
| Lint/static analysis | `pnpm lint:ci` over 207 files | Pass |
| Exact types | recursive package TypeScript plus root `tsc --noEmit` | Pass |
| Toolchain policy | 284 tracked files checked with Node.js 24 | Pass |
| Vitest + PostgreSQL | full `pnpm test:coverage`, including domain, web, client, database, API, export, and performance projects | Pass |
| Coverage | statements 91.05%, branches 88.66%, functions 92.42%, lines 91.05% | Pass |
| Task performance | 5,000-task projection/filter/sort/group p95 27.9 ms; limit 1,000 ms | Pass |
| Browser acceptance | 9 task/revision journeys on Chromium desktop; the same journeys on Chromium mobile, WebKit desktop, and WebKit mobile | Pass, 36/36 |
| Production build | API bundles plus Vite/PWA web build | Pass |
| Production-like restart | isolated Compose build, migrations, direct/proxied health, full stop/start, version-4 task and wiki-link persistence, disposable-volume cleanup | Pass |
| Diff integrity | `git diff --check` | Pass |

The local host does not provide the pinned `shellcheck` 0.11.0 and `shfmt` 3.12.0 executables. No shell file changed in this feature; CI installs and runs both pinned tools before the aggregate quality gate.

The Playwright Firefox Nightly binary launches locally but macOS denies its `plugin-container.app` sandbox extension and its software compositor cannot map a framebuffer. Chromium and WebKit pass on this host. The repository still runs Firefox desktop in the Linux GitHub matrix, where this macOS host restriction does not apply.

## Acceptance evidence

- Capture: toolbar task insertion, stable UUID, pointer and keyboard completion/reopen, explicit save, reload, page rename, hierarchy move, and source-task focus.
- Metadata: todo/in-progress/completed/cancelled transitions, consistent checkbox semantics, leap-day due date, fixed priority, reload, responsive layout, and critical Axe scan.
- Planning: All/Today/Upcoming/Overdue/Finished classification, combined filters, deterministic sorting, list/board identity parity, source navigation, trash exclusion, restore return, empty state, and responsive overflow.
- Offline: local capture and metadata, planning projection before sync, offline reload, single synchronized identity, offline removal, and complete local-document retention after a competing revision.
- History/export: exact version-4 identity and metadata through API restoration, browser restoration, canonical export validation, deterministic JSON round trip, and log redaction.
- Review images: capture, metadata, and board journeys attach screenshots for Chromium desktop and mobile; the existing CI artifact retains `playwright-report/` and `test-results/` for 14 days.

## Quickstart review

The five scenarios in `quickstart.md` are covered by the browser journeys and isolated Compose smoke above. The production-like interface remains loopback-only because authentication is outside the feature scope.

