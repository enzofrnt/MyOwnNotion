# Owner Security Foundation Validation Quickstart

This is a runnable validation guide, not an implementation recipe. It uses
the pinned Node/pnpm toolchain and the contracts in `contracts/`.

## Prerequisites and setup

- Node.js `>=24.0.0 <25`, pnpm `10.33.3`, Docker Compose, and a current
  WebAuthn-capable browser.

```text
corepack enable
corepack prepare pnpm@10.33.3 --activate
pnpm install --frozen-lockfile
cp .env.example .env
docker compose -f compose.yaml -f compose.override.yaml up -d --wait postgres
pnpm db:migrate
```

Use only a disposable 32-byte deployment key generated outside the repository
and the documented local secret-file fixture. Assert that it is absent from
SQL, logs, image layers, and `.env`; never put it in argv or commit it.

## Contract validation

```text
pnpm test:contract -- security
```

Expected: the OpenAPI document, JSON artifact schema, examples, safe problem
responses, cookie/CSRF rules, and admin command parser/exit-code contract all
validate. The feature-specific contract test must be added to the existing
`test:contract` project rather than creating a second toolchain.

## Bootstrap and single-owner validation

Against an empty migrated DB and a valid disposable deployment secret:

1. Read installation status: expect `uninitialized` with no owner details.
2. Start bootstrap: expect one opaque attempt and one WebAuthn challenge.
3. Complete the virtual-passkey registration: expect one owner, one device,
   and `bootstrapping` state.
4. Export a recovery kit with passphrase through protected test input, confirm
   offline storage, and expect `ready`.
5. Repeat the claim and race concurrent starts/completions: exactly one
   succeeds; no second owner exists.
6. Interrupt after passkey verification, expire the 15-minute attempt, and
   verify no private request is authorized and a fresh claim can resume.
7. Repeat with missing, malformed, or unauthorized deployment key material:
   expect fail-closed readiness and no key bytes in output/logs.

## Authentication, sessions, and CSRF

1. Authenticate with the enrolled passkey alone; expect an HttpOnly
   `__Host-` cookie and a CSRF token only in the response body.
2. Authenticate with the password alternative. Compare wrong-password,
   unknown-credential, and failed-passkey responses; none may disclose account
   state.
3. Omit, corrupt, or cross-origin `X-CSRF-Token` on an unsafe request; expect
   refusal and a redacted audit event.
4. Advance the test clock past 30 days and test configured 1/90-day bounds;
   expect expiry and no silent renewal.
5. Advance `recent_auth_at` past 15 minutes and attempt auth-method,
   recovery, key, or global-device changes; expect recent-authentication gate.
6. Revoke one session and all sessions; every selected cookie must fail access
   and renewal immediately.
7. Exceed the authentication threshold; expect rate limiting without
   credentials, tokens, passkeys, or private content in stored events.

## Devices and local encryption

1. Authorize two browser devices and inspect name, platform, client type,
   authorization/activity/sync timestamps, state, limit, usage, and key
   protection capability.
2. Rename one and change its limit from that device; all device and feature-001
   canonical IDs remain unchanged.
3. Reuse a revoked device's old session/sync proof; sign-in, renewal, key use,
   and new-data delivery are refused.
4. Keep a revoked device offline and verify the UI states that its existing
   local data cannot be guaranteed remotely erased.
5. Create local projection, file, search, outbox, and conflict records; inspect
   IndexedDB and confirm no usable plaintext or exportable local key exists.
6. Lock/remove the local key handle; ciphertext and pending work remain, local
   use reports protected-storage failure, and reauthorization does not delete
   old rows.

## Server encryption and integrity

1. Persist a page name/document, relationship details, revision snapshot, file
   bytes/metadata, and search/index payload.
2. Inspect PostgreSQL/blob storage: no protected value is usable plaintext;
   only the routing metadata allowed by `data-model.md` remains visible.
3. Restart with missing, wrong, revoked, or malformed deployment key; expect
   readiness failure or safe protected-data error, never empty/partial data.
4. Flip an envelope byte, tag, AAD identity, or generation; expect an
   integrity failure and redacted audit event.

## Recovery and rotation

1. Export a kit and inspect its header for format, installation, kit ID, epoch,
   and supported generations without revealing key bytes. Confirm it is not
   written to workspace/blob storage automatically.
2. Restore a compatible empty/provisioned DB with the deployment secret and
   valid kit; owner access returns and all feature-001 workspace/item/revision/
   placement/file/mutation IDs are unchanged.
3. Reject malformed, wrong-passphrase, cross-installation, superseded, and
   revoked kits before presenting protected content.
4. Replace a kit after recent authentication; old kit is revoked, epoch
   advances, and the new kit contains only documented historical generations.
5. Start scheduled/emergency rotation, inject interruption before preparation,
   after each record checkpoint, during commit, and after completion. Reopen
   and expect the prior complete state or the same resumable checkpoint.
6. Verify new writes use the new generation, old data is decrypt-only during
   transition, and revoked generations cannot authorize new access.

## Administrative commands

See [admin-cli.md](./contracts/admin-cli.md).

```text
docker compose run --rm api admin security --help
docker compose run --rm api admin security keys check --format json
docker compose run --rm api admin security integrity verify --format json
docker compose run --rm api admin security diagnostics --redacted --format json
```

For each command test `--help`, valid/invalid input, JSON output, missing key,
and captured logs. Expected: exit status matches the contract; key checks never
print key material; destructive operations make zero changes without
`--confirm` or when `--dry-run` is selected.

## Repository quality gates

```text
pnpm toolchain:check
pnpm format:check
pnpm lint:ci
pnpm shell:check
pnpm typecheck
pnpm test:unit
pnpm test:property
pnpm test:integration
pnpm test:contract
pnpm test:e2e
pnpm build
```

Feature tests join the existing aggregate `quality-gate`; Playwright covers
desktop/mobile and virtual WebAuthn; migrations pass from empty and feature-001
fixtures. This planning guide does not modify branches, application code,
lockfiles, or existing uncommitted changes.
