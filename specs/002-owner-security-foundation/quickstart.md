# Quickstart Validation: Owner Security Foundation


> **Chaîne actuelle (feature 019, livrée)** : Bun 1.4.0 exclusivement. Installer
> avec `bun ci` et orchestrer avec `bun run`. Les mentions de pnpm ou Node.js
> plus bas décrivent l'époque de construction de cette feature ; elles ne sont
> plus la procédure à exécuter. Guide vivant :
> [`docs/development.md`](../../docs/development.md).

This is a runnable validation guide, not an implementation recipe. It records
expected checks and points to the contracts, model, and empty evidence ledger.
Do not mark a scenario passed until its raw evidence is recorded in
`specs/002-owner-security-foundation/validation.md`.

## Prerequisites

- Node.js `>=24.0.0 <25`, pnpm `10.33.3`, Docker Engine with Compose, and a
  passkey-capable browser.
- A disposable PostgreSQL and file-storage volume. Never use a real workspace
  or real deployment secret for these checks.
- A generated test deployment wrapping key supplied through a mounted secret;
  do not put it in `.env`, argv, logs, or an image layer.
- Install dependencies with `pnpm install --frozen-lockfile`.

## 1. Validate contracts and static plan artifacts

```sh
pnpm format:check
pnpm exec tsx tests/contract/security-artifacts.schema.spec.ts
pnpm exec vitest run tests/contract/security-api.spec.ts tests/contract/admin-cli.contract.spec.ts
```

Validate `contracts/security-api.openapi.yaml` as OpenAPI 3.1, every `$ref`,
request/response schema, cookie rule, and error code. Validate
`contracts/security-artifacts.schema.json` as JSON Schema 2020-12. Contract
tests must cover bootstrap capabilities, kit download/confirmation,
passkey-enrollment completion, recovery import, both rotation kinds, migration
status, and safe transition errors.

## 2. Start the official local stack

```sh
cp .env.example .env
docker compose config
docker compose up -d --wait
pnpm db:migrate
curl --fail http://127.0.0.1:${MYOWNNOTION_API_PORT:-3001}/health
```

Expected: `api`, `web`, `postgres`, and durable `file-store` are healthy;
published ports bind only to `127.0.0.1`; data survives replacing API/web
containers. Confirm the deployment secret is mounted, absent from `docker
inspect`, logs, image history, and `.env`.

For development-only local HTTP, set the explicitly named
`MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1`. Test that a request with both a
loopback listener and trusted loopback HTTP origin receives only the separate
non-`__Host-` `mn_dev_session` cookie without `Secure`; an HTTP request with a
non-loopback listener or trusted origin must receive neither development nor
production cookies.
Production acceptance must run behind HTTPS and require the Secure
`__Host-mn_session` cookie; it must never use `mn_dev_session`. See
`docs/deployment/reverse-proxy.md` for external nginx, Caddy, and Traefik
examples.

## 3. Validate bootstrap without a session

Use this canonical transition table when recording every attempt:

| Attempt state | Scope and committed counts | Allowed transition / result |
| --- | --- | --- |
| `started` | Attempt only; no owner/workspace rows; `0/0`; installation `uninitialized` | Start one serialized attempt; credential challenge may run |
| `credential-verified` | Attempt-scoped verified credential material only; no owner/workspace rows; `0/0` | Valid credential verification; provisional records may be prepared |
| `recovery-prepared` | Attempt-scoped pending credential, kit, and download capability; no owner/workspace rows; `0/0` | Prepare one provisional kit and one 15-minute opportunity |
| `download-consumed` | Same attempt-scoped material; no owner/workspace rows; `0/0` | One successful download consumption; offline confirmation is still required |
| `confirmed` | Atomic promotion commits the sole owner credential and owner, binds the existing feature-001 workspace, activates/confirms the kit, sets installation `ready`, and changes counts to `1/1` | Only successful download consumption plus explicit offline confirmation |
| `abandoned` | Attempt-scoped records only; no owner/workspace rows; `0/0` | Expired/cancelled attempt that is not eligible for confirmation |
| `rejected` | Attempt-scoped rejected/expired material only; no owner/workspace rows; `0/0` | Invalid, expired, replayed, or otherwise refused attempt; regeneration remains attempt-scoped |

