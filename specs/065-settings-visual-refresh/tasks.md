# Tasks: Settings visual refresh

**Spec**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Evidence**: [validation.md](validation.md)

## Phase 1 — Pilot (Compte)

- [x] T001 `settings-card.{tsx,css}`: `SettingsCard`, `SettingsRow`, `SettingsPill`.
- [x] T002 Rebuild `account-settings.tsx` on the cards; add copy to `fr.ts`.
- [x] T003 `/__ui-lab?surface=settings-*` previews (`ui-lab-settings.tsx`).
- [x] T004 Owner review: first dose "too much" → remove tinted header, shadow, avatar, blue
      accents; owner validated. Lesson `L-064` validated.

## Phase 2 — Other tabs

- [x] T005 Remove both flattening overrides; card chrome on every `.ui-settings-panel`/`.panel`
      (`settings-card.css`); group titles darker.
- [x] T006 Bare sections get `ui-settings-panel` (Corbeille, Page actuelle, Barre latérale,
      connexion, diagnostics bureau).
- [x] T007 Backups: sub-sections separated, portable exports as a collapsed card.
- [x] T008 Shell: darker sidebar, grouped nav (Personnel · Installation · Données), accent bar.
- [ ] T009 Capture Stockage et synchronisation and Page actuelle (needs local DB fixtures).

## Phase 3 — MCP

- [x] T010 Rename to "Serveur MCP" (card, group, table of contents).
- [x] T011 List first: row, pill, one-line summary, actions on the right.
- [x] T012 Grant form in a modal (two-column permissions, sticky footer).
- [x] T013 One-use code in a modal: masked, copy primary, instructions folded.
- [x] T014 Identity confirmation in a modal styled like sign-in; reopens the form, draft kept.
- [x] T015 Update `mcp-access-panel.spec.tsx` and `tests/e2e/mcp-access.spec.ts`.

## Phase 4 — Errors without layout shift

- [x] T016 `FormMessage` + `Field invalid` + `PasswordField invalid`.
- [x] T017 Apply to the identity modal, sign-in, sign-up and setup; measure 0 px shift
      (modal, sign-in).
- [ ] T018 Capture sign-up and setup error states.

## Phase 5 — Validation and capture of lessons

- [x] T019 Lessons `L-064`…`L-067` written (L-064 validated; others candidate until owner OK).
- [x] T020 Unit: `tsc`, `biome` on touched files, full `web` Vitest project.
- [x] T021 Playwright journeys (chromium desktop + mobile): 32/32 each, see `validation.md`.
- [ ] T022 Owner review of Round 3 (MCP modals, error states, sidebar); promote or drop
      `L-065`…`L-067`.
- [x] T023 Update `docs/design/ui-system.md` (owners, `FormMessage`, `SettingsCard`).
