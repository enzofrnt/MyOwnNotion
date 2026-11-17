# Validation: Settings visual refresh

**Date**: 2026-11-17 · **Working tree**: on top of the uncommitted 058/059 batch (not committed).

## Checks run (impact: user-visible interaction, web only)

| Check | Result |
|---|---|
| `tsc --noEmit` (apps/web) | pass |
| `biome check` on touched files | pass (warnings only; two pre-existing format errors in 058 files `security-settings.tsx`, `settings-security.css` left untouched at the time) |
| `vitest --project web` (whole project) | 182 files / 1167 tests pass |
| Playwright `chromium-desktop` + `chromium-mobile`: `mcp-access`, `accounts`, `authentication`, `bootstrap`, `workspace-settings-boundary` | 32/32 pass per project (`bun scripts/e2e/run-local-matrix.ts`) |
| Firefox / WebKit projects | **not run** (containerised on macOS; to run before push via `checks:local`) |
| `bun run checks:local` | **not run** |

## Visual evidence (`evidence/`)

Compte, Administration, Sécurité, Corbeille, Sauvegardes (1440 px light; several also dark and
390 px), MCP list / grant modal / code modal (light, dark), identity modal before/after error,
sign-in error, shell at 390 px. Measured: no horizontal overflow; 0 px layout shift between the
identity modal without and with an error (dialog top and submit button unchanged) and on sign-in
(card height 584 px both).

## Not verified

Stockage et synchronisation and Page actuelle (need the local database); sign-up/setup error
states; Firefox/WebKit; `checks:local`.

## Lot (files owned by this feature)

New: `specs/061-settings-visual-refresh/**`, `apps/web/src/features/settings/settings-card.{tsx,css}`,
`apps/web/src/ui/primitives/form-message.tsx`, `apps/web/src/ui/ui-lab-settings.tsx`.

Modified only by 061: `.agents/skills/ui-quality/lessons.md`, `apps/web/src/global.css`,
`features/settings/{settings.css,workspace-management-settings.tsx,workspace-navigation-settings.tsx}`,
`features/security/{desktop-diagnostics.tsx,mcp-access-panel.css}`,
`features/connection/connection-status.tsx`,
`ui/primitives/{field.tsx,index.ts,primitives.css}`, `ui/ui-lab.tsx`,
`tests/e2e/mcp-access.spec.ts`.

**Mixed with 058/059 in the same files** (cannot be split by file; needs hunk-level staging or
one combined commit): `features/security/{mcp-access-panel.tsx,security-settings.tsx}`,
`features/settings/{settings-shell.tsx,settings-security.css,account-settings.tsx,administration-settings.tsx}`,
`features/auth/{login-page,bootstrap-page,signup-page,password-field}.tsx`, `main.tsx`,
`ui/copy/fr.ts`, `tests/mcp-access-panel.spec.tsx`, `docs/design/ui-system.md`.
(`ui/primitives/confirm-dialog.tsx` is a 059 change, not part of this lot.)

## Full local gate (`bun run checks:local`, 2026-11-17)

Environment: `PATH="/opt/homebrew/opt/libpq/bin:$PATH"` (PG18 `pg_dump`, as
`docs/development.md` prescribes), `.tools/bin` for the pinned `shfmt` 3.12.0, and
`MYOWNNOTION_DB_PORT=5499` so the gate PostgreSQL does not collide with the development
stack on 5432.

- Passed: toolchain, shell, format, lint, typecheck, coverage (1901 tests), performance,
  integration, migrations, contract.
- First e2e pass: 2/5 projects. Only visual baselines and two database journeys failed:
  - settings shell references (light, dark) — expected, the surface was redesigned.
    Regenerated for darwin and, inside the pinned Playwright Linux runtime, for linux:
    `evidence/shell-reference-{expected,actual}-light.png`.
  - `v1-security-dark-mobile` darwin baseline — regenerated (linux baseline unchanged).
  - `databases-views` (chromium) and `database-relations-rollups` (webkit) — autosave and
    capture races in database surfaces untouched by this feature; both pass when rerun
    alone. Recorded as pre-existing flakiness, not fixed here.
- Impact policy: `tests/e2e/knowledge-graph-live.spec.ts` (062) was undeclared in
  `ci/test-impact.json`; the entry was added and the contract test passes (45 tests).
