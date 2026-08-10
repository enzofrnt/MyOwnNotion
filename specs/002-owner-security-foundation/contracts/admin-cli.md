# Security Administration CLI Contract

The CLI is for the hosting administrator of the one installation. It is not a
second account and does not create a second owner or workspace. Commands emit a
safe envelope only; secrets, content, tokens, recovery artifacts, and keys are
never printed.

This is the only V1 hosting-administrator surface. It is a protected local
process boundary and has no HTTP transport, browser/API session creation,
bearer capability, API token, or remote administrator endpoint. Owner-facing
API status and rotation operations remain owner-session and CSRF protected;
hosting-administrator migration, recovery, and rotation commands are local CLI
operations only, as defined here and in `security-api.openapi.yaml`.

## Invocation and output

```text
myownnotion security <command> [options]
```

Required common behavior:

- `--help` is available on the root and every command.
- `--json` emits one JSON object per invocation; default output is concise text.
- `--dry-run` is supported for destructive or state-changing commands.
- `--yes` is required for destructive execution in non-interactive mode.
- Secret/passphrase input uses protected stdin, a file descriptor, or a mounted
  secret reference; command-line values are rejected.
- Every result includes `correlationId`, `code`, `status`, and `candidateState`
  where applicable. It never includes raw exceptions or sensitive values.

Exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | Completed successfully |
| 2 | Usage or schema error |
| 3 | Protected operation refused (auth, state, target, or policy) |
| 4 | Required key/secret unavailable or invalid |
| 5 | Integrity, migration, or recovery verification failure |
| 6 | Operation is resumable but incomplete/paused |
| 7 | Internal safe failure; inspect correlation ID |

## Commands

| Command | Required behavior |
| --- | --- |
| `security status` | Installation, owner/workspace IDs as safe opaque references, recovery readiness with `authorizationState` and `deliveryState`, both policy states, migration state, and next actions; no secrets/content |
| `security password reset` | Set password alternative through protected input; require explicit confirmation and audit |
| `security sessions revoke [--session-id ID\|--all]` | Revoke one or all sessions; `--all` requires recent owner confirmation or `--yes` |
| `security devices reauthorize --device-id ID` | Start/inspect explicit device reauthorization; never inherit trust during recovery |
| `security keys check` | Verify mounted wrapping-key availability and metadata without displaying key bytes |
| `security integrity verify` | Verify envelope tags, AAD, generation availability, blob digests, and identity manifest |
| `security rotation start --kind wrapping-key\|data-key --mode scheduled\|emergency --reason TEXT` | Explicitly trigger one policy; dry-run or confirmation required; one active operation per kind |
| `security rotation status --operation-id ID` | Show policy, phase, generation/version, cursor summary, counts, checkpoint digest, and safe failure code |
| `security rotation inspect --kind wrapping-key\|data-key` | Show pre-due/due/overdue-within-grace/emergency/write-block/in-progress/complete/failed state, due time, last completion, generation/version, and next action |
| `security migration status` | Show staged migration state, safe checkpoint, counts/digests, and whether plaintext writes/reads are enabled |
| `security recovery inspect` | Inspect kit format, source lineage, epoch, `authorizationState`, `deliveryState`, supported generations, and revocation status; never decrypt to output |
| `security recovery import --source PATH --passphrase-fd FD` | Dry-run/confirm compatible import into an empty target; atomically adopt source identities and require device reauthorization |
| `security compatibility inspect --target PATH --source PATH [--json] [--dry-run]` | Protected local-only compatibility inspection; validates format, source lineage, schema/version, identity digest, and target emptiness without revealing secrets or creating a session |
| `security diagnostics` | Emit redacted environment/configuration summary, version, health, and correlation IDs only |

`security repair` is intentionally not part of this feature's supported surface;
repair belongs to a later operational specification. Backup/restore commands
are also excluded here.

## Compatibility inspection contract