Do not introduce a combined recovery-confirmation state.

1. Reset the disposable installation to `uninitialized` and provide the valid
   mounted wrapping secret.
2. Start bootstrap and complete the passkey challenge. Confirm that the
   response contains only the opaque attempt capability and no session cookie.
3. Complete credential verification. Record the internal transition through
   `bootstrapState=credential-verified`; expect the response at
   `bootstrapState=recovery-prepared`,
   `authorizationState=provisional`, `deliveryState=downloadable`, a recovery
   artifact reference, and a download expiry exactly 15 minutes after the
   controlled test clock.
4. Download once. Replay the download token and confirm it is refused.
5. Confirm offline storage. The confirmation response must explicitly expose
   `bootstrapState=confirmed`, `installationState=ready`, `ownerCount=1`,
   `workspaceCount=1`, `authorizationState=active`, and
   `deliveryState=confirmed`. This is the only ownership-commit transition.
6. Repeat concurrently and after restart at each bootstrap checkpoint.
7. Let a provisional download expire or simulate loss before confirmation;
   verify the prior artifact reaches `authorizationState=rejected` and
   `deliveryState=expired`, then call
   `POST /v1/bootstrap/{attemptId}/recovery/regenerate` with the same valid
   `X-Bootstrap-Capability`. Verify the new artifact is provisional with a
   fresh 15-minute window, the prior delivery remains rejected/expired, and
   owner/workspace counts remain zero until the original confirmation commit.
8. Remove or corrupt the deployment secret and repeat; expect safe refusal and
   no partial owner/workspace.

The bootstrap endpoints and capability constraints are defined in
`contracts/security-api.openapi.yaml`; state transitions are in
`data-model.md`.

## 4. Validate owner credential management

1. With an owner session, call `GET /v1/auth/passkeys` and verify every result
   is a redacted `PasskeyView`.
2. Complete the existing passkey options/completion flow and verify both
   mutation calls require the owner session cookie, `X-CSRF-Token`, and recent
   authentication.
3. Remove one selected passkey with
   `DELETE /v1/auth/passkeys/{credentialId}`; verify the final usable
   credential cannot be removed.
4. Set/change the password with `PUT /v1/auth/password`; verify the response
   is the redacted `PasswordView`, not password material or a hash.
5. Repeat each mutation with a missing/mismatched CSRF token, no session, and
   stale recent authentication; expect refusal. Verify no hosting-admin HTTP
   credential operation exists and the local CLI never creates a browser/API
   session.

## 5. Validate authentication and session protection

1. Complete passkey enrollment using the enrollment challenge and its explicit
   completion endpoint. Sign in with passkey alone.
   Verify the authenticated-session `csrfToken` is returned in the response and
   only echoed as the CSRF request header; neither the bootstrap capability nor
   this token appears in a URL, log, or persistent plaintext.
2. Configure the password alternative and sign in with password; test wrong
   credentials for identical safe failure shape.
3. With a controlled clock, test 1-minute and 90-day inactivity bounds and the
   default 30-day expiry. Test sensitive-operation recent-auth bounds of 1 and
   60 minutes around the default 15-minute threshold.
4. Revoke one session and all sessions; verify private access and renewal fail.
5. Attempt a sensitive route with a missing/mismatched CSRF token and with a
   non-loopback HTTP origin. Expect refusal without private-data disclosure.

## 6. Validate the local CLI boundary and compatibility inspection

Run the exact protected local command from the host that owns the installation:

```sh
myownnotion security compatibility inspect --target PATH --source PATH --json
myownnotion security compatibility inspect --target PATH --source PATH --json --dry-run
```

`--target` and `--source` are required filesystem paths; `--json`,
`--dry-run`, and root/command `--help` are supported. The command reads local
encrypted metadata and emits only `status`, `code`, `correlationId`, source
lineage/format/version, compatibility result, and a redacted identity digest.
It never prints passphrases, kits, keys, content, tokens, or raw errors, never
creates or refreshes a browser/API session, and has no HTTP or remote
administrator equivalent. `--dry-run` performs all validation without writes;
normal execution requires explicit confirmation for an adoption-capable
operation and is allowed only for an empty/uninitialized target. Expect exit
`0` for compatible, `2` for argument/schema errors, `3` for incompatible or
protected refusal, `4` for unavailable key material, and `5` for integrity or
recovery verification failure.

