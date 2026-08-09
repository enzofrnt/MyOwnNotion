# Validation Record: Canonical Content Foundations

Measured results for T094. Everything below was executed, not inferred.

**Date**: 2026-08-09
**Feature**: `specs/001-content-foundations/`
**Local environment**: Linux (WSL2), Node.js 24, pnpm 10.33.3, Docker Desktop
29.5.3, PostgreSQL 18 via Compose

## Coverage

Measured with `pnpm test:coverage` (Vitest + V8) over `packages/*/src` and
`apps/api/src`.

| Metric | Threshold | Measured | Result |
| --- | --- | --- | --- |
| Statements | 90% | **91.38%** | pass |
| Lines | 90% | **91.38%** | pass |
| Functions | 90% | **93.05%** | pass |
| Branches | 85% | **88.71%** | pass |

**37 test files, 402 tests, 0 failures.**

No threshold was lowered to reach this. Exclusions and their justification are
listed in `docs/development.md`; the only excluded executable first-party file
is `apps/api/src/server.ts`, recorded as an explicit exception in
[plan.md](./plan.md#recorded-exceptions).

### Lowest-covered files still in scope

These remain above the aggregate floor but are the weakest points, all in the
PostgreSQL adapter layer, and are the natural target for the next pass:

| File | Statements | Branches | Functions |
| --- | --- | --- | --- |
| `packages/database/src/repositories/lifecycle-repository.ts` | 73.52% | 73.33% | 85.71% |
| `packages/database/src/repositories/file-repository.ts` | 73.40% | 68.42% | 85.71% |
| `packages/database/src/mutations/execute-command.ts` | 89.97% | 83.33% | 70.58% |

## Test layers

| Layer | Command | Result |
| --- | --- | --- |
| Unit + property + local-store | `pnpm test:unit`, `pnpm test:property` | pass (297 passed, 3 skipped) |
| Database integration | `pnpm test:integration` | pass (7 files, 47 tests) |
| Contract (OpenAPI, export, compose) | `pnpm test:contract` | pass (11 files, 74 tests) |
| Migrations | `pnpm db:test-migrations` | pass (5 tests, empty + forward fixture) |
| End-to-end | `pnpm test:e2e` | pass (see matrix below) |

## Playwright matrix

Five projects are configured in `playwright.config.ts`: `chromium-desktop`,
`firefox-desktop`, `webkit-desktop`, `chromium-mobile` (Pixel 7), and
`webkit-mobile` (iPhone 14). 18 journeys per project.

| Project | Where verified | Result |
| --- | --- | --- |
| chromium-desktop | local + CI | 18/18 pass |
| chromium-mobile | local + CI | 18/18 pass |
| firefox-desktop | CI | pass |
| webkit-desktop | CI | pass |
| webkit-mobile | CI | pass |

Firefox and WebKit binaries could not be installed locally: `playwright install
--with-deps` needs root for system libraries and this environment has no
non-interactive sudo. Those three projects are verified in CI only, where the
`e2e` job installs all browsers and runs the complete matrix.

CI settings in force: `forbidOnly` when `CI=true`, deterministic single worker,
HTML report retained, traces and screenshots retained on failure.

## CI aggregate status

Workflow: `.github/workflows/ci.yml`. Jobs: toolchain policy, Biome, ShellCheck
and shfmt, strict TypeScript, unit/property/coverage, database integration and
migrations, API and workspace contract, Playwright, production builds — all
aggregated into one `quality-gate` status that fails when any required job
fails, is cancelled, is skipped, or is missing.

Last fully green run before this record: run `31328696151` on `main`, 10/10 jobs
passing including `quality-gate`.

## Protected-main ruleset — NOT ENFORCED

`.github/rulesets/main.json` defines the intended protection: a required
`quality-gate` status, a required pull request, and blocked deletion and
non-fast-forward pushes.

**That definition is not active on the repository.** Verified:

```console
$ gh api repos/enzofrnt/MyOwnNotion/rulesets
[]
```

Consequences, stated plainly:

- `main` currently accepts direct pushes, including force pushes. Several were
  made during this session.
- Constitution VII ("Protected branches MUST reject pull-request merges while
  any required quality check fails or is missing") is **not satisfied** by the
  repository's live configuration, even though the CI half of it is.
- plan.md's claim that "the `main` ruleset requires this check and a pull
  request" describes the committed definition, not the active setting.

The file is a definition only; it must be imported into the repository's
rulesets to take effect. This requires repository-admin rights and changes how
everyone pushes to `main`, so it was deliberately left to the owner rather than
applied unilaterally. It is tracked as a convergence task.

## Quickstart validation (T093)

Every command in [quickstart.md](./quickstart.md) was run. All 15 referenced
`package.json` scripts exist.

| Command | Result |
| --- | --- |
| `pnpm toolchain:check` | pass |
| `pnpm format:check` | pass |
| `pnpm lint` | pass |
| `pnpm shell:check` | pass |
| `pnpm typecheck` | pass |
| `pnpm build` | pass |
| `pnpm test:unit` | pass |
| `pnpm test:property` | pass |
| `pnpm test:integration` | pass |
| `pnpm test:contract` | pass |
| `pnpm test:coverage` | pass |
| `pnpm test:e2e` | pass (2 projects locally, 5 in CI) |
| `pnpm db:migrate` | pass — applied `0001_content_foundations` |
| `pnpm db:test-migrations` | pass |
| `docker compose up -d --wait postgres` | pass — reports healthy |
| `docker compose config` | valid; port `host_ip: 127.0.0.1`, volume at `/var/lib/postgresql` |

The quickstart's manual journeys map to automated suites that were executed:
hierarchy → `tests/e2e/hierarchy.spec.ts`, file identity and placements →
`files.spec.ts` plus `packages/database/tests/file-placements.integration.spec.ts`,
revision lineage → `revision-restore.spec.ts` plus
`revision-retention.integration.spec.ts`, offline and reconnection →
`offline-reconciliation.spec.ts`, trash and backup representation →
`tests/contract/export.spec.ts`.

## Defects found and fixed during validation

Running the gates rather than assuming they passed surfaced four real defects:

1. **UUIDv7 variant bits were never set.** `bytes[8] as number & 0x3f` parses in
   TypeScript as a *type assertion* to `number & 0x3f`, so the mask was dropped
   at runtime and roughly half of all generated identities carried an invalid
   RFC 9562 variant nibble (`c`–`f`). `isUuid` does not check the variant, so
   nothing caught it. Fixed in `packages/domain/src/ids/uuid.ts`; the test now
   samples 200 values, because a single sample missed it half the time.
2. **PostgreSQL 18 could not start.** The volume was mounted at
   `/var/lib/postgresql/data`; `postgres:18` places data in a major-version
   subdirectory and refuses that inner mount, failing the Playwright job with
   "container is unhealthy". Fixed in `compose.yaml`.
3. **A quota failure was displayed as "offline".** The quota banner reused
   `data-state="offline"`, and a failed local save left the sync state
   untouched — implying the change was durable when nothing had been saved.
   `quota-failure` is now a distinct state (FR-043).
4. **Rejections were shown as conflicts.** Deterministically rejected mutations
   were captured into the same list as competing-revision conflicts, and
   recovered retries were indistinguishable from fresh pending work.
   `mutation-status.tsx` now derives `pending`, `sending`, `retrying`,
   `conflict`, and `rejected` from the stored rows.

## Deviations

| Item | Status | Reason |
| --- | --- | --- |
| Protected-main ruleset | **not enforced** | Definition committed but not imported; needs owner action (see above) |
| firefox-desktop, webkit-desktop, webkit-mobile locally | verified in CI only | `playwright install --with-deps` needs root; unavailable here |
| `apps/api/src/server.ts` coverage | excluded | Recorded exception in plan.md |
| `apps/web/**` coverage | excluded | Covered by Playwright journeys, not measurable under V8/node |
| `.specify/scripts/bash/*` shell findings | non-blocking | Vendored upstream Spec Kit scripts; checked but not ours to rewrite |
