# Feature Specification: Settings visual refresh

**Feature Branch**: `065-settings-visual-refresh`

**Created**: 2026-11-17

**Status**: In progress — pilot tab (Compte) implemented, awaiting owner review before other tabs

**Input**: Owner request: all settings tabs "have no soul": no contrast, parts are hard to
recognise and badly separated, many elements are poorly organised and not visible enough.
Make them cleaner, more readable, more pleasant, with more contrast. Capitalise lessons from
what the owner validates or rejects. Propose before implementing.

## Problem

`apps/web/src/features/settings/settings.css` deliberately flattens every panel
(`.settings-content .ui-settings-panel, .panel { background: transparent; border: 0;
padding: 0 }`). Every section of every tab is therefore a title and loose text on the canvas:
no visible boundary between groups, hairline separators at 45–55 % opacity, one-weight
headings, controls with the same visual weight as prose. The sidebar (`--ui-color-sidebar`
#f2f0ec) and the canvas (#fbfaf8) are nearly the same tone.

## UX brief

- **User job**: find a setting, understand its current state, change it with confidence.
- **Primary action**: per group, one clear action (or none for read-only groups).
- **Key friction today**: groups are not recognisable; status (OK / attention / danger) is
  not visible at a glance; destructive actions are not set apart.
- **Scope**: the seven tabs (Compte, Administration, Sécurité et appareils, Sauvegardes,
  Stockage et synchronisation, Corbeille, Page actuelle), the settings shell, and their CSS
  owners (`settings.css`, `settings-security.css`, `mcp-access-panel.css`).
- **Non-goals**: behaviour, API, copy meaning, permissions, the workspace UI.

## Proposal (to validate with the owner)

1. **Grouped cards.** Each section becomes a card: `--ui-color-surface` on the canvas, 1 px
   `--ui-color-border`, radius 12 px, 20–24 px padding, 24–32 px between cards. This is the
   main source of separation and contrast.
2. **Card anatomy.** Header = icon chip + title (600) + one-line help in muted text; body =
   rows; footer/side = actions. Same anatomy in every tab.
3. **Setting rows.** Label + help on the left, control/value on the right, hairline between
   rows inside a card (stronger than today's 45 %). Stacks on narrow widths.
4. **Status at a glance.** Semantic pills (success / warning / danger / neutral) built from
   existing `--ui-color-*-soft` tokens, always with text, never colour alone.
5. **Danger zone.** Destructive actions (sign out everywhere, revoke, delete, restore) grouped
   at the bottom of their tab in a card with a danger-tinted border and neutral-then-red
   buttons (`L-021`).
6. **Shell.** Sidebar one step darker than the canvas, active item with a 3 px accent bar plus
   `--ui-color-surface` fill (visible in both themes), nav grouped under small labels
   (Personnel · Espace · Données), tab header gets the section icon and a stronger rule.
7. **Contrast.** Section help text moves from `text-subtle` to `text-muted`; borders move up
   one step; verify WCAG AA for text and non-text UI in light and dark.
8. **Lessons loop.** After each validation round, record the accepted/rejected rule as an
   `L-NNN` entry in `.agents/skills/ui-quality/lessons.md` (candidate until validated).

## Delivery plan

1. Owner validates or amends the proposal above.
2. `plan.md` + `tasks.md` (ui-quality gates, `notion-parity` not applicable: no Notion reference).
3. Shared primitives first (card, setting row, status pill, danger zone) with `/__ui-lab`
   previews, then **Compte** as the pilot tab → owner review → remaining tabs.
4. Browser captures (light/dark, 320 px and desktop) per tab as evidence in `validation.md`.

## Open questions

- Cards (proposed) vs. flat sections with stronger rules?
- Keep the one-line hints under each sidebar item, or drop them to calm the sidebar?
- Accent colour usage: only on the active nav bar, or also on primary buttons/pills?

## Progress

- **Pilot — Compte (2026-11-17)**: `settings-card.{tsx,css}` primitives (card, row, pill),
  `account-settings.tsx` rebuilt on them (Profil card with avatar, role pill, two-column
  fields, primary save; Session card with sign-out row), preview at
  `/__ui-lab?surface=settings-account`. Evidence: `evidence/account-{1440,390}-{light,dark}.png`
  (no horizontal overflow). Behaviour and test ids unchanged. Lesson `L-064` recorded as
  *candidate*.
- Shell (darker sidebar, accent bar, nav groups) deliberately **not** changed yet: it is shared
  by all tabs and waits for the pilot verdict.
- `plan.md` / `tasks.md` still to write once the pilot direction is validated.
- **Pilot validated (2026-11-17)**: owner found the first dosage "too much"; toned down
  (no tinted band, no shadow, no avatar, grey chip) then approved. `L-064` is now validated.
- **Other tabs (2026-11-17)**: the card chrome is applied to every `.ui-settings-panel` /
  `.panel` under `.settings-content` (single owner: `settings-card.css`; the two flattening
  overrides in `settings.css` and `settings-security.css` were removed). Bare sections
  (Corbeille, Page actuelle, Barre latérale, connexion, diagnostics bureau) now carry
  `ui-settings-panel`. Group eyebrows (Connexion, Sessions…) are darker. Evidence:
  `evidence/{administration,security,trash}-*.png`. Panel-level icons/pills are not added.
- **Not yet verified / open**: Sauvegardes, Stockage et synchronisation, Page actuelle were not
  captured (they need data the lab does not stub); the "Accès des assistants" card is still one
  long undivided form (needs inner separators); the shell (sidebar tone, accent bar, groups)
  is unchanged; `plan.md`/`tasks.md` not written; full `checks:local` and e2e not run.
- **MCP + shell (2026-11-17)**: "Accès des assistants" → group "MCP", card "Serveur MCP",
  sommaire "MCP". The identity confirmation is now a modal (passkey primary, "ou", shared
  `PasswordField`, same look as sign-in); form input is kept and the action is relaunched
  explicitly (existing tested behaviour kept). MCP card split into stages by hairlines.
  Shell: sidebar one step darker, nav grouped (Personnel · Installation · Données), active
  item = surface fill + 3 px accent bar. Evidence: `evidence/mcp-*.png`, `shell-390.png`.
  Lesson `L-065` candidate. Updated e2e `mcp-access.spec.ts` (heading, Escape on modal) —
  **not run**.
- **Round 3 (2026-11-17)**: MCP card = list first (status pills, one summary line, actions
  right); creation in a modal with a sticky footer; the one-use code opens in its own modal,
  masked (first 4 chars), "Copier le code" primary, instructions folded; identity
  confirmation modal reopens the form with the draft. Form feedback no longer shifts layout:
  `FormMessage` (reserved 2-line slot) + `Field invalid`, applied to the modal, sign-in,
  sign-up and setup — measured 0 px shift on modal and sign-in. Backups: sub-sections
  separated, portable exports collapsed in a card. Unit: full web project 182 files / 1167
  tests green. `tests/e2e/mcp-access.spec.ts` rewritten for the modals (code read from the
  API response since it is never displayed) — **not run**. Lessons `L-066`, `L-067` candidate.
- **Still unverified visually**: Stockage et synchronisation and Page actuelle (need the
  local database), sign-up/setup error states (same component, not captured).
- **Auto-resume (2026-11-17)**: after the identity modal succeeds, the interrupted grant or revoke resumes automatically (code modal opens straight away). Supersedes the explicit re-launch noted above.
- **Round 4 (2026-11-17)**: shared `ReauthDialog` (MCP, add/remove passkey): adding a passkey on a stale session asks for the password in a modal and resumes enrollment; specific errors (wrong password, rate limit, server); passkey offered only when the account has one. Security section feedback became a fixed toast (success auto-dismissed after 6 s); Compte feedback moved to a reserved `FormMessage`. Lesson `L-068` (no layout shift from messages) validated and promoted to `SKILL.md`.
