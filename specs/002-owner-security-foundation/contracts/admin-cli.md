# Administrative CLI Contract

The command runs inside the API Compose container:

```text
docker compose run --rm api admin <group> <command> [options]
```

It is an operational interface, not a second application identity. It uses the
external deployment secret, emits redacted output, and never accepts a
password, passphrase, deployment key, recovery-kit secret, or encryption key
as a command-line argument.

## Global options and output

```text
--help                  Show help and exit 0
--format text|json      Select human or machine-readable output
--non-interactive       Refuse prompts; required for automation
--dry-run               Validate/report planned changes without mutation
--confirm               Required for destructive changes
--correlation-id UUID   Optional caller correlation ID
```

JSON success is `{ok:true,command,summary,correlationId,result}`. JSON failure
is `{ok:false,command,code,message,correlationId}`. All fields pass the same
recursive redaction rules as audit events.

| Exit | Meaning |
| ---: | --- |
| 0 | Success |
| 2 | Usage or validation error |
| 3 | Missing/invalid external key or configuration |
| 4 | Integrity or migration failure |
| 5 | Refused: confirmation missing or policy forbids action |
| 6 | Conflict/in-progress operation |
| 7 | Unexpected internal failure (still redacted) |

## Commands

| Command | Contract |
| --- | --- |
| `security status` | Read-only state, schema, owner readiness, active generation number, recovery readiness, and rotation status; never key bytes |
| `security password reset --stdin` | Protected stdin/TTY password; `--confirm`; revokes all sessions; does not change owner or encryption keys |
| `security sessions revoke --all` | `--confirm`; revokes all owner sessions |
| `security sessions revoke --session-id UUID` | `--confirm`; revokes one session |
| `security keys check` | Reports availability/algorithm/generation only; exits 3/4 on failure |
| `security integrity verify` | Verifies schema, envelopes, tags/AAD, and canonical references; exit 4 on failure |
| `security rotate --mode scheduled|emergency` | `--dry-run` then `--confirm`; resumable operation ID |
| `security rotation inspect --operation-id UUID` | Read-only phase, cursor/counts, safe failure code |
| `security recovery inspect --kit-file PATH` | Validates header/schema/digest without printing secrets |
| `security recovery import --kit-file PATH --passphrase-stdin` | Compatible deployment key plus `--confirm`; restores existing owner/key access and never creates an owner |
| `security repair --operation NAME` | Documented repairs only; always supports `--dry-run`; destructive repair needs `--confirm` |
| `security compatibility` | Read-only supported schema/artifact/generation compatibility |
| `security diagnostics --redacted` | Versions, migration/health, rotation/recovery status, safe counters only |

Help works without a deployment key. Password/passphrase input is accepted only
from a TTY, protected stdin, or permission-checked file descriptor; never argv,
ordinary logs, or the database.

## Destructive-operation rule

Without `--confirm`, a destructive command exits 5 and changes nothing. With
`--dry-run`, it exits 0 with a plan and changes nothing. Failed preconditions
preserve the last complete or resumable state. Every attempted operation emits
a redacted `admin` audit event.
