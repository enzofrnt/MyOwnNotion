# Contract: Administrative Commands

Four commands, run from the Compose environment. Implements FR-027 to FR-029.

They follow the shape feature 002 established for the security commands — built-in
help, a reliable exit code, a non-interactive mode — so an operator who has used
one has used all of them.

## `backup run`

Produces a backup now, verifies it, transfers it, verifies it again.

```
myownnotion backup run [--destination <name>] [--json]
```

| Exit | Meaning |
| --- | --- |
| 0 | produced, transferred and verified at both stages |
| 1 | produced but not verified, or not transferred — the backup exists and is not to be trusted |
| 2 | not produced |

**1 is distinct from 2 on purpose.** An operator scripting this needs to know
whether there is an artefact to investigate or nothing at all, and a single
non-zero code would make them look for a file that may not exist.

## `backup verify`

Re-checks a backup that already exists, at the destination.

```
myownnotion backup verify [--id <backup-id>] [--latest] [--json]
```

Exit 0 when the named backup passes; 1 when it fails; 2 when it cannot be found.
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

Exit 0 on a full restore, 1 when the restore failed, 2 when the backup could not
be read at all.

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
exists for the version being left. Exit 0 always: this command answers a
question, and an operator asking "where am I" should not have to interpret an
exit code to find out.
