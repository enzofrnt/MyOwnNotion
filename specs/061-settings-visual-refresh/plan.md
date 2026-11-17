# Implementation Plan: Settings visual refresh

**Branch**: `061-settings-visual-refresh` (worked on top of the uncommitted 058/059 batch, like 059)
· **Date**: 2026-11-17 · **Spec**: [spec.md](spec.md)

**Canvas sections**: settings are a destination of their own (product canvas), not part of the
document surface; no change to permanent boundaries. **UI skill**: `ui-quality` +
`lessons.md` (L-064 … L-067) loaded and applied.

## Summary

One card system for every settings tab, validated on the Compte pilot and then extended:
cards (border, 12 px radius, no shadow, no tint), a grouped and darker sidebar with an accent
bar, status pills, and sub-section hairlines. Long forms leave the card: the MCP card shows its
list first and authorises through modals. Form feedback uses a reserved line plus red fields so
errors never shift the layout (also fixing sign-in, sign-up and setup).

## Technical context

- Web only (`apps/web`); no API, contract, storage or permission change.
- CSS owners: `features/settings/settings.css` (shell, nav), `settings-card.css` (card, row,
  pill, panel chrome, sub-sections), `settings-security.css` (Security document rules; its
  flattening override was removed), `features/security/mcp-access-panel.css`,
  `ui/primitives/primitives.css` (`FormMessage`, invalid field).
- Components: `settings-card.tsx` (`SettingsCard`, `SettingsRow`, `SettingsPill`),
  `ui/primitives/form-message.tsx`, `Field invalid`, `PasswordField invalid`.
- Existing `.ui-settings-panel` / `.panel` become cards through CSS; bare sections gain the
  `ui-settings-panel` class.

## UX states (ui-quality gate)

| Surface | Empty | Error | Loading | Success |
|---|---|---|---|---|
| Compte | n/a | inline note (email taken, re-auth) | busy Save | "Compte mis à jour" |
| MCP list | "Aucun accès MCP pour l’instant" | load error + refresh | skeleton | pills per state |
| MCP grant modal | draft kept | validation note in modal | busy submit | code modal |
| MCP code modal | n/a | copy refused (reserved line) | n/a | "Code copié." |
| Identity modal | n/a | red field + reserved line, 0 px shift | busy | closes, form reopens |
| Sign-in / sign-up / setup | n/a | `FormMessage` + `invalid` | busy button | proceeds |

## Decisions

- Cards over flat sections (owner validated "beaucoup mieux", then asked for a lighter dose).
- Identity confirmation resumes the interrupted action by itself (owner request 2026-11-17: no second click on "Générer le code"); the former explicit re-launch is superseded.
- A one-use code is shown masked (first 4 characters); the full value only reaches the clipboard.
- Product name in the UI is "MCP" ("Serveur MCP").

## Risks

- `Stockage et synchronisation` and `Page actuelle` rely on the local database and were not
  captured; they inherit card chrome only.
- Sign-up and setup error states share the component but were not captured.
