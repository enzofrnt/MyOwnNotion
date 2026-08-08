# Validation: Links and Knowledge Graph

**Validated**: 2026-08-08

**Branch**: `codex/links-knowledge-graph`

**Runtime**: Node.js 24 with the repository-pinned pnpm 10.33.3

## Result

The implementation satisfies the feature specification and all executable acceptance criteria. Wiki-link documents, canonical and local relationship projections, backlinks, outgoing links, local/global graphs, offline reconciliation, export, revision restoration, and production-container persistence are covered by automated validation.

## Static and build gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Formatting | Pass | Biome checked 192 files with no changes required. |
| Lint/static analysis | Pass | `biome ci .` checked 192 files with no findings. |
| Exact package types | Pass | All eight workspace packages and the root TypeScript project completed with no errors. |
| Production build | Pass | API and migration bundles, web application, PWA manifest, and service worker built successfully. |
| Toolchain policy | Pass | The tracked source set uses the pinned pnpm lockfile and TypeScript-only first-party source. |

The web build reports an advisory warning for a JavaScript chunk larger than 500 kB. It does not fail the build and does not affect the feature acceptance or the measured knowledge-graph performance bound. Code splitting remains a later performance optimization.

## Automated test evidence

| Suite | Result | Evidence |
| --- | --- | --- |
| Full Vitest coverage | Pass | 40 files and 307 tests passed. Global coverage: 91.13% statements, 88.50% branches, 92.74% functions, and 91.13% lines. |
| Database integration | Pass | Initial document projection, add/remove/reactivate, invalid target, lifecycle, migrations, transaction atomicity, revision retention, and file-placement suites passed. |
| API and workspace contracts | Pass | Version-3 document replacement, restore, relationship changes, logging redaction, OpenAPI, Compose security, and export round trips passed. |
| Property tests | Pass | Document compatibility, hierarchy, identity, lifecycle, relationship, ordering, mutation, and revision-lineage invariants passed. |
| Performance | Pass | The 500-page/1,000-occurrence knowledge graph built and filtered in under one second; the 2,000-block editor and content-foundation reference bounds also passed. |
| Chromium browser matrix | Pass | 20/20 wiki-link, backlink, graph, offline/conflict, and revision journeys passed across desktop and mobile projects. |
| WebKit browser matrix | Pass | 20/20 equivalent journeys passed across desktop and mobile projects. |
| Accessibility/responsive checks | Pass | Critical Axe checks, keyboard-only menu/graph navigation, semantic graph list, focus behavior, and narrow-viewport overflow checks passed. |
| Production Compose smoke | Pass | Images built, migrations completed, API/proxy health checks passed, and a version-3 wiki link remained navigable after a complete composition restart. |

## Quickstart scenario coverage

1. **Create and follow a wiki link**: covered by `tests/e2e/wiki-links.spec.ts`, including keyboard/pointer insertion and navigation plus stable identity after rename and move.
2. **Backlinks and outgoing links**: covered by `tests/e2e/backlinks.spec.ts` and domain aggregation tests, including duplicate occurrence counts and lifecycle states.
3. **Local and global graph**: covered by `tests/e2e/knowledge-graph.spec.ts` and the deterministic graph/performance suites, including filter, keyboard, pointer, semantic list, and mobile layout.
4. **Offline durability and conflict**: covered by `tests/e2e/wiki-links-offline.spec.ts` and client fault-injection/reconciliation tests, including reload, exactly-once catch-up, removal, and competing revisions.
5. **Production-like restart and evidence**: covered by `scripts/ci/test-containers.ts`; desktop/mobile screenshots and traces are attached by the Playwright journeys and retained by the GitHub workflow.

## Environment-specific limitations

- Firefox could not start on this macOS host because its `plugin-container` process was denied by the host application sandbox and timed out before any application code ran. The identical Firefox desktop/mobile projects remain mandatory in GitHub Actions on Linux, and no Firefox-specific failure was observed in the application.
- The locally pinned ShellCheck 0.11.0 and shfmt 3.12.0 binaries are absent. No shell file changed in this feature; the unchanged GitHub Actions shell-quality job installs those exact versions and remains the authoritative gate.

These limitations are environmental rather than skipped product assertions: all browser-independent behavior is covered by Vitest, both locally launchable browser engines passed, and the full production-container path passed.
