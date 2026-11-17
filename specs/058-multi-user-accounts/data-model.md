# Data model: Multi-user accounts (058)

All changes land in the single baseline migration (research D4).

## installations (changed)

| Column | Change |
|---|---|
| `owner_id`, `workspace_id` | **removed** (no singleton owner/workspace) |
| `administrator_id` | uuid → owners, null while uninitialized |
| `registration_mode` | text `closed`\|`invitation`\|`open`, default `closed` |

Counts check: uninitialized/bootstrap-in-progress ⇔ `administrator_id IS NULL`.

## owners = accounts (extended)

| Column | Type / rule |
|---|---|
| `id` | uuid PK (also WebAuthn `user.id`) |
| `installation_id` | FK; the one-per-installation unique index is **dropped** |
| `workspace_id` | FK workspaces, **unique**, not null |
| `email` | text, as typed, 3–254 chars |
| `email_normalized` | text, trimmed + lowercased, **unique** |
| `pseudonym` | text 1–64 chars, trimmed, not unique |
| `role` | `administrator`\|`member`; partial unique index: one administrator |
| `status` | `active`\|`disabled`\|`recovery-required` |
| `origin` | `bootstrap`\|`administrator`\|`invitation`\|`open` |
| `invitation_id` | FK invitations, required iff origin = invitation |
| `created_by_id` | FK owners, required iff origin = administrator |
| `disabled_at`, `last_authenticated_at`, `created_at` | timestamps |

Transitions: active → recovery-required (administrative recovery started by the host CLI `recover-access --email`, sessions revoked); recovery-required → active (new password set through the recovery flow). Applies to the administrator too.
active ⇄ disabled (administrator action, never on the administrator
itself); any → deleted (row removed with its workspace). Administrator cannot
be disabled or deleted.

## invitations (new)

| Column | Rule |
|---|---|
| `id` | uuid |
| `secret_hash` | SHA-256 hex, unique |
| `label` | optional text ≤ 120 |
| `max_uses` | null = unlimited, else ≥ 1 |
| `use_count` | ≥ 0, ≤ max_uses |
| `expires_at` | nullable, > created_at |
| `revoked_at` | nullable |
| `created_by_id` | FK owners (administrator) |
| `created_at` | |

Derived state: `revoked` > `expired` > `exhausted` > `active`. Accounts created
through a link = `owners WHERE invitation_id = id`.

## bootstrap_attempts (simplified)

Keeps `id`, `installation_id`, `bootstrap_state in ('started','confirmed','abandoned','rejected')`
and the open-attempt unique index; kit/download columns removed.
`pending_bootstrap_credentials` removed.

## Unchanged ownership carriers

`passkey_credentials`, `password_credential_versions`, `authorized_devices`,
`sessions`, `mcp_connections` keep `owner_id` (+ `workspace_id` for MCP).
Content tables keep `workspace_id`. Tables reaching the workspace only
through `items` (revisions, revision_parents, attachments, …) are always
queried through a join on `items.workspace_id`.

`security_audit_events` gains `owner_id` (nullable for system events) and
event types: `account.created`, `account.disabled`, `account.enabled`,
`account.deleted`, `account.password-reset`, `registration.mode-changed`,
`invitation.created`, `invitation.revoked`, `invitation.used`.
