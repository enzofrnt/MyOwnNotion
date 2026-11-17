# Quickstart validation: Multi-user accounts (058)

## Prerequisites

- Bun 1.4.2, Docker (Postgres via the test runners), a **fresh** database:
  the baseline replaces all earlier migrations (research D4), so recreate any
  local dev volume (`docker compose down -v`).

## Automated checks

```bash
bun run test:migration          # baseline applies on empty DB; old history refused
bun run test:security           # auth, bootstrap, registration, invitations, isolation
bun run test:contract           # HTTP contracts of contracts/http.md
bun run test:e2e:local          # Playwright journeys below
```

Isolation suite (SC-003): `apps/api/tests/contract/account-isolation.contract.spec.ts`
creates accounts A and B and, for every private route, sync stream, search,
graph, file, export and MCP tool, asserts B gets 404/empty for A's ids.

## Manual / Playwright journeys

1. Fresh install → `/setup` only → create admin → offered passkey → workspace.
2. Sign out → sign in with email+password → sign out → sign in with passkey.
3. Admin: Settings › Users › create B. Sign in as B: empty workspace, no
   *Users*/*Registration* sections.
4. Admin: Registration › Invitation → create link (2 uses) → open in private
   window → sign up C → link shows 1/2 and lists C → revoke → link refused.
5. Registration › Open → `/login` shows "Create an account" → sign up D.
6. A creates page "secret-A"; B searches "secret-A" → no result; B opens
   A's page URL → not found.
7. A authorizes an MCP client; its search/read for B's ids → not found.
8. Admin disables B → B's open tab is signed out on next request; MCP of B
   refused.

Visual evidence (ui-quality): screenshots of setup, login, signup, join,
users, registration/invitations — empty, error, loading and success states,
at 320 px and desktop widths, stored under `evidence/`.
