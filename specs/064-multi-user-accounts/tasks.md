# Tasks: Multi-user accounts

**Input**: `specs/064-multi-user-accounts/` — spec.md, plan.md, research.md (D1–D11), data-model.md, contracts/http.md, quickstart.md
**Tests**: required (constitution III): contract/integration per behavior, Playwright per UI journey.
**UI**: every UI task follows the [UI quality skill](../../.agents/skills/ui-quality/SKILL.md) and [lessons](../../.agents/skills/ui-quality/lessons.md); `docs/design/ui-system.md` primitives.

Format: `- [ ] Tnnn [P?] [USn?] description (path)`.

## Phase 1: Setup

- [x] T001 Read constitution 5.0.0 principle I, canvas §2/§5/§8/§26/§28.4/§32, specs 002, 006, 013, and plan.md of this feature; record in `specs/064-multi-user-accounts/tasks.md` notes any conflict found
- [x] T002a Add a "superseded in part by 058" note to `specs/002-owner-security-foundation/spec.md` and `specs/013-mcp-access/spec.md` (done during analyze remediation, D3)
- [x] T002 Inventory every use of `context.workspaceId`, `installations.owner_id`, `installations.workspace_id` and single-owner assumptions (`grep -rn` across `apps/`, `packages/`, `tests/`) and paste the file list into `specs/064-multi-user-accounts/audit.md`

## Phase 2: Foundational (blocks all stories)

### Baseline migration (D4)

- [x] T003 Write `packages/database/migrations/0001_baseline.sql` = final schema of 0001–0021 plus data-model.md changes (installations `administrator_id`/`registration_mode`, extended `owners`, `invitations`, simplified `bootstrap_attempts`, no `pending_bootstrap_credentials`, audit `owner_id` + new event types); delete `0001_initial.sql`…`0021_database_entry_numbers.sql`
- [x] T004 Update Drizzle schema to match in `packages/database/src/schema/index.ts`, `packages/database/src/schema/security/*.ts`, `packages/database/src/schema/mcp.ts`, add `packages/database/src/schema/security/invitations.ts`
- [x] T005 Make `packages/database/src/migrate.ts` refuse a database whose `schema_migrations` contains pre-baseline versions with an explicit "recreate the development database" error
- [x] T006 [P] Rewrite `packages/database/tests/migrations.integration.spec.ts` (baseline on empty DB, idempotent re-run, refusal of old history) and regenerate fixtures used by `packages/database/tests/reference-backups.integration.spec.ts`
- [x] T007 [P] Update backup archive table list and restore target for new/removed tables in `apps/api/src/backup/archive-format.ts` and `apps/api/src/backup/database-restore-target.ts`; adjust `apps/api/tests/archive-format.spec.ts`

### Request-scoped workspace (D3)

- [x] T008 Add `workspaceId` and `role` to the owner and MCP principals in `apps/api/src/security/authentication-hook.ts`, `apps/api/src/security/owner-principal.ts`, `apps/api/src/security/session-service.ts` (session resolution joins `owners`, refuses `status <> 'active'`)
- [x] T009 Add `requireWorkspace(request)` and `requireAdministrator(request)` (404 for members) in `apps/api/src/security/request-context.ts`
- [x] T010 Remove `workspaceId` from `AppContext` in `apps/api/src/context.ts` and the singleton workspace lookup in `apps/api/src/app.ts`; fix every resulting compile error in `apps/api/src/routes/*.ts` by passing `requireWorkspace(request)` to repositories
- [x] T011 Make repository entry points take `workspaceId` as required argument and filter by it (join through `items` where the table has no `workspace_id`) in `packages/database/src/repositories/**/*.ts`
- [x] T012 Key search state by workspace (lazy per-workspace index, eviction on account delete) in `apps/api/src/search/search-service.ts` and `apps/api/src/search/search-state.ts`
- [x] T013 Key structured queries, page state checkpoints and Notion import target by workspace in `apps/api/src/databases/database-query-service.ts`, `apps/api/src/page-state/*.ts`, `apps/api/src/imports/notion/target.ts`
- [x] T014 Scope change notifier, change stream and page sync socket channels per workspace in `apps/api/src/sync/change-notifier.ts`, `apps/api/src/routes/change-stream.ts`, `apps/api/src/routes/page-sync-socket.ts`, `apps/api/src/security/realtime-authorization.ts`, `apps/api/src/security/synchronization-authorization.ts`
- [x] T015 Scope files/uploads and export to the caller's workspace in `apps/api/src/files/*.ts`, `apps/api/src/routes/files.ts`, `apps/api/src/routes/uploads.ts`, `apps/api/src/routes/export.ts`
- [x] T016 Add an account fixture helper (`createAccount({ email, pseudonym, password, role })` returning a session cookie) in `packages/test-utils/src/accounts.ts` and switch existing API tests that seeded the single owner (`apps/api/tests/authentication.contract.spec.ts`, `apps/api/tests/devices.contract.spec.ts`, `apps/api/tests/rotation-evaluation.integration.spec.ts`, …) to it
- [x] T017 Make `bun run typecheck` and `bun run test:contract` green on the single-account path before starting stories

