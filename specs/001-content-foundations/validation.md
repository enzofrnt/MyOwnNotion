# Validation: Canonical Content Foundations

**Branch**: `codex/implement-content-foundations-7037-continue`  
**Local validation date**: 2026-08-07  
**Reference toolchain**: Node.js 24.19.0, pnpm 10.33.3, Docker 29.4.3

## Static and build gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Frozen dependency install | Pass | `pnpm install --frozen-lockfile` completed with the committed lockfile. |
| Toolchain policy | Pass | 214 tracked files checked; no foreign lockfile, unsupported source, or unmanaged Python project. |
| Biome format/lint | Pass | Repository-wide read-only format and lint gates completed without findings after the implementation formatting pass. |
| ShellCheck/shfmt | Pass | Pinned ShellCheck 0.11.0 and shfmt 3.12.0 verified. No first-party tracked shell scripts currently exist; generated `.specify/scripts/` remain untouched by explicit policy. |
| Strict TypeScript | Pass | Every workspace package and the root TypeScript project type-checked. |
| Production builds | Pass | API server plus migration runner and the Vite web application built successfully. |

## Automated behavior and coverage

The complete Vitest coverage run passed 30 files and 226 tests:

| Metric | Measured | Required |
| --- | ---: | ---: |
| Statements | 90.18% | 90% |
| Lines | 90.18% | 90% |
| Functions | 91.36% | 90% |
| Branches | 87.35% | 85% |

The run includes domain unit/property tests, IndexedDB local projection and outbox fault injection, PostgreSQL integration/migrations, API/workspace contracts, export round trips, and the reference performance project. Measured reference timings were 1.1 ms p95 for hierarchy reads, 1.1 ms p95 for item reads, and 10.9 ms p95 for 1,000 accepted randomized mutations, all below the 150 ms target.

## Browser matrix

| Project | Local result |
| --- | --- |
| Chromium desktop | Pass, 17/17 journeys |
| WebKit desktop | Pass, 17/17 journeys |
| Chromium mobile | Pass, 17/17 journeys |
| WebKit mobile | Pass, 17/17 journeys |
| Firefox desktop | Environment-blocked locally; GitHub Actions result pending |

Firefox reaches `browserType.launch` but the macOS application sandbox denies its Playwright plugin-container extension before any test begins (`sandbox_extension_issue_file_to_process: Operation not permitted`). This is not an application assertion failure. The required GitHub Actions job installs and runs Firefox on `ubuntu-latest`; its result is the reference evidence and must be green before merge.

## Compose and container artifacts

- Development and production-like Compose files render successfully and publish only loopback host ports.
- Both API and web images build from a clean BuildKit context using digest-pinned runtime bases and a frozen pnpm install.
- The production-like smoke test passed migration ordering, direct API health, same-origin web `/health` proxying, application writes, a full stop/start cycle, and database/blob persistence.
- PostgreSQL 18 named volumes use `/var/lib/postgresql`, matching the current image layout.
- `compose.prod.yaml` defaults to GHCR image references, accepts immutable `sha-<full-commit>` tags, and keeps documented local-build fallbacks.
- `.github/workflows/container-images.yml` builds on pull requests without publishing and publishes multi-architecture API/web images with immutable revision tags only from trusted `main`, release-tag, or manual events.

Actual GHCR retrieval by this revision is pending publication from an accepted trusted event. Until then, the documented local-build fallback is the valid clean-host procedure.

## Repository protection and aggregate CI

The committed `.github/rulesets/main.json` requires pull requests and the stable `quality-gate` check. The workflow aggregate fails if any install, lint, shell, type, coverage, integration, contract, Playwright, build, or container job is failed, cancelled, skipped, or missing.

Remote pull-request CI and live GitHub ruleset confirmation are pending branch publication. This section must be updated with the final PR/check result before T094 and T103 are considered complete.
