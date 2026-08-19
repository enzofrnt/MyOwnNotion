# Contract: Administrative Commands

Four commands, run from the Compose environment. Implements FR-027 to FR-029.

They follow the shape feature 002 established for the security commands — built-in
help, a reliable exit code, a non-interactive mode — so an operator who has used
one has used all of them.

## Exit codes

**The table feature 002 established, not a new one.** A second vocabulary inside
one CLI is how an operator learns that exit codes cannot be trusted, so these
commands reuse the existing meanings rather than numbering their own failures.

| Code | Name | Used here for |
| --- | --- | --- |
| 0 | ok | it worked |
| 2 | usage | the caller named a backup that does not exist, or misused a flag |
| 3 | refused | a precondition said no: an incompatible version, a missing confirmation |
| 4 | keyUnavailable | the material needed to read or write the archive is not there |
| 5 | integrityFailure | the archive exists and does not match what it claims |
| 7 | unexpected | anything else |

The distinction that matters most is **5 against 7**: an operator scripting a
backup needs to know whether there is an artefact to investigate or nothing at
all, and a single failure code would send them looking for a file that may not
exist.

## `backup run`

Produces a backup now, verifies it, transfers it, verifies it again.

```
myownnotion backup run [--destination <name>] [--json]
```

Exit 0 when both verifications pass. Exit 5 when the archive was produced and
one of them failed — the artefact exists and is not to be trusted. Exit 4 when
the sealing material is unavailable, because that is a mounting problem rather
than a backup problem and an operator should be sent to the right place.

## `backup verify`

Re-checks a backup that already exists, at the destination.

```
myownnotion backup verify [--id <backup-id>] [--latest] [--json]
```

Exit 0 when it passes, 5 when it fails, 2 when the named backup does not exist.
Recording a fresh verification row rather than updating the old one, so a backup
that passed and later failed keeps both facts.

## `restore test`

Rehearses a restoration into a disposable database and drops it afterwards.

```
myownnotion restore test [--id <backup-id>] [--latest] [--json]
```

Not destructive, and therefore needs no confirmation — which is the point of
having it: the safe rehearsal must be the easy one to run. It records a
`restoration_attempt` of kind `test`, which is what the interface reads to say
when the owner last rehearsed.

Exit 0 on a full restore, 5 when the archive could not be read back faithfully,
2 when the backup does not exist.

## `restore apply`

The destructive one.

```
myownnotion restore apply --id <backup-id> [--dry-run] [--yes] [--json]
```

Performs the six pre-flight steps of FR-015 in order — key access, manifest and
archive integrity, version compatibility, scope and date shown, safety backup,
explicit confirmation — and stops at the first that fails, before writing
anything.

`--dry-run` performs every step *except* the writing and reports what would
happen. `--yes` supplies the confirmation for automation. Without either, the
command reads the confirmation from the terminal and refuses to proceed if there
is none: a destructive command that assumes consent when it cannot ask is a
command that will eventually be run by a cron job nobody remembers writing.

## `version inspect`

```
myownnotion version inspect [--json]
```

Reports the running application version, the recorded installation version, the
schema version, whether a migration is pending, and whether a verified backup
exists for the version being left. When an update has occurred, it also reports
the exact immutable previous image tag, the matching backup id, and that
backup's schema and encrypted-record format versions. Exit 0 always: this
command answers a question, and an operator asking "where am I" should not have
to interpret an exit code to find out.