**Progress note (2026-11-16)**: T003–T005 done; `0001_baseline.sql` applied cleanly on Postgres 18 (60 tables). T004 updates the Drizzle schema; its consumers (`bootstrap-repository.ts`, `installation-repository.ts`, `recovery-import-repository.ts`, tests) intentionally fail to type-check until T008–T011.

**Implementation notes (2026-11-17)**:
- T008–T015 were implemented as research D13: one `WorkspaceRuntime` per account workspace, built lazily in `apps/api/src/app.ts`, plus a per-request AsyncLocalStorage scope (`apps/api/src/workspace-scope.ts`) bound by the authenticated principal. Routes keep their deps; `scoped()` proxies forward to the bound workspace's service.
- T011 was implemented as the workspace fence (research D14, `packages/database/src/workspace-fence.ts`) instead of rewriting every repository signature: lookups by id add `workspace_id = <bound>` whenever a request is bound.
- T016 lives in `apps/api/tests/helpers/content-owner.ts` (`createAdministrator`, `createMember`, `signIn`, `authenticatedContent`) and `createSecuredApiHarness` in `apps/api/tests/helpers/app.ts`, not in `packages/test-utils`, because it drives the API.
- T036: the isolation suite found cross-account reads/writes by id (items, trash, restore, placements, revisions, and creating under another account's folder); all fixed by the fence.
- T007: the backup archive format needed no change; obsolete upgrade-path tests (0015→0016, pre-0006 sources, 0019 legacy reset, format-v2 upgrade) were removed with the history.

**Implementation notes, UI (2026-11-17)**:
- T030: the pseudonym, email, role and sign-out live in *Réglages › Compte* (`apps/web/src/features/settings/account-settings.tsx`); the sidebar is unchanged (L-004: the sidebar stays secondary to content).
- T042 and T038 are covered by the API isolation suite (`apps/api/tests/account-isolation.contract.spec.ts`, MCP through the official client) and by `tests/e2e/accounts.spec.ts` (a member never sees the administrator's page); no separate MCP Playwright file was added.
- T049/T055 share one document, *Réglages › Administration* (`administration-settings.tsx`), styled by the existing `settings-security.css` owner (L-009).
- T058: specs 002 and 013 carry a "superseded in part by 058" note at the top; their bodies stay as the historical record of the single-owner design.
- Visual evidence: `specs/064-multi-user-accounts/evidence/` (captured by the Playwright journeys with `MYOWNNOTION_058_EVIDENCE=1`, desktop and mobile projects).
- Passkey enrollment completion now validates an attestation (`WebAuthnRegistrationSchema`); the former schema expected an assertion and would have refused every enrollment.

**Checkpoint**: one account works exactly as before, workspace now request-scoped.

## Phase 3: US1 — Administrator bootstrap (P1) 🎯 MVP

**Independent test**: fresh install → `/setup` → admin created → passkey offered → sign-out/sign-in.

- [x] T018 [P] [US1] Contract tests for `POST /v1/bootstrap` (201, 409 already_initialized, validation, concurrent submissions → one admin) in `apps/api/tests/bootstrap.contract.spec.ts`; delete `apps/api/tests/bootstrap-kit-artifact.contract.spec.ts` and adapt `apps/api/tests/bootstrap-fault-injection.integration.spec.ts`, `packages/database/tests/bootstrap-concurrency.integration.spec.ts`
- [x] T019 [P] [US1] Add `bootstrapRequest`, `accountSummary`, email/pseudonym/password validators in `packages/contracts/src/security-api.ts`
- [x] T020 [US1] Rewrite `apps/api/src/security/bootstrap-service.ts`: one transaction creating workspace, administrator owner (origin bootstrap), password credential, device and session; installation → ready with `administrator_id`; remove kit/pending-credential steps and `apps/api/src/security/bootstrap-kit.ts` usage
- [x] T021 [US1] Replace multi-step routes with `POST /v1/bootstrap` and expose `registrationMode` in `GET /v1/installation/status` in `apps/api/src/routes/bootstrap.ts`, `apps/api/src/routes/installation.ts`
- [x] T022 [US1] Rewrite `apps/web/src/features/auth/bootstrap-page.tsx` (single form email/pseudonym/password, then optional "Add a passkey" step) — apply ui-quality states (empty, submitting, field error, already initialized, success)
- [x] T023 [US1] Update e2e fixtures to the new bootstrap in `tests/e2e/global-setup.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/helpers.ts`, `tests/e2e/reset-installation.ts`, `tests/e2e/desktop-workspace.ts`, `tests/e2e/desktop-electron.ts`
- [x] T024 [US1] Playwright journey in `tests/e2e/bootstrap.spec.ts` (setup only screen, success, refusal once initialized, setup completed in < 2 min — SC-001) + visual evidence 320 px/desktop in `specs/064-multi-user-accounts/evidence/`

## Phase 4: US2 — Sign in with password or passkey (P1)

**Independent test**: two accounts with passkeys; each passkey opens only its account.

- [x] T025 [P] [US2] Contract tests: email+password login, uniform failure for unknown email/wrong password, rate limit per email and per address, disabled account refused, discoverable passkey login per account in `apps/api/tests/authentication.contract.spec.ts`
- [x] T026 [US2] Password login by normalized email with dummy verification for unknown emails in `apps/api/src/routes/authentication.ts`, `apps/api/src/security/password-service.ts`; email key in `apps/api/src/security/rate-limit-service.ts`
- [x] T027 [US2] Discoverable passkeys (`residentKey: required`, `user.id`=owner id, name=email, displayName=pseudonym, empty `allowCredentials`, `excludeCredentials` own only) in `apps/api/src/security/webauthn-service.ts` and passkey routes of `apps/api/src/routes/authentication.ts`
- [x] T028 [P] [US2] `GET/PATCH /v1/me` (pseudonym, email with recent auth, uniqueness) in `apps/api/src/routes/me.ts` with tests in `apps/api/tests/me.contract.spec.ts`
- [x] T029 [US2] Login page email+password field set + "Sign in with a passkey" in `apps/web/src/features/auth/login-page.tsx`, `apps/web/src/features/auth/passkey-client.ts` — ui-quality states
- [x] T030 [US2] Show pseudonym + sign-out in the sidebar account menu and an *Account* settings section (pseudonym, email, password, passkeys) in `apps/web/src/features/settings/settings-shell.tsx` and new `apps/web/src/features/settings/account-settings.tsx`
- [x] T031 [US2] Namespace local encrypted stores by account id and refuse opening another account's store in `packages/client-core/src/local-store/local-repository.ts`, `packages/client-core/src/local-store/schema.ts`, `apps/web/src/runtime/client-runtime.ts`; tests in `packages/client-core/src/local-store/*.spec.ts`
- [x] T032 [US2] Playwright `tests/e2e/authentication.spec.ts`: password login, passkey login (virtual authenticator) for two accounts, wrong credentials, account switch on same browser shows no previous data; visual evidence

## Phase 5: US3 — Strict workspace isolation (P1)

**Independent test**: B cannot reach or detect A's content via any surface.

- [x] T033 [US3] Isolation suite `apps/api/tests/account-isolation.contract.spec.ts`: enumerate Fastify routes, for every private route with an id param assert B gets the same 404 as a random id for A's ids; lists/search/graph/changes/export of B never contain A's data; fails if a private route has no isolation case
- [x] T034 [P] [US3] Realtime isolation: B's change stream and page sync socket never receive A's events in `apps/api/tests/change-stream.contract.spec.ts`
- [x] T035 [P] [US3] Search isolation (no hit, snippet or count) in `apps/api/tests/search.contract.spec.ts` (create if missing)
- [x] T036 [US3] Fix every leak found by T033–T035 in the owning route/repository and record each in `specs/064-multi-user-accounts/audit.md`
- [x] T037 [US3] Public share pages expose neither owner email nor other content: assertion in `apps/api/tests/account-isolation.contract.spec.ts`
- [x] T038 [US3] Playwright `tests/e2e/account-isolation.spec.ts`: A's page URL opened by B shows not found; search shows nothing

## Phase 6: US4 — Per-user MCP access (P1)

**Independent test**: A's MCP access cannot reach B; B does not see A's accesses.

- [x] T039 [P] [US4] Tests: listing filtered by owner, every tool against B's ids → not found, authorization page for another account answers the same 404 as an unknown token, revocation/disable stops access, in `apps/api/tests/mcp-access.integration.spec.ts`, `apps/api/tests/mcp-scope.spec.ts`
- [x] T040 [US4] Resolve MCP principal with connection `owner_id`/`workspace_id`, refuse disabled owners, pass workspace to every tool in `apps/api/src/mcp/http.ts`, `apps/api/src/mcp/tools.ts`, `apps/api/src/mcp/scope.ts`, `apps/api/src/mcp/access-service.ts`
- [x] T041 [US4] Filter connections/audit by session owner and require owner match on exchange/authorization in `apps/api/src/routes/mcp.ts`, `apps/api/src/mcp/exchange-cli.ts`
- [x] T042 [US4] Playwright: two accounts each see only their MCP connections in settings in `tests/e2e/mcp-access.spec.ts` (create or extend)

## Phase 7: US5 — Registration modes and invitations (P2)

**Independent test**: each mode enables exactly its sign-up paths; link counters and accounts list correct.

- [x] T043 [P] [US5] Contract tests: mode get/put (admin only, recent auth), signup closed → 403, open → 201, invitation valid/revoked/expired/exhausted/unknown → 410 identical, last-use race → one account, email taken → 409, link lists created accounts, leaving invitation mode makes existing links refused and returning restores still-valid ones, audit events `registration.mode-changed`/`invitation.created`/`invitation.revoked`/`invitation.used` written without secrets, in `apps/api/tests/registration.contract.spec.ts`
- [x] T044 [P] [US5] Registration/invitation/signup schemas in `packages/contracts/src/security-api.ts`
- [x] T045 [US5] Invitation service (32-byte base64url secret, SHA-256 storage, atomic conditional `use_count` increment in the account-creation transaction, derived state, audit `invitation.*` events) in `apps/api/src/security/invitation-service.ts`
- [x] T046 [US5] Account creation service shared by bootstrap/admin/signup (normalize email, create workspace + owner + password + device + session, audit `account.created` with origin) in `apps/api/src/security/account-service.ts`
- [x] T047 [US5] Routes (audit `registration.mode-changed`) `POST /v1/auth/signup`, `GET/PUT /v1/admin/registration`, `GET/POST/DELETE /v1/admin/invitations` in `apps/api/src/routes/signup.ts`, `apps/api/src/routes/admin-registration.ts`; register in `apps/api/src/app.ts`
- [x] T048 [US5] Web `signup-page.tsx` (open mode) and `join-page.tsx` (reads secret from `location.hash`, never sends it in the URL) in `apps/web/src/features/auth/`; routes in `apps/web/src/routing/`; "Create an account" link on login only in open mode — ui-quality states
- [x] T049 [US5] Settings *Registration & invitations* (mode selector with explanations, links list with label, uses x/y, expiry, state, created accounts, create dialog showing link once with copy, revoke) in `apps/web/src/features/settings/registration-settings.tsx` — ui-quality states (no link yet, loading, error, success)
- [x] T050 [US5] Playwright `tests/e2e/registration.spec.ts`: quickstart journeys 4 and 5, invitation sign-up completed in < 1 min (SC-002) + visual evidence

## Phase 8: US6 — Account administration (P3)

**Independent test**: disable/enable/reset/delete B with immediate effect.

- [x] T051 [P] [US6] Contract tests for `/v1/admin/accounts*` (member → 404, create, disable revokes sessions/devices/MCP and closes sockets, enable, password reset revokes sessions, delete requires `confirmEmail` and purges workspace, administrator protected → 409) in `apps/api/tests/admin-accounts.contract.spec.ts`
- [x] T052 [US6] Account admin service (list, create via T046, disable/enable, reset password, delete + workspace purge + blob orphan release + search eviction, audit events) in `apps/api/src/security/account-admin-service.ts`
- [x] T053 [US6] Routes in `apps/api/src/routes/admin-accounts.ts`; register in `apps/api/src/app.ts`
- [x] T054 [US6] Admin CLI `list-accounts` and `recover-access --email` replacing single-owner recovery in `apps/api/src/admin/security-commands.ts`, `apps/api/src/admin/command-parser.ts`, `apps/api/src/security/administrative-recovery-service.ts`; `recover-access` works for administrator and members and moves `recovery-required` → `active` per data-model.md; tests in `apps/api/tests/admin-cli.integration.spec.ts`, `apps/api/tests/administrative-recovery.integration.spec.ts`
- [x] T055 [US6] Settings *Users* (table pseudonym/email/origin/status/created, create account dialog, disable/enable, reset password, delete with typed-email confirmation) in `apps/web/src/features/settings/users-settings.tsx`; hidden for members; also hide *Security › Recovery kit* and key rotation for members and refuse them server-side (`requireAdministrator`) in `apps/api/src/routes/security-recovery.ts`, `apps/api/src/routes/security-rotation.ts` — ui-quality states
- [x] T056 [US6] Playwright `tests/e2e/account-administration.spec.ts`: quickstart journeys 3 and 8 + visual evidence

## Phase 9: Polish

- [x] T057 [P] Update `docs/development.md` (fresh DB required after baseline), `docs/design/ui-system.md` (new settings sections), root `package.json` description ("Single-owner" → "Self-hosted multi-account")
- [x] T058 [P] Update remaining single-owner wording in the body of `specs/002-owner-security-foundation/` and `specs/013-mcp-access/` artifacts beyond the T002a note
- [x] T059 Run `bun run checks:local` (cross-cutting change) and record evidence in `specs/064-multi-user-accounts/validation.md`
- [x] T060 Run quickstart.md end to end and tick each journey in `specs/064-multi-user-accounts/validation.md` (journeys 1–8 automated in `tests/e2e/bootstrap.spec.ts`, `tests/e2e/accounts.spec.ts` and the API isolation suite; see validation.md)

## Dependencies

- Phase 2 blocks everything; T010 → T011–T015 → T017.
- US1 → US2 (login needs accounts) → US3/US4 (need two accounts; use T016 helper, so can start right after Phase 2 in parallel with US1/US2 UI).
- US5 depends on T046 (shared account creation); US6 depends on T046 and T052.
- Polish last.

## Parallel examples

- Phase 2: T006 ∥ T007 after T003–T004; T012 ∥ T013 ∥ T014 ∥ T015 after T010.
- US1: T018 ∥ T019. US2: T025 ∥ T028. US3: T034 ∥ T035. US5: T043 ∥ T044. US6: T051 first, then T052 → T053 ∥ T055 prep.

## Implementation strategy

1. MVP = Phase 2 + US1 + US2: administrator account with password/passkey on the new schema.
2. Then US3 + US4 (isolation, MCP) — **must land before a second real account is created**.
3. Then US5, US6. One branch, one PR (no stacked PRs); full local chain before push.
