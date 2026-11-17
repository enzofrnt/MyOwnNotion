# Validation: Multi-user accounts (058)

Run locally on macOS (Apple Silicon), 2026-11-17. PostgreSQL 18 client tools
from Homebrew libpq on `PATH`, as `docs/development.md` requires for backup
gates.

## Check selection

Cross-cutting change (schema baseline, API composition, every route's
workspace, web shell): the complete relevant gate was selected
(`bun run checks:local` components), run step by step to record each result.

| Check | Result |
|---|---|
| `toolchain:check` | pass |
| `format:check` | pass |
| `lint:ci` | pass (0 errors; 157 pre-existing warnings, unchanged) |
| `typecheck` | pass |
| `shell:check` | **not passing on this host**: pinned `shfmt` 3.12.0, host has 3.14.1. No shell script changed in this feature. To be run in CI / with the pinned binary. |
| Unit projects (`test:unit`) | 385 files, 3 801 tests pass (+ web additions below) |
| Web project | 179+ files pass, including `accounts-ui.spec.tsx` and `local-account-store.spec.ts` |
| `database-integration` | 44 files, 407 tests pass (incl. `accounts.integration.spec.ts`: concurrent first launch, last invitation use, deletion isolation) |
| `api-contract` | 138 files pass (incl. `bootstrap`, `accounts`, `account-isolation` suites) |
| Playwright matrix (5 projects) | see below |

## Isolation (SC-003)

`apps/api/tests/account-isolation.contract.spec.ts` enumerates the app's route
table and, for every `/v1` route with a parameter, compares account B's answer
for account A's identifier with its answer for a random identifier (status and
normalized body). First run found real cross-account access by id (items,
trash/restore, placements, revisions, creating under A's folder); fixed by the
workspace fence (research D14). Final: 0 leaks, 0 existence differences. MCP:
B's assistant cannot read, list or find A's notes; A's can.

## Playwright

Full matrix run, then targeted reruns after fixing the e2e fixtures
(`reset-installation.ts` no longer truncates `owners`/`invitations`, which
cascaded to `installations`; local-database inspection helpers follow the
per-account database name).

- New journeys: `tests/e2e/bootstrap.spec.ts` (first launch, passkey at first
  launch then passkey-only sign-in, email/password sign-in, no setup once
  initialized) and `tests/e2e/accounts.spec.ts` (administrator-created
  member, invitation link with counts and revocation, open sign-up, disabled
  account) — pass on Chromium desktop and mobile.
- SC-001 (first launch < 2 min) and SC-002 (invited sign-up < 1 min) are
  asserted in those journeys; observed ≈ 1–5 s.
- Visual references refreshed: `settings-shell-*` (two new settings sections),
  the macOS references of `workspace-shell-*` and `v1-search/database` (they
  predated the 2026-11-12 chrome redesign on `main`), and
  `v1-security-dark-chromium-mobile` (new "Ajouter une passkey" action).
- Known non-feature failures observed on this host: WebKit
  `databases-offline-sync` / `databases-security` hit the patched WebKit
  "WebLoaderStrategy … This is a WebKit bug" internal error noted in
  `tests/e2e/projects.ts`.

### Results

| Run | Result |
|---|---|
| Full matrix, first pass | chromium-desktop 314 ✓ / 16 ✗, firefox 311 ✓ / 9 ✗, webkit-desktop 107 ✓ / 2 ✗, chromium-mobile 309 ✓ / 9 ✗, webkit-mobile 107 ✓ / 2 ✗ |
| Causes | e2e reset cascading to `installations` (fixed); recovery fixture reading the removed `installations.workspace_id` (fixed); local-DB inspection helpers using the pre-058 name (fixed); stale/changed visual references (refreshed); WebKit internal error (environment) |
| Targeted rerun, chromium-desktop + chromium-mobile (13 files incl. every previously failing one) | 48 ✓ + 43 ✓, 0 ✗ |
| Linux references (Chromium in the pinned container) | 2/2 projects ✓ after refresh |
| WebKit desktop + mobile rerun (offline sync, security, accounts, bootstrap) | ✓; one flaky "disabled account" traced to an unretried serialization conflict — fixed (account transactions now retry, bounded) |
| `accounts.spec.ts` × 3 repeats, no retries, chromium-desktop + webkit-desktop | 12 ✓ + 12 ✓ |
| Firefox desktop rerun (security-recovery, accounts, bootstrap) | 21 ✓, 0 ✗ |
| Final unit + integration + contract run | all pass after declaring `tests/e2e/accounts.spec.ts` in `ci/test-impact.json`; one web test (`database-page-interaction`, property icon) failed once and passed on rerun — unrelated flake |

### Other gates

| Check | Result |
|---|---|
| `db:test-migrations` | pass |
| `test:performance` | pass |
| `build` | pass |
| `images:build` | pass |
| `security:audit`, `security:licenses`, `compose:check` | pass |
| `security:secrets`, `security:static` | pass (after the file deletions were staged; they read the git index) |
| `desktop:check` | **not runnable in this sandbox**: Electron fails to launch (`Process failed to launch`, EPERM on kill). No desktop code changed; must run on a normal session or CI. |
| `shell:check` | host `shfmt` 3.14.1 ≠ pinned 3.12.0; no shell script changed. |


## Visual review (ui-quality)

Evidence in `evidence/` (desktop 1280 px and Pixel 7 widths): setup, login
with open registration, join (form and refused link), administration users,
invitation created (link shown once, copy action), invitations used, member
account. Reviewed: single-column forms with full-width fields and left primary
action, consistent with the sign-in page; administration rows wrap their
actions at phone width without horizontal scroll; destructive actions use the
neutral-then-red danger variant (L-021); the new link is selectable and never
truncated. Defect found and fixed during review: the sign-up form remounted
after navigating from the sign-in page and lost the typed email.
