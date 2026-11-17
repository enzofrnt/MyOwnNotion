# Validation — Auth shell for sign-in and account creation (059)

Date: 2026-11-17 · Branch `058-multi-user-accounts` (the 059 work sits on the uncommitted
058 batch) · Base: `main` working tree.

## Context and limits

- The change is **web-only** (React + CSS). No API, contract, database, native or env change.
- The dev stack (`myownnotion-dev`, built from this working tree) served all visual captures:
  `https://localhost:8443`.
- Feature 058 is still uncommitted, so 058 and 059 share one working tree and one review diff.
- The Playwright matrix was **not** re-run for this UI pass (see "Not verified" below); the web
  and unit suites plus real-browser captures stand in for it.

## Gates

| Command | Result |
|---|---|
| `bun run typecheck` | `@myownnotion/web:typecheck` exit 0 (whole workspace, after the final edits) |
| `bun run lint` | exit 0 — **0 errors**, 157 warnings, all pre-existing in untouched files |
| `bun run test:unit` | 3809 passed, 2 skipped, **1 failure** in `apps/web/tests/database-page-interaction.spec.tsx` (icon-picker choice not found). Re-ran that spec alone **3× → 18/18 passed** each time; unrelated to this feature (database schema panel) |
| `npx vitest run apps/web/tests/password-strength.spec.ts` | 5 passed (new: empty, minimum rule, repetition guard, long passphrase, 0–100 bounds) |
| `npx vitest run accounts-ui password-strength ui-lab-auth french-copy app-routing` | 36 passed, including the new "requires the same password twice" journey |
| `npx vitest run accounts-ui app-routing v1-surface-consistency french-copy` | 36 passed (auth markup, routing gate, French copy) |

## Visual evidence (`evidence/`)

24 captures — `setup`, `login`, `signup`, `join` × 1440 / 768 / 390 px × light / dark — plus
`setup-password-short.png`, `setup-password-revealed.png`, `setup-password-strong.png`,
`setup-320-light.png`, `login-password-{1440,390}-{light,dark}.png` and the raw
`verification-data.json`.

Measured for every capture:

| Check | Result |
|---|---|
| Card width | 448 px at 768/1440 (28 rem), 358 px at 390, 288 px at 320 |
| Card inset at 320 px | 16 px on each side |
| Horizontal overflow | `scrollWidth === clientWidth` on all 24 captures (1440, 768, 390) and at 320 |
| `h1` count | exactly 1 per surface |
| Controls outside the card | **0** on the real `/setup` route (lab chrome excluded) |
| Console errors | none on all 24 captures |
| Card vertical rhythm | `min-height: 100dvh` on the shell; page height equals the viewport at 1440 (900 px) |

Contrast (computed from the rendered colours):

| Element | Light | Dark |
|---|---|---|
| Wordmark | 4.77:1 | 6.72:1 |
| Title | 15.3:1 | 14.18:1 |
| Lead | 6.06:1 | 8.41:1 |
| Field label | 15.3:1 | 14.18:1 |
| Field description | 6.06:1 | 8.41:1 |

## Owner review of 2026-11-17 (four page annotations)

| Annotation | Change |
|---|---|
| 1 — e-mail description "inutile" | `Field` for e-mail has no `description` any more on setup and sign-up |
| 2 — password description "inutile" | same: no `description` under the password field (the copy key was removed) |
| 3 — advice sentence "inutile" | the strength block no longer renders `Plus la phrase est longue…` |
| 4 — "plus de détail ? 14 caractères + + ?? met plus d'info. Je veux un champ de confirmation du mdp." | the strength block now lists four criteria (12 required, 14 comfort, several words, mixed characters) and a **confirmation field** was added to setup and sign-up |

Confirmation behaviour (measured on `/setup`, `admin@example.test` + `Admin`):
a mismatched confirmation gives `aria-invalid="true"` on the field, `aria-describedby`
pointing at the `role="alert"` message "Les mots de passe ne correspondent pas.", and the
submit stays disabled. `evidence/setup-password-mismatch.png`. The request still carries a
single `password` (server contract unchanged).

While wiring the guard, the memoized submit handler kept a stale `passwordConfirm` from its
dependency list; the new web test caught it (`api.bootstrap` never called) and the dependency
arrays of both pages were fixed before the captures above.

## Parity pass with the reference password creation (2026-11-17)

The reference surface (Giftlist) creates a password with a five-rule checklist, a four-step
level label and an "x/5 règles" counter. MyOwnNotion now renders that same block:

| Element | Measurement (Chromium, dev stack) |
|---|---|
| Meter | `<meter min=0 max=5 value=passed>` with `aria-label="Robustesse : Fort, 4/5 règles"` |
| Level label | "Robustesse : Très faible / Faible / Moyen / Fort / Très fort" |
| Counter | "1/5 règles" (weak), "4/5 règles" (long passphrase without uppercase), "5/5" (full) |
| Criteria | 12 caractères (requis), minuscule, majuscule, chiffre, caractère spécial — green dot when met |
| Gating | only the contract minimum (12) + the confirmation block submission |