`security compatibility inspect --target PATH --source PATH [--json]
[--dry-run]` is the exact supported compatibility command. Both paths are
required filesystem paths; `--help` is available. It reads local encrypted
metadata only and emits `status`, `code`, `correlationId`, format/version,
source lineage, compatibility result, and a redacted identity digest. It never
prints or persists passphrases, kits, keys, content, tokens, or raw errors.
`--dry-run` performs validation without writes. Non-dry-run execution requires
explicit confirmation for any adoption-capable action and accepts only an
empty/uninitialized target. Exit codes are `0` compatible, `2` usage/schema
error, `3` incompatible/protected refusal, `4` unavailable or invalid key
material, and `5` integrity/recovery verification failure. It has no HTTP
transport, remote administrator API, bearer channel, or browser/API session
creation path.

## Bootstrap transition reference

All pre-confirmation rows are attempt-scoped and `0/0`:

| Attempt state | Scope and committed counts | Allowed transition / result |
| --- | --- |
| `started` | Attempt only; no owner/workspace rows; `0/0`; installation `uninitialized` | Start one serialized attempt; credential challenge may run |
| `credential-verified` | Attempt-scoped verified credential material only; no owner/workspace rows; `0/0` | Valid credential verification; provisional records may be prepared |
| `recovery-prepared` | Attempt-scoped pending credential, kit, and download capability; no owner/workspace rows; `0/0` | Prepare one provisional kit and one 15-minute opportunity |
| `download-consumed` | Same attempt-scoped material; no owner/workspace rows; `0/0` | One successful download consumption; offline confirmation is still required |
| `confirmed` | Atomic promotion commits the sole owner credential and owner, binds the existing feature-001 workspace, activates/confirms the kit, sets installation `ready`, and changes counts to `1/1` | Only successful download consumption plus explicit offline confirmation |
| `abandoned` | Attempt-scoped records only; no owner/workspace rows; `0/0` | Expired/cancelled attempt that is not eligible for confirmation |
| `rejected` | Attempt-scoped rejected/expired material only; no owner/workspace rows; `0/0` | Invalid, expired, replayed, or otherwise refused attempt; regeneration remains attempt-scoped |

Do not introduce a combined recovery-confirmation vocabulary item.

## Recovery state axes

Recovery-kit status is never represented by one mixed `state` field. The
authorization axis is exactly:

| Field | Values |
| --- | --- |
| `authorizationState` | `provisional`, `active`, `superseded`, `revoked`, `rejected` |
| `deliveryState` | `prepared`, `downloadable`, `download-consumed`, `confirmed`, `expired` |

The only valid pairs are exactly:

| authorizationState | deliveryState |
| --- | --- |
| `provisional` | `prepared` |
| `provisional` | `downloadable` |
| `provisional` | `download-consumed` |
| `active` | `confirmed` |
| `superseded` | `confirmed` |
| `revoked` | `confirmed` |
| `rejected` | `expired` |

Bootstrap and replacement kits move from `provisional/prepared` through the
download states to `active/confirmed`. A lost or expired unconfirmed delivery
is `rejected/expired` and can be regenerated; the prior delivery is never
revived. Confirmation of a replacement atomically makes it `active/confirmed`
and the previous kit `superseded/confirmed`. Active confirmed kits do not
expire by age; `expired` applies only to an unconfirmed delivery. Every other
pair, including `provisional/expired`, is rejected.

## Safe transition rules

- A missing/invalid secret returns exit 4 and leaves state unchanged.
- A wrong-lineage, revoked, superseded, malformed, or initialized-target
  recovery import returns exit 3 or 5 as appropriate and leaves the target
  unchanged.
- A rotation conflict returns exit 3; a paused/faulted resumable operation
  returns exit 6 with its safe checkpoint.
- Migration status remains readable in every state. Only its state machine can
  authorize write-stop, read-cutover, and scrub transitions.
- Destructive state transitions require a dry run followed by explicit
  confirmation, are audited, and are idempotent at the operation ID.

## Contract examples (redacted)

```json
{
  "status": "blocked",
  "code": "WRAPPING_KEY_UNAVAILABLE",
  "correlationId": "00000000-0000-7000-8000-000000000001",
  "candidateState": "write-block",
  "nextAction": "mount the configured deployment secret"
}
```

```json
{
  "status": "complete",
  "code": "RECOVERY_IMPORT_COMPLETE",
  "correlationId": "00000000-0000-7000-8000-000000000002",
  "adoptedIdentityManifestDigest": "redacted-digest",
  "devicesRequiringReauthorization": 2
}
```