## 7. Validate encrypted server/local data

1. Seed representative feature-001 pages, properties, relationships, files,
   history, indexes, and pending local operations.
2. Inspect PostgreSQL rows, blobs, local storage, logs, diagnostics, and image
   layers. After migration completion, find zero usable plaintext values in all
   FR-011/FR-012 categories.
3. Read with missing, wrong, corrupt, revoked, and unauthorized key material.
   Expect fail-closed errors, no partial data, and no substituted empty value.
4. Verify envelope format, generation, AAD, nonce uniqueness, tag, and digest
   with the JSON Schema contract.

## 8. Validate devices and reauthorization

1. Authorize two devices and inspect all inventory fields. Before either event,
   verify persisted `last_activity_at` maps to required API `lastActivityAt`,
   and persisted `last_sync_at` maps to required API `lastSyncAt`; both API
   fields must be explicitly `null`.
2. Rename and change a limit; compare feature-001 local projection and outbox
   IDs before/after.
3. Revoke one device. Verify sign-in, renewal, new-data delivery, and sync-key
   use are refused. Display the explicit unreachable-device erasure limit.
4. Complete compatible recovery and verify every prior device is
   `reauthorization-required` until an explicit new authorization succeeds.

5. Record one real activity and one successful synchronization event; verify
   the persisted `last_activity_at`/`last_sync_at` and returned
   `lastActivityAt`/`lastSyncAt` timestamps are populated from those events and
   are not changed by an inventory read, rename, limit update, or revocation.

## 9. Validate recovery-kit replacement and recovery import

1. With a recent owner session, create an authenticated replacement kit.
2. Confirm the existing `active/confirmed` kit remains valid before
   replacement download/confirmation. Download once; replay is refused.
   Confirm offline storage and verify atomic epoch advancement, replacement
   `active/confirmed`, and old-kit `superseded/confirmed`.
3. Import a valid kit and encrypted source into an empty target. Compare
   installation, lineage, owner, workspace, canonical content, history, file,
   and mutation identity manifests exactly.
4. Try malformed, wrong-lineage, revoked, prior-epoch, and initialized targets;
   verify no merge, overwrite, second owner, or partial recovery.

## 10. Validate the two rotation policies

Use a controlled clock and separate operation IDs.

- Wrapping-key operation: due at 365 days, warning through 7 calendar days,
  write-block at due plus 7 days, emergency at zero grace. Verify only root-key
  wrapping changes and record ciphertext does not.
- Data-key operation: use its configured due/write-block policy. Verify new
  writes use the permitted generation and existing records/chunks progressively
  re-encrypt with resumable cursors.

For both: run startup and daily checks; test exactly pre-due, due,
overdue-within-grace, emergency, write-block, in-progress, complete, and failed,
plus interruption, restart, safe reads,
explicit admin trigger, conflict, and unavailable-secret behavior.

## 11. Validate migration fault checkpoints

Start from a feature-001 plaintext fixture and inject a restart/failure:

1. before backfill;
2. during backfill;
3. after verification;
4. after plaintext-write stop;
5. during encrypted-read cutover;
6. during scrub/drop cleanup.

At every checkpoint, assert a recorded safe state, preserved source until the
verification gate, no premature `complete`, and no mixed read/write mode.
After completion, compare counts, deterministic digests, IDs, SQL columns, and
blob remnants.

## 12. Validate delivery and release gates

Run the complete local gate:

```sh
pnpm checks:local
```

This command is required before every branch push and mirrors all
repository-controlled pull-request jobs. Targeted tests do not replace it. A
local runtime incompatibility must use the equivalent path documented in
`docs/development.md` (including containerized Firefox on macOS); an
unavailable required gate blocks the push.

