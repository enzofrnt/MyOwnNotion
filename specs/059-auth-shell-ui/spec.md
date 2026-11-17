# Feature Specification: Auth shell for sign-in and account creation

**Feature Branch**: `059-auth-shell-ui`

**Created**: 2026-11-17

**Status**: Implemented

**Validation**: [validation.md](validation.md) — gates, 24 browser captures, password states, contrast.

**Input**: Owner request: "je veux surtout que tu prennes en compte l'UI pour intégrer une UI propre aussi dans MyOwnNotion : que tout ce qui est login se retrouve dans une zone qui ressort du reste, que les différents champs ressemblent à ce que l'on attend à l'intérieur, et les éléments que l'on veut genre la robustesse du mot de passe, voir et cacher le mot de passe…"

## Problem

The account surfaces built by feature 058 (`/setup`, `/login`, `/signup`, `/join`) render
as plain text on the application canvas: the page title, then transparent sections with no
visual boundary, fields that look identical to inline editor inputs, and no password
affordances. Feature 058 deliberately flattened `.ui-auth-card`
(`apps/web/src/features/auth/auth.css`, "sections transparentes"), so a first-run or sign-in
screen is indistinguishable from any other page, and a password is typed blind: no reveal
toggle, no strength feedback while choosing one.

## UX brief

- **User job**: get into (or set up) the workspace, in one place, without wondering what is
  interactive.
- **Primary action**: one per state — "Créer le compte" on setup, the credential action on
  login, "Créer mon compte" on sign-up.
- **Secondary actions**: switch authentication method (login), add a passkey (setup),
  "J'ai déjà un compte" (sign-up). All visibly weaker than the primary.
- **Success moment**: the app opens on the workspace; the auth zone disappears.
- **Key friction today**: no boundary (which part of the page is the form), no password
  reveal, no feedback on the password being chosen, and the same visual weight for controls
  that do very different things.
- **Scope**: `features/auth` surfaces (`bootstrap`, `login`, `signup`, also used for `/join`),
  their CSS owner, the shared `Field` primitive (trailing control slot), the password field
  component, French copy, and the UI lab previews.
- **Non-goals**: authentication behaviour and API contracts, registration modes, settings
  surfaces (Compte, Administration, Sécurité), native/desktop windows, the editor.

## Screen / action audit

| Screen | Actions today | Issue | Change |
|---|---|---|---|
| `/setup` (bootstrap) | Create account, add passkey, skip | Form floats on the canvas, password typed blind, rule (12 chars) only in a hint line | One auth card; labelled fields; password reveal + strength with the 12-character minimum stated |
| `/login` | Passkey (primary), password form (alternative) | No boundary between the page and the form; password blind; two sections read as equals | Same card; method switch stays explicit; password reveal; primary stays the credential action |
| `/signup`, `/join` | Create account | Same as setup, plus invitation errors appear above a borderless form | Same card; invitation refusal stays inside the card next to the fields |
| UI lab (`/__ui-lab?surface=…`) | Renders the real pages | — | Inherits the new shell automatically; add the missing sign-up/join preview entry |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One visible zone for everything account-related (Priority: P1)

A person who just opened the app sees a single elevated card, centred on a calm background,
holding the title, the explanation, the fields and the actions. Nothing outside that card
looks interactive.

**Why this priority**: it is the first screen of the product; without a boundary the form
reads as documentation.

**Independent Test**: load `/setup`, `/login`, `/signup` and `/join` at 1440, 768 and 390 px
and confirm the card is the only surface, centred, and that the page never scrolls
horizontally.

**Acceptance Scenarios**:

1. **Given** the installation has no administrator, **When** the app opens, **Then** the
   creation form is inside one card, with the product wordmark, an `h1`, a lead and the fields,
   and the canvas around it contains no control.
2. **Given** any account surface, **When** it renders at 390 px, **Then** the card keeps a
   comfortable inset (≥16 px from the viewport edge) and no horizontal scrollbar appears.
3. **Given** the dark theme, **When** the card renders, **Then** surface, border, text and
   shadow come from the theme tokens and the contrast stays ≥ 4.5:1.

---

### User Story 2 - A password field that behaves like a password field (Priority: P1)

When choosing a password, the person can reveal what they typed and sees how strong it is,
with the only hard rule (12 characters) stated plainly. When signing in, they can reveal the
password but are not shown a strength judgement about a password they already own.

**Why this priority**: blind typing is the main source of failed first-run attempts.

**Independent Test**: type in the setup password field; the reveal control toggles the input
type, the strength meter moves, and the 12-character rule turns satisfied at 12 characters.

**Acceptance Scenarios**:

1. **Given** a password field, **When** the user activates the reveal control, **Then** the
   input switches between `password` and `text`, the control keeps its accessible name
   ("Afficher le mot de passe" / "Masquer le mot de passe"), `aria-pressed` reflects the
   state, and focus stays on the control.
2. **Given** a password being created, **When** it is shorter than 12 characters, **Then** the
   meter reports a weak level and the minimum rule is shown as unsatisfied; at 12 characters
   and beyond, the rule is satisfied and the level rises with length/variety.
3. **Given** the sign-in password field, **When** it renders, **Then** no strength meter is
   shown and the field keeps `autocomplete="current-password"`.
4. **Given** a strength meter, **When** it changes, **Then** its value is exposed to assistive
   technology (`role="meter"`, `aria-valuenow`/`aria-valuetext`) and never relies on colour
   alone.

