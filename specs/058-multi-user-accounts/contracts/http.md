# HTTP contract: Multi-user accounts (058)

Schemas live in `packages/contracts/src/security-api.ts` (zod). Errors use the
existing `{ code, message }` envelope. All mutating routes keep CSRF and
cookie rules. "recent" = recent authentication required (15 min).

## Installation & bootstrap (anonymous)

| Method | Path | Body → Response |
|---|---|---|
| GET | `/v1/installation/status` | → `{ state, registrationMode }` (`registrationMode` only when ready) |
| POST | `/v1/bootstrap` (replaces the multi-step `/v1/bootstrap/:attempt` flow) | `{ email, pseudonym, password }` → 201 session cookie + `{ account }`; 409 `already_initialized`; 409 `bootstrap_in_progress` |

## Authentication (anonymous)

| Method | Path | Body → Response |
|---|---|---|
| POST | `/v1/auth/login/password` | `{ email, password, device }` → session; 401 `authentication_failed` (uniform); 429 |
| POST | `/v1/auth/login/passkey/options` | `{}` → discoverable assertion options |
| POST | `/v1/auth/login/passkey` | `{ assertion, device }` → session; 401 uniform |
| POST | `/v1/auth/signup` | `{ email, pseudonym, password, invitation?, device }` → session. 403 `registration_closed`; 410 `invitation_unavailable` (revoked/expired/exhausted/unknown, indistinguishable); 409 `email_unavailable` |

## Self (authenticated)

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/me` | `{ id, email, pseudonym, role }` |
| PATCH | `/v1/me` | `{ pseudonym?, email? }`; email change recent |
| passkeys, password, sessions, devices, MCP, export | existing paths | now implicitly scoped to the caller |

## Administration (administrator only; members get 404)

| Method | Path | Body / Notes |
|---|---|---|
| GET | `/v1/admin/accounts` | list `{ id, email, pseudonym, role, status, origin, invitationId?, createdAt }` |
| POST | `/v1/admin/accounts` | `{ email, pseudonym, password }` recent |
| POST | `/v1/admin/accounts/:id/disable` / `enable` | recent; 409 on administrator |
| POST | `/v1/admin/accounts/:id/password` | `{ password }` recent; revokes target sessions |
| DELETE | `/v1/admin/accounts/:id` | `{ confirmEmail }` recent; 409 on administrator |
| GET | `/v1/admin/registration` | `{ mode }` |
| PUT | `/v1/admin/registration` | `{ mode }` recent |
| GET | `/v1/admin/invitations` | list `{ id, label, maxUses, useCount, expiresAt, state, accounts: [{id,pseudonym,email,createdAt}] }` |
| POST | `/v1/admin/invitations` | `{ label?, maxUses?, expiresInDays? }` recent → `{ invitation, url }` (secret shown once) |
| DELETE | `/v1/admin/invitations/:id` | revoke |

## Isolation rule (all private routes, sync, websocket, MCP)

Any id not owned by the caller's workspace → the same 404 `not_found` as a
nonexistent id. Lists, counts, search hits and change streams contain only
the caller's workspace.

## MCP

Tools unchanged in shape; every tool runs in the connection's workspace. The
authorization page (`/mcp/authorize`) requires a session whose owner equals
the connection owner, else 404.

## Web routes

`/setup` (bootstrap), `/login` (email+password, passkey button, "Create an
account" link when mode = open), `/join#<secret>` (invitation sign-up),
`/signup` (open sign-up), settings sections *Account*, *Users*,
*Registration* (administrator only).
