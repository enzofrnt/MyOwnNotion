# Backup, restoration and update safety

The backup archive reuses the canonical export instead of defining another
model of the workspace. Items, hierarchy, relationships, revision lineage and
owner settings therefore have one portable representation; file bytes are
added by digest beside that representation. The whole archive is sealed before
the destination receives it, so no readable manifest or content name is stored
at the provider.

Operational pages add a second payload, not a second source of truth:
`page-operations.json` contains the Loro checkpoints, retained update log,
device frontiers and ambiguities required for causal convergence, while the
canonical export remains their readable deterministic projection. Both are
captured in one repeatable-read transaction and the backup is refused if
replaying the operational state does not reproduce the canonical digest.

Verification happens twice for different reasons. The first check reads the
staged sealed object back from disk. The second reads the transferred object
through the destination boundary. Only the second proves that the durable copy
is the one that was sent, and only a passing second check counts for retention,
the 26-hour warning, restoration or an update.

That same destination read-back is the only event allowed to mark an exact
operational checkpoint as backed up. Compaction requires this durable evidence,
the visible-history boundary and every still-authorized device frontier; age or
absence alone never authorizes deletion.

## Why a rehearsal writes

A dry run proves that an archive can be parsed. It cannot reveal a foreign-key,
ordering or schema failure that occurs while writing. A test restoration
therefore creates a disposable PostgreSQL database and a disposable blob root,
applies the reviewed migrations, restores every row and file with the same
writer used by a destructive restore, and drops both afterwards. The live
database is never selected as the target, which makes isolation structural.
For operational pages the rehearsal also rebuilds their encrypted causal state,
projects it, and checks that an archived device identity can be represented;
the destructive path retains the real authorization inventory so a device that
was offline during restoration can still send its newer branch.

The owner-facing backup screen keeps two facts separate: when a backup last
verified at its destination, and when a restoration was last rehearsed. The
rehearsal action is safe to expose there because it can only target the
disposable environment. Destructive restoration remains a host-local command.

## Where the update guard lives

The guard wraps the migration runner, before pending migration SQL is read. The
Compose one-shot migration job and `bun run db:migrate` both use that wrapper, so a
second entrypoint cannot silently bypass it.

Migration `0006_installation_application_version` bootstraps the columns and
backup records the guard itself needs. That one introduction can be applied to
an older installation with no recorded application version. Every migration
after it requires a verified `pre-update` backup. Once migrations finish, the
runner checks that none remain, refuses an unfinished restoration, validates a
fresh canonical export, and only then records the new application version and
the matching previous-version backup.

The API healthcheck supplies the deployment-level half of the success decision:
the migration job must finish and the API must subsequently report healthy
before Compose starts dependent services.

## Interrupted destructive restoration

A restoration attempt is inserted before any live write and finished only
after the restore transaction commits or fails. A row left unfinished makes
`/health` return 503 with the backup and attempt identifiers. Recovery is to fix
the cause and re-run the same backup, or return to the safety backup taken by
the preflight. The installation is never presented as healthy merely because
the process restarted.
