# Research: Multi-user accounts (058)

## D1 — One workspace per account, reuse `workspaces`

- **Decision**: Every account owns exactly one `workspaces` row
  (`owners.workspace_id`, unique). All content tables already carry
  `workspace_id` or reach it through `items`; isolation is enforced by scoping
  every query by the *request's* workspace.
- **Rationale**: The schema was already workspace-keyed; only the singleton
  resolution (`installations.workspace_id`, `AppContext.workspaceId` fixed at
  boot in `apps/api/src/app.ts`) assumed one workspace.
- **Alternatives**: `owner_id` on every content table (huge, redundant);
  one database per user (operationally heavy, breaks backups).

## D2 — Keep the `owners` table name, extend it into the account

- **Decision**: `owners` stays the account table (adds `email`,
  `email_normalized` unique, `pseudonym`, `role`, `status`, `origin`,
  `invitation_id`, `workspace_id`). Principal kind stays `"owner"`, meaning
  "owner of the requesting workspace".
- **Rationale**: ~60 files reference `ownerId`; renaming is pure churn. The
  canvas (§5.1) now defines "propriétaire" as the owner of the workspace
  concerned, so the name stays truthful.
- **Alternatives**: rename to `accounts` (clearer, much larger diff — can be a
  later mechanical chore).

## D3 — Request-scoped workspace, removal of `AppContext.workspaceId`

- **Decision**: Delete `AppContext.workspaceId`. The authentication hook
  resolves the principal (session or MCP connection) to
  `{ ownerId, workspaceId }` and routes read `request.principal.workspaceId`
  through one helper `requireWorkspace(request)`. Services that cached a
  workspace (search index, structured queries, change notifier, page sync
  socket, Notion import target) become keyed by workspace.
- **Rationale**: Removing the field makes the compiler list every unscoped
  use — the safest audit available. Foreign ids naturally become "not found"
  because lookups are `WHERE workspace_id = $request`.
- **Alternatives**: Postgres row-level security (strong, but every
  transaction must set a GUC; worth revisiting, not needed for correctness if
  the isolation suite of SC-003 passes).

## D4 — Migration reset to a single baseline

- **Decision**: Replace `0001`–`0021` by one `0001_baseline.sql` producing the
  final multi-account schema; remove the 0001 "not a precedent" caveat with a
  note pointing to 058. The migration guard refuses a database whose
  `schema_migrations` contains pre-baseline versions, with a message telling
  the developer to recreate it. Reference backup fixtures are regenerated.
- **Rationale**: Owner decision 2026-11-16; nothing deployed (canvas §32).
- **Alternatives**: additive migration 0022 (pointless without data).

## D5 — First-launch bootstrap simplified

- **Decision**: Bootstrap = one form (email, pseudonym, password) that creates
  the administrator, its workspace and session atomically, guarded by the
  existing installation state machine and the `bootstrap_attempts`
  uniqueness index; then an optional "add a passkey" step. The recovery kit
  stays in settings (canvas §28.4 already says so). `pending_bootstrap_credentials`
  and kit-download states are removed from the bootstrap path.
- **Rationale**: User request (account = email + password + pseudonym);
  passkeys remain available immediately after.

## D6 — Passkeys per account, discoverable

- **Decision**: Registration uses `residentKey: "required"` with
  `user.id = owner id`, `user.name = email`, `user.displayName = pseudonym`.
  Sign-in uses an empty `allowCredentials` (discoverable); the credential id
  maps to exactly one owner (existing unique index). `excludeCredentials`
  lists the caller's own passkeys only.
- **Rationale**: Passkey-only sign-in without typing an email (spec US2-2).

## D7 — Password sign-in by email, no enumeration

- **Decision**: `POST /auth/password` takes `{ email, password }`; unknown
  email runs a dummy scrypt verification to equalize timing; same error code.
  Rate limits keyed by normalized email and by client address (existing
  rate-limit service gains the email key).

## D8 — Registration modes and invitations

