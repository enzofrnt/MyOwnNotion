# Tasks: Auth shell for sign-in and account creation

**Spec**: `specs/059-auth-shell-ui/spec.md` · **Plan**: `specs/059-auth-shell-ui/plan.md`

## Phase 0b — Parity pass with the reference password-creation surface (2026-11-17)

- [x] T000e Adopt the reference model: five criteria, four-step level scale, "x/N règles" counter.
- [x] T000f Share the minimum length with the contract (`PASSWORD_MINIMUM_LENGTH`).
- [x] T000g Apply the same field to the administration dialogs and the Security settings, with
      confirmation and a disabled confirm action until valid.
- [x] T000h Give each administration dialog its own field ids (no duplicate `id`/`aria-describedby`).

## Phase 0 — Owner review (2026-11-17)

- [x] T000 Remove the e-mail and password description lines and the strength advice sentence.
- [x] T000b Require a password confirmation on setup and sign-up, inline mismatch, no submission.
- [x] T000c Replace the single "12 characters" line with a criteria list (rule + comfort).
- [x] T000d Update the e2e fills and add a web test for the mismatch.

## Phase 1 — Shared pieces

- [x] T001 Add the optional `trailing` slot to `Field` (`apps/web/src/ui/primitives/field.tsx`)
      and `.ui-field__control-row` + `.ui-password-toggle` to `primitives.css`.
- [x] T002 `apps/web/src/features/auth/password-strength.ts`: `assessPassword()` returning level,
      percent, `meetsMinimum` (12 characters) and one guidance sentence.
- [x] T003 `apps/web/src/features/auth/password-field.tsx`: `PasswordField` on top of `Field`
      with the reveal control (`aria-pressed`, stable label) and the optional strength meter
      (`role="meter"`, text level, minimum rule).
- [x] T004 `apps/web/src/features/auth/auth-shell.tsx`: `AuthShell` (wordmark, `h1`, lead, body,
      footer) with `aria-labelledby` through `headingId`.
- [x] T005 Copy: reveal names, levels, minimum rule and guidance sentence in
      `apps/web/src/ui/copy/fr.ts`.

## Phase 2 — Apply the shell (US1, US2)

- [x] T006 `bootstrap-page.tsx`: render through `AuthShell` for loading, form, passkey and
      unavailable states; password field with strength.
- [x] T007 `signup-page.tsx`: same shell for form and passkey states (open and invitation modes).
- [x] T008 `login-page.tsx`: same shell; password field with reveal only; passkey section and
      method switch keep the existing hierarchy.
- [x] T009 `auth.css`: shell, card, wordmark, separator, strength meter; remove the 058
      "transparent auth card" override; single owner note.
- [x] T010 `app.tsx`: auth branches use `app-shell app-shell--auth`; `auth.css` owns the variant.

## Phase 3 — Documentation and lab

- [x] T011 `docs/design/ui-system.md`: auth section (card shell, field, password UX, CSS owner).
- [x] T012 `ui-lab-auth.tsx` / `ui-lab.tsx`: sign-up + invitation preview entries render the new
      shell without credentials.

## Phase 4 — Verification

- [x] T013 Behaviour unchanged: web suites green (`lint`, `typecheck`, unit/web tests), existing
      test ids and copy assertions still pass.
- [x] T014 Screenshots `/setup`, `/login`, `/signup`, `/join` at 1440 / 768 / 390 px, light and
      dark, plus password states (short, long, revealed), busy and refused states.
- [x] T015 Keyboard and a11y sweep: reveal toggles `aria-pressed`, focus stays on the control,
      meter exposes `aria-valuetext`; 320 px has no horizontal scroll.
- [x] T016 Write `specs/059-auth-shell-ui/validation.md` with commands, outputs and limits.

## Dependencies

- T001 → T003; T002 → T003; T004 independent of T001–T003.
- T005 before T003–T008 (copy consumed by the components and pages).
- T006–T008 after T003/T004; T009 after T006–T008 (selector names settled in code).
- T010 independent; T011/T012 after T006–T009; T013–T016 last.