---

### User Story 3 - Hierarchy survives every state (Priority: P2)

Busy, error, invitation-refused and passkey states keep the same card, the same field geometry
and a single primary action.

**Why this priority**: a state change must not move the controls under the pointer.

**Independent Test**: submit, fail, and switch authentication method; the card does not jump
and the primary button keeps its size.

**Acceptance Scenarios**:

1. **Given** a refused sign-in, **When** the error appears, **Then** it renders inside the card
   above the form, keeps the typed e-mail, and the primary button is unchanged in size.
2. **Given** a busy submit, **When** the request is in flight, **Then** the primary action shows
   its busy state, stays in place, and cannot be triggered twice.
3. **Given** the passkey offer after setup, **When** it renders, **Then** the card, title and
   spacing are the same as the form state.

### Edge Cases

- Strength meter with an empty field: neutral level, no judgement.
- Password longer than 100 characters: the meter caps at the strongest level; the field still
  submits (server maximum stays 1024).
- Very long error message from the server: wraps inside the card, no horizontal scroll.
- Reveal toggle with the field disabled/busy: control is disabled too.
- 320 px width: card and fields stay usable, no horizontal scroll.
- Invitation secret missing (`/join` without a fragment): the refusal renders inside the card.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The four account surfaces render inside one shared auth shell: a centred card on
  the application canvas, with the product wordmark, one `h1`, an optional lead, the content,
  and an optional footer.
- **FR-002**: The shell owns the visual boundary (surface, border, radius, elevation) using
  theme tokens only; the canvas outside the card contains no interactive control.
- **FR-003**: The shell fills the viewport height, is centred horizontally and vertically
  within reason (top padding at least 8 % of the height on desktop), and never causes
  horizontal scrolling at 320 px.
- **FR-004**: Fields inside the card are the shared `Field` primitive at full width; a trailing
  control slot is added to that primitive for in-field actions.
- **FR-005**: A shared password field renders the label, the input, an optional description and
  a reveal control; the reveal control is a button with `aria-pressed`, a stable accessible
  name, and no text label.
- **FR-006**: Password fields used to create a password show the same strength block as the
  reference Giftlist surface: a five-criterion checklist (length, lowercase, uppercase, digit,
  special character), the four-step level scale (très faible → très fort) and an "x/5 règles"
  counter, with a meter that exposes the values to assistive technology. MyOwnNotion's
  contract enforces the 12-character minimum only, so that criterion is marked
  `requis` and gates submission; the four composition criteria are guidance and never block
  a long passphrase.
- **FR-016** (owner review 2026-11-17): creating a password requires a second **confirmation
  field**. A mismatch is stated inline under that field, wired with `aria-invalid` /
  `aria-describedby`, and prevents submission; the request still carries a single password.
- **FR-017** (owner review 2026-11-17): the e-mail field and the password field carry **no**
  description line, and the strength block carries no advice sentence — the criteria list is
  the only explanatory text. The pseudonym hint stays.
- **FR-007**: Password fields used to sign in do not show a strength meter and keep
  `autocomplete="current-password"`.
- **FR-008**: The strength value is exposed as `role="meter"` with `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow`, `aria-valuetext`, and the level label is not carried by
  colour alone.
- **FR-009**: One primary action per state; method-switch, passkey and "already have an
  account" actions stay secondary, separated from the primary action by the card layout, not
  by a second primary button.
- **FR-010**: Busy and error states keep the card geometry: the primary button keeps its size
  while busy, and errors render inside the card above the fields they concern.
- **FR-011**: All account-affecting behaviour is unchanged: same API calls, same redirects,
  same validation messages, same test ids as today (tests and e2e keep passing).
- **FR-012**: The UI lab previews the same pages through the real components, and gains an
  entry for the sign-up / invitation surface.
- **FR-013**: `docs/design/ui-system.md` and `apps/web/src/ui/copy/fr.ts` are updated in the
  same change, with a single CSS owner for the new shell and password styles.

### Key Entities

None: no data is added or persisted; the password never leaves the page except through the
existing request.

## Success Criteria *(mandatory)*

- **SC-001**: On `/setup`, `/login`, `/signup` and `/join`, the card is the only elevated
  surface and no control exists outside it (checked at 1440, 768 and 390 px).
- **SC-002**: The password reveal control toggles the input type on every password field, and
  the setup/sign-up meters report weak below 12 characters and satisfied at 12 and above.
- **SC-003**: No horizontal scroll at 320, 390, 768 and 1440 px; the card keeps ≥ 16 px from the
  viewport edges and stays ≤ 30 rem wide.
- **SC-004**: Text contrast inside the card ≥ 4.5:1 in both themes; the meter's level is also
  readable as text.
- **SC-005**: `bun run lint`, `bun run typecheck` and the web test suites pass, and screenshots
  for the four surfaces in both themes are attached to the feature validation.

## Assumptions

- The passkey-first ordering of `/login` (spec 002, restated by 058) is preserved: the visual
  work does not change which credential is primary.
- The strength heuristic is a local UI aid, not a server constraint; the contract's 12-character
  minimum remains the only rule the API enforces.
- The product has no logo asset: the wordmark is set in type, from tokens, rather than adding
  an image.
- The desktop connection page keeps its own layout; it is a native-window concern, not an
  account surface.