Deviation from the reference, deliberate and recorded in the spec: Giftlist requires 8 characters
**plus** the four composition rules; MyOwnNotion's contract enforces a 12-character minimum and
the repository's passphrase fixture ("correct horse battery staple") is the accepted password in
API tests. The composition criteria are therefore shown as guidance, and the 12-character rule is
the only one marked `requis`.

The same block is now used by every password-creation surface, including the two administration
dialogs and Réglages › Sécurité (captured after creating a throwaway administrator in the dev
database, then removing it):

| Surface | Evidence | Measured |
|---|---|---|
| Réglages › Sécurité | `settings-security-password.png` | fields stacked (480 px column), confirm mismatch shown, "Enregistrer" disabled, "4/5 règles" |
| Administration › Nouveau compte | `settings-administration-create-account.png` | meter "Robustesse : Fort, 4/5 règles", mismatch inline, "Créer" disabled, **no duplicate DOM id** |
| Setup / inscription | `setup-password-strong.png`, `setup-password-mismatch.png` | same block, full-width fields |

Two layout/identity defects were found and fixed while doing this: the security form's two-column
inline grid broke as soon as a second password field appeared (now a stacked `.security-settings__password-form`),
and both administration dialogs shared one `useId` per field, producing duplicate DOM ids (now one
id set per dialog; duplicate-id probe returns `[]`).

## Password field behaviour (measured on `/setup`)

| State | Meter | Level (text) | Rule | Toggle |
|---|---|---|---|---|
| `abc` | value 1 | Robustesse : Très faible, 1/5 règles | `data-met="false"` on the length rule | Afficher / `aria-pressed="false"`, input `password` |
| after reveal | value 6 | Faible | `data-met="false"` | Masquer / `aria-pressed="true"`, input `text` |
| `phrase de passe très longue 2026` | value 4 | Robustesse : Fort, 4/5 règles | length/1minuscule/chiffre/espace met, majuscule unmet | Masquer / `true`, input `text` |
| reveal off again | value 4 | Robustesse : Fort, 4/5 règles | unchanged | Afficher / `false`, input `password` |

Keyboard: `Tab` from the password input lands on the reveal button
(`aria-label="Afficher le mot de passe"`, `aria-pressed="false"`); `Enter` toggles it to
`Masquer le mot de passe` / `aria-pressed="true"` and the input type becomes `text`, focus
staying on the button. The meter is a native `<meter>` (`min`/`max`/`value` plus an
`aria-label` carrying the level), so the level is never colour-only; the visible level text
also carries it.

Account surface hierarchy: on `/login` in password mode there is exactly **one** primary
action (full width, 398 px at 1440 / 308 px at 390), an "ou" separator, then the ghost
"Utiliser la passkey" — measured `primaryCount === 1`.

## Files touched

- `apps/web/src/features/auth/auth-shell.tsx` (new), `password-field.tsx` (new),
  `password-strength.ts` (new).
- `apps/web/src/features/auth/{bootstrap,login,signup}-page.tsx` — render through `AuthShell`,
  use `PasswordField`, and require the password twice on setup/sign-up; the login form joins
  `.ui-auth-form`.
- `apps/web/src/features/settings/administration-settings.tsx`,
  `apps/web/src/features/security/security-settings.tsx` — the same field, confirmation and rules
  on every other password-creation surface; `packages/contracts/src/security-api.ts` exports
  `PASSWORD_MINIMUM_LENGTH`; `apps/web/src/ui/primitives/confirm-dialog.tsx` gains
  `confirmDisabled`; `settings-security.css` stacks the two-field password form.
- `apps/web/tests/accounts-ui.spec.tsx`, `tests/e2e/bootstrap.spec.ts`, `tests/e2e/accounts.spec.ts`
  — fill the new confirmation field; one new web test for the mismatch.
- `apps/web/src/features/auth/auth.css` — shell, card, steps, separator, strength meter, toggle;
  the 058 "transparent auth card" override is replaced (desktop connection keeps its borderless
  panel, scoped).
- `apps/web/src/ui/primitives/field.tsx` + `primitives.css` — optional `trailing` slot and the
  `.ui-password-toggle` control.
- `apps/web/src/app.tsx` — auth branches use `app-shell app-shell--auth`.
- `apps/web/src/ui/copy/fr.ts` — password copy, login lead, "ou".
- `apps/web/src/ui/ui-lab.tsx` — sign-up and invitation preview entries.
- `docs/design/ui-system.md` — auth section rewritten (shell, field, password UX, CSS owner).
- `apps/web/tests/password-strength.spec.ts` (new).

## Not verified

- **Playwright matrix not re-run.** Behaviour and `data-testid` hooks are unchanged, and the
  web suites above cover the surfaces, but the browser matrix remains the honest gap. Command
  to close it: `bun run test:e2e:gate` (or `bun run test:e2e` after a build).
- **Desktop/Electron window** not exercised (out of scope; its connection page is unchanged,
  and `app-shell--auth` only affects the web auth gates).
- **Real passkey ceremonies** not re-run (no browser authenticator in this session); feature 058
  validated them and this pass changes no ceremony code.
- The dev database is still uninitialized (no administrator was created), so `/setup` is the
  only real route captured; `/login`, `/signup`, `/join` were captured through `/__ui-lab`, which
  mounts the same components with a preview API.
