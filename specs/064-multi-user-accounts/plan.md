# Implementation Plan: Multi-user accounts

**Branch**: `058-multi-user-accounts` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

## Summary

Turn the single-owner installation into isolated multi-account hosting. Each
account (email, pseudonym, password, optional passkeys) owns one workspace.
The singleton workspace fixed at API boot is replaced by a request-scoped
workspace taken from the authenticated principal (session or MCP
connection). First launch creates the administrator; the administrator picks
a registration mode (closed / invitation / open) and manages accounts and
invitation links. The migration history is reset to one baseline.

Read first: `AGENTS.md`, constitution 5.0.0 (principle I), canvas §2, §5,
§8, §26, §28.4, §32, specs 002 (security foundation), 006 (devices), 013
(MCP), the [UI quality skill](../../.agents/skills/ui-quality/SKILL.md) and
its [lessons](../../.agents/skills/ui-quality/lessons.md),
`docs/design/ui-system.md`.

## Technical Context

**Language/Version**: TypeScript, Bun 1.4.2
**Primary Dependencies**: Fastify 5, Drizzle ORM, `@simplewebauthn/server` 13, React 19, Vite 7, zod contracts
**Storage**: PostgreSQL 18; protected blob store unchanged
**Testing**: Vitest (unit, integration, contract, security), Playwright e2e
**Target Platform**: self-hosted Linux server (Compose); web + Electron clients
**Project Type**: web application (apps/api, apps/web, packages/*)
**Performance Goals**: workspace scoping adds no extra round-trip; sign-in < 1 s server side
**Constraints**: no account enumeration; foreign ids indistinguishable from missing; offline clients bound to one account per device profile
**Scale/Scope**: a handful to a few dozen accounts per installation

## Constitution Check

| Principle | Status |
|---|---|
| I. Ownership & isolation (5.0.0) | ✅ one workspace per account, no cross-account path, export per account, admin has no content access |
| II. One spec | ✅ single `specs/058-…` directory; canvas updated in same change |
| III. Verifiable delivery | ✅ stories independently testable; isolation contract suite; Playwright per UI journey |
| IV. Security/privacy | ✅ hashed invitation secrets, uniform auth errors, rate limits, recent-auth on sensitive ops, audit events |
| V. Simple architecture | ✅ reuses `workspaces`/`owners`; no RLS or new service; rename deferred (Complexity) |
| VI. Predictable UX | ✅ ui-quality gates below |
| VII. Toolchain | ✅ no new dependency |
| Migrations | ⚠️ history reset — authorized by canvas §32 pre-release clause and owner decision |

Post-design re-check: passes.

## Design

See [research.md](research.md) (decisions D1–D11), [data-model.md](data-model.md),
[contracts/http.md](contracts/http.md), [quickstart.md](quickstart.md).

### Workstreams (dependency order)

1. **Baseline migration** — collapse `packages/database/migrations/0001…0021`
   into `0001_baseline.sql` with the data-model changes; update Drizzle
   schema (`packages/database/src/schema/`), `migrate.ts` refusal of old
   histories, migration tests, reference backup fixtures.
2. **Request-scoped workspace** — remove `AppContext.workspaceId`
   (`apps/api/src/context.ts`, `app.ts`); principal carries `workspaceId`;
   `requireWorkspace(request)` helper; fix every compiler error across
   routes, search (index per workspace, lazily built), structured queries,
   change notifier / change stream / page-sync socket (channels per
   workspace), Notion import target, files, backups/export.
3. **Accounts & auth** — `owners` extension, bootstrap rewrite
   (`security/bootstrap-service.ts`, `routes/bootstrap.ts`), email+password
   login, discoverable passkeys (`webauthn-service.ts`), disabled-status
   checks in `session-service.ts` and MCP resolution, `/api/me`.
4. **Registration & invitations** — registration settings, invitation
   service + routes, sign-up route, audit events.
5. **Administration** — account list/create/disable/enable/reset/delete,
   workspace purge; admin CLI `list-accounts`, `recover-access --email`.
6. **MCP per user** — scope tools and authorization page by connection
   owner/workspace; listing filtered by owner.
7. **Web UI** — `features/auth/bootstrap-page.tsx` (single form + optional
   passkey step), `login-page.tsx` (email/password + passkey), new
   `signup-page.tsx` and `join-page.tsx`, settings *Account*, *Users*,
   *Registration & invitations*; current pseudonym + sign-out in sidebar
   account menu; client local store namespaced by account id so two accounts
   on one browser never share offline data.
8. **Isolation suite & e2e** — SC-003 contract suite, Playwright journeys of
   quickstart.

### UI quality gate

States to cover per screen (ui-quality `plan` gate):

| Screen | Empty | Loading | Error | Success |
|---|---|---|---|---|
| Setup | first form | submitting | invalid field, already initialized | passkey offer → workspace |
| Login | form | verifying | uniform failure, rate-limited, disabled | workspace |
| Signup / Join | form | submitting | closed, link unavailable, email taken | workspace |
| Users | only admin listed | list skeleton | action refused | toast + row updated |
| Invitations | "no link yet" | skeleton | create failure | link shown once with copy action, usage counts |

Use existing settings and form primitives from `docs/design/ui-system.md`;
destructive delete uses the existing confirmation dialog typing the email.
Visual evidence at 320 px and desktop in `evidence/`.

### Risks

- Missed unscoped query → cross-account leak. Mitigation: field removal
  forces compile errors; repository functions take `workspaceId` as a
  required first argument; SC-003 suite enumerates routes from the Fastify
  route table so a new route without a test fails.
- Offline data of a previous account on a shared browser. Mitigation:
  account-namespaced local stores; sign-out keeps but never exposes another
  account's store.

## Project Structure

```text
specs/064-multi-user-accounts/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/http.md
├── checklists/requirements.md
└── tasks.md   (next: /speckit-tasks)

packages/database/migrations/0001_baseline.sql   (replaces 0001–0021)
packages/database/src/schema/                    (owners, installations, invitations)
packages/contracts/src/security-api.ts           (account, registration, invitation schemas)
apps/api/src/security/                           (bootstrap, session, webauthn, registration, invitation, account-admin services)
apps/api/src/routes/                             (bootstrap, authentication, signup, me, admin-accounts, admin-registration)
apps/web/src/features/auth/                      (setup, login, signup, join)
apps/web/src/features/settings/                  (account, users, registration)
```

## Complexity Tracking

| Item | Why | Simpler alternative rejected |
|---|---|---|
| Keep `owners`/`ownerId` naming | avoid ~60-file rename in a security-critical change | rename now: noise hides real isolation diffs |
| Migration history reset | owner decision, pre-release | additive migration: no data to preserve |