- **Decision**: `installations.registration_mode in ('closed','invitation','open')`,
  default `closed`. Invitation secret = 32 random bytes base64url, stored as
  SHA-256 hash; consumption is a single `UPDATE ... SET use_count = use_count + 1
  WHERE id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
  AND (max_uses IS NULL OR use_count < max_uses) RETURNING` inside the account
  creation transaction — this serializes the last-use race (US5-4).
  The link URL carries the secret in the fragment (`/join#<secret>`) so it is
  not sent in request lines/logs; the client posts it in the body.

## D9 — Disable / delete

- **Decision**: `owners.status = 'disabled'` is checked by session resolution
  and MCP connection resolution on every request; disabling also revokes
  sessions and closes realtime sockets via the change notifier. Deletion
  purges the workspace (items, revisions, operations, files references,
  MCP, devices, sessions, passkeys) in one transaction; protected blobs are
  released through the existing orphan cleanup.

## D10 — MCP

- **Decision**: `mcp_connections` already stores `owner_id` and
  `workspace_id`. The MCP principal now provides that `workspace_id` to every
  tool; authorization exchange page requires the session owner to equal the
  connection owner; connection listing is filtered by owner.

## D11 — Backups, restore, admin CLI

- **Decision**: Backups stay installation-wide (all workspaces; archive
  format gains the owner/workspace tables). Export becomes per requesting
  workspace. Admin CLI `recover-access --email <e>` replaces the single-owner
  recovery; `list-accounts` added.

## D12 — Key hierarchy per workspace (found during implementation)

- **Finding**: `workspace_root_keys` and `data_key_generations` are already
  keyed by `workspace_id`, and `KeyHierarchy` is constructed for one
  workspace (`apps/api/src/security/key-hierarchy.ts`).
- **Decision**: each account's workspace gets its own root key and data-key
  generations, established in the account-creation transaction, all wrapped
  by the installation's deployment wrapping key. Services holding a
  `KeyHierarchy`/`ProtectedContent` become per-workspace (a small cache keyed
  by workspace id). The administrator's recovery kit covers the root keys of
  every workspace (installation-wide, consistent with D11); kit replacement
  re-exports all of them.
- **Rationale**: cryptographic isolation between accounts for free, no
  schema change, rotation already per workspace.

## D13 — Per-workspace runtimes and a request scope (implementation of D3)

- **Decision**: instead of threading a workspace through ~25 services, the API
  builds one `WorkspaceRuntime` (keys, protected content/files, search,
  structured queries, page-state services, MCP access, recovery kits, and
  their background jobs) per account workspace, lazily, and keeps it in a map.
  Each request runs in an `AsyncLocalStorage` scope that the authenticated
  principal (session or MCP connection) binds to its workspace; `AppContext`
  getters and `scoped()` proxies resolve the bound runtime. Unbound code has no
  default workspace: `currentWorkspaceId()` throws.
- **Rationale**: the services were already correct for one workspace;
  isolation comes from construction. WebSocket frames, which arrive outside
  the upgrade request's scope, are bound explicitly with `runInWorkspace`.
- **Alternatives**: workspace parameter on every service method (large diff,
  easy to forget one), Postgres RLS (needs a per-transaction setting on every
  pooled connection).

## D14 — Workspace fence for lookups by identifier

- **Finding**: the isolation suite showed that lookups by id (`getItem`,
  `readItems`, `getPlacement`, `getRevision`, `getRevisionHeaders`) ignored the
  workspace, so another account's id could be read (500 because the keys
  differ — an existence oracle), trashed, or used as a parent.
- **Decision**: `packages/database/src/workspace-fence.ts` — the API registers
  `boundWorkspaceId` as resolver; those lookups add `workspace_id = <bound>`
  when a request is bound. An id from another workspace is then exactly an id
  that does not exist, whether it arrives in a parameter or a body.
- **Residual**: a client-chosen id equal to another account's existing id
  (create with a colliding UUID) yields a conflict instead of a success. Ids
  are UUIDv7 and never disclosed across accounts, so this needs the id first.

## D12 (amended) — Recovery kit scope

- **Decision as implemented**: the recovery kit routes are administrator-only
  and the kit carries the administrator's workspace root key. Member
  workspaces' root keys stay wrapped by the deployment key, which backups and
  full restores carry; a kit covering every workspace is a follow-up.
