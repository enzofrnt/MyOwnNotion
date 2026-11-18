# Implementation Plan: Auth shell for sign-in and account creation

**Branch**: `059-auth-shell-ui` (working on top of the uncommitted 058 batch) ·
**Date**: 2026-11-17 · **Spec**: `specs/059-auth-shell-ui/spec.md`

## Summary

One shared shell (`AuthShell`) wraps the four account surfaces in a centred, elevated card on
the canvas; a shared `PasswordField` adds a reveal control everywhere and a strength meter where
a password is being created. `Field` gains a trailing-control slot. Behaviour, API and test ids
are untouched.

## Technical context

- Web app: React 19 + TypeScript, Vite (`apps/web`), plain CSS modules per owner file, custom
  design tokens in `apps/web/src/ui/tokens.css`.
- Auth surfaces: `apps/web/src/features/auth/{bootstrap,login,signup}-page.tsx`, CSS owner
  `apps/web/src/features/auth/auth.css`, mounted by `apps/web/src/app.tsx` inside
  `.app-shell`.
- Primitives: `Field` (`ui/primitives/field.tsx`), `Button`, `AsyncState`, `AppIcon`
  (icons include `Afficher` / `Masquer`), copy in `ui/copy/fr.ts`.
- Contract rule: `NewPasswordSchema` = `min(12)`, `max(1024)` (`packages/contracts/src/security-api.ts`).
- No new dependency. No API, route or storage change.

## Constitution check

| Gate | Result |
|---|---|
| Spec-driven | PASS — this spec + plan + tasks; validation evidence |
| Cross-platform | PASS — web-only surface; native/desktop untouched and declared out of scope |
| Boundaries | PASS — UI stays in `apps/web`; no contract/API change |
| Data | N/A — no model, migration or query |
| Security | PASS — password still leaves the page only through the existing request; reveal is a local input type, strength is client-side only |
| Evidence | PASS — web tests + screenshots at 4 widths × 2 themes |
| Deployment | PASS — no env var, no manual deploy |

## UX decisions (ui-quality applied)

1. **One card, one boundary.** `.ui-auth-shell` fills the viewport (`min-height: 100dvh`) and
   centres a `.ui-auth-shell__card` (surface, `--ui-color-border`, `--ui-radius-lg`,
   `--ui-shadow-card-raised`, `padding: var(--ui-space-6)`, max-width 28 rem). The canvas keeps
   a faint accent wash so the card reads as raised, not drawn.
2. **Reverse the 058 flattening deliberately.** `auth.css` currently zeroes `.ui-auth-card`
   (transparent, no border) for the auth surface; the shell replaces that rule. The auth
   section of `docs/design/ui-system.md` is updated in the same change (single owner: `auth.css`).
3. **Wordmark in type.** No logo asset exists; the card opens with a small `MyOwnNotion`
   wordmark (uppercase, tracked, muted) above the `h1`. Tokens only.
4. **Password field.** `PasswordField` = `Field` + trailing reveal button
   (`AppIcon "Afficher"/"Masquer"`, `aria-pressed`, `aria-label`), optional strength block.
   The trailing slot is a new optional `Field` prop (`.ui-field__control-row`), so other
   surfaces can reuse it without a local recipe.
5. **Strength, honestly.** `assessPassword()` returns `empty | weak | fair | good | strong`
   from length (< 12 weak) plus variety/length bonuses; only the 12-character rule is stated as
   required. Meter is `role="meter"` with `aria-valuetext`; the level is also written as text.
6. **Hierarchy.** Login keeps passkey-first (spec 002). The method switch is a ghost action for
   the primary switch and a quiet link for returning to sign-in; no second cobalt button.
7. **States.** `AsyncState` stays the error surface but is mounted inside the card body, above
   the fields, so the card geometry does not jump; the busy primary keeps its size (`Button`
   already does).
8. **Reveal and strength are components, not pages**: pages pass `showStrength` only when
   creating a password (setup, sign-up/join).

## Changes

1. `apps/web/src/features/auth/auth-shell.tsx` — new `AuthShell`.
2. `apps/web/src/features/auth/password-field.tsx` + `password-strength.ts` — new field and
   heuristic.
3. `apps/web/src/ui/primitives/field.tsx` — optional `trailing` slot and `inputClassName`-safe
   wrapper; `primitives.css` gains `.ui-field__control-row` and `.ui-password-toggle`.
4. `apps/web/src/features/auth/auth.css` — shell, card, wordmark, strength, separator; removes the
   058 flattening override.
5. `apps/web/src/features/auth/{bootstrap,login,signup}-page.tsx` — render inside `AuthShell`,
   use `PasswordField`.
6. `apps/web/src/app.tsx` — auth branches use `app-shell app-shell--auth`.
7. `apps/web/src/ui/copy/fr.ts` — password copy (reveal names, levels, minimum, lead lines).
8. `apps/web/src/ui/ui-lab-auth.tsx` + `ui-lab.tsx` — sign-up / join preview entry.
9. `docs/design/ui-system.md` — auth section rewrite (card shell, password field, strength).

## Verification Plan

```sh
bun run lint
bun run typecheck
bunx vitest run apps/web   # or the repo's documented web suite
```

- Screenshots: `/setup`, `/login`, `/signup`, `/join` at 1440 / 768 / 390 px, light + dark.
- States: password short/long, reveal on/off, busy, refused sign-in, invitation refused.
- Keyboard: reveal button reachable, `aria-pressed` toggles, focus stays on the control.
- Widths: 320 px no horizontal scroll.
- Evidence recorded in `specs/059-auth-shell-ui/validation.md` + `evidence/`.

## Risks

- Same-workspace change on top of the uncommitted 058 batch: the diff mixes both features, which
  is intentional until 058 is committed; the browser chain must be run on the whole tree.
- Using an `<input type="text">` while revealed can make some password managers offer saving:
  reveal resets on every state change and `autocomplete` is unchanged.