Inspect `.github/workflows/ci.yml` and `.github/workflows/release.yml`. `ci.yml`
must be the single quality-gate workflow. It triggers directly on every
`pull_request` and every `push` to `main`, on `workflow_dispatch` for
diagnostics, and exposes `workflow_call` for version tags; it must not trigger
on a non-`main` branch push. Verify that pushing a work branch with no pull
request starts no run at all.

On a pull-request candidate, confirm that `build-images` builds both
`linux/amd64` and `linux/arm64` from locked dependencies and pinned base
digests, that `container-vulnerability-scan` runs on the result, that nothing is
pushed to any registry, and that the run holds no `packages: write` permission.

On a `push` to `main`, confirm that the same gate jobs run and that
`publish-commit-images` declares `needs: quality-gate`, is guarded by
`github.ref == 'refs/heads/main'` and gate success, is the only job granted
`packages: write`, and publishes immutable commit-addressable images to GHCR in
the same run as the gate — so no second gate execution and no `workflow_run`
trigger is involved.

`release.yml` must trigger only on strict `vMAJOR.MINOR.PATCH` version tags and
no longer on `main`. Its first job must call `./.github/workflows/ci.yml` at the
tag commit; publication jobs must depend on that `quality-gate` job, and release
must verify the reusable output `candidate_sha == github.sha` using its own run
context. Missing, skipped, cancelled, failed, stale, or different-SHA gate
results publish nothing. The protected-branch required-check context remains the
single `quality-gate` check.

The release candidate must also retain raw output for a rollback evidence row:
current and prior immutable image refs/digests, pre/post persisted-data digest,
Compose image selection, health, rollback result, candidate SHA, raw artifact,
reviewer, and date. This validates image selection and recovery of a compatible
prior image; it is not full update orchestration.

Run and record these security jobs separately for the exact candidate:

| Job | Command | Blocking rule | Artifact |
| --- | --- | --- | --- |
| `dependency-vulnerability-audit` | `pnpm audit --audit-level=high --prod` | High/critical or unavailable audit blocks | `dependency-audit.json` |
| `secret-scan` | `pnpm security:secrets` | Any detected secret or failure blocks | `secret-scan.sarif` |
| `static-security-analysis` | `pnpm security:static` | High-confidence finding or failure blocks | `static-security.sarif` |
| `container-vulnerability-scan` | `trivy image --severity HIGH,CRITICAL --exit-code 1` before publication | High/critical or failure blocks | `container-scan.sarif` |
| `license-policy` | `pnpm security:licenses` | Denied license, missing attribution, or failure blocks | `license-policy.json` |

The aggregate gate must fail on failed, missing, skipped, cancelled, stale, or
artifact-less results. Third-party actions used for these jobs are pinned by
full commit SHA in implementation. `workflow_dispatch` invokes this same gate
for diagnostics only and cannot publish images or release artifacts.

## 13. Validate structured container logging

Run the focused contract suite, then inspect both output modes:

```sh
bun run --bun vitest run --project api-contract apps/api/tests/logging.spec.ts
MYOWNNOTION_LOG_COLOR=always bun run --filter @myownnotion/api dev
docker compose up -d --build api web
docker compose logs api
MYOWNNOTION_DEV_LOG_COLOR=auto docker compose up -d --force-recreate api
docker compose logs --no-color api
```

The interactive process and the local Compose override must show compact
colored levels. After recreating it in automatic mode, every API line must be a
parseable JSON object without ANSI escape sequences and must arrive through
the container standard streams; the Compose contract separately verifies that
the official `compose.yaml` keeps this mode as its default. Exercise one request
and one safe failure; confirm request ID, method/path, status, level, timestamp,
service, environment, and message remain useful while bodies, authorization,
cookies, credentials, tokens, private names/content, and key material do not
appear. Repeat with `MYOWNNOTION_DEV_LOG_COLOR=never` to verify explicitly
ANSI-free JSON and with an invalid value to verify startup refusal.

## Evidence handoff

Record commands, commit SHA, clock values, fixtures, raw counts, digests,
participant/operator IDs, failures, artifacts, and final status in
`validation.md`. The acceptance formulas for SC-002 and SC-008 are normative
there; do not substitute narrative claims.
