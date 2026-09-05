# Backup, restoration and update safety

## Complete server recovery

Feature 024 makes complete backups the source of nightly and pre-migration
protection. A PostgreSQL 18 custom dump contains the entire application database:
reviewed and historical tables, indexes, constraints, sequences, owners, sessions,
key envelopes, operational page state and migration inventory. This is a logical
backup of one database, not a physical copy of PGDATA, other databases or global
server roles.

The archive also contains every durable content-addressed blob and precisely the
committed prefix of each partial upload. A database-local advisory lock holds
upload mutations before their row locks; the backup acquires it before opening
an exported repeatable-read snapshot. File capture and `pg_dump --snapshot` see
one consistent point. Upload finalization and prefix deletion cannot invalidate
that capture. Physical blob garbage collection must hold the shared deletion
lock through deletion. No runtime blob deletion path currently bypasses it.

Components and their inventory are authenticated separately with AES-256-GCM.
Only ciphertext is staged; the inventory identifies source application version,
commit/image when recorded, PostgreSQL version, applied migrations, component
paths, sizes and SHA-256 hashes. An unrecorded historical version is explicitly
`V0 — version exacte inconnue`, never the version being installed. Historical
migration checksums are not invented when the source ledger did not store them.

Local publication uses an exclusive, fsynced, fully verified archive followed by
atomic publication and an encrypted receipt. A remote transfer happens afterwards
and is read back independently. Remote failure keeps the verified local copy and
is retried separately. Local protection does not imply survival of server loss.
The archive is self-contained: inspection and restoration need its file and the
separately retained deployment key, not the application backup catalogue.

Encrypted activity records describe successful, failed and unfinished attempts;
they cannot qualify as a verified backup. A missing or changed archive does not
satisfy the 26-hour protection deadline, even with a valid receipt. Retention keeps
the newest verified local copy regardless of age and refuses to prune a configured
remote copy when its deletion fails. Incomplete staging left after interruption
is cleaned under the exclusive run lock; published recovery files remain intact.

## Nightly runs and migrations

The scheduler checks a named IANA time zone, default UTC, and a local hour,
default 04:00. It catches up at startup, including before today's deadline when
yesterday's was missed, and retries every five minutes after failure. DST does
not create a second daily deadline. A database-local run lock serializes manual,
nightly, remote-maintenance and migration operations; scheduled calls recheck
the verified deadline after obtaining it.

The migration wrapper inspects system catalogues before any current-schema
initialization. A nonempty source with pending SQL or a changed application
version must first produce a locally verified complete archive. There is no
bootstrap exception for migration 0006. A failed backup leaves pending SQL and
version records untouched. Empty installations initialize without pretending to
have a previous backup. After migration, canonical integrity and the migration
inventory are checked before recording the target version and previous full
backup identity. Nullable provenance columns arrive in migration 0014.

## Restoration and rehearsal

Every component authenticates before the first target write. Verification owns
a private ciphertext copy so changes to the supplied path cannot alter the
stream between preflight and restore. The target must be an explicitly selected
empty PostgreSQL 18 database and a separate empty file directory. Existing parent
symlinks are resolved when checking separation from active file storage.

An encrypted marker binds a restore to its target database identity and cluster.
It blocks application startup while incomplete and after data restore until
explicit host activation. SQL restores in one transaction; a failure leaves the
marker, never a silently healthy partial installation. Activation preserves device
identities, revokes old sessions, requires fresh authentication and invalidates
bootstrap capabilities and provisional kit downloads. Previously revoked devices
and active recovery kits retain their states. Passwords, passkeys and protected
content remain recoverable; a restored historical session is not trusted.

A rehearsal actually creates an empty disposable database, restores the complete
archive, reads and hashes restored file bytes, then removes the database and
files. The owner can request it through a CSRF-protected endpoint; destructive
restoration remains a host CLI command. The production-image smoke performs this
same recovery with unknown historical SQL, a sequence, a blob and a partial upload.

## Portable exports retained from feature 007

The existing canonical export plus file payload remains available through
`backup run`, `backup verify`, `restore test` and `restore apply`. Operational
exports retain Loro checkpoints, update logs, device frontiers and ambiguities;
their replay must reproduce the canonical digest. Their destination read-back
remains the evidence used by existing checkpoint compaction. Complete backups do
not silently grant new compaction permissions.

Portable recovery has its own catalogue and transactional in-place restore guard.
An unfinished portable restoration still makes health fail and requires its
existing recovery procedure. Portable exports are labeled separately in settings
and never replace the complete nightly, pre-migration or 26-hour safety checks.

See [host recovery commands](../deployment/backups.md) for operator procedures.

## Deployment-key history

Full archives and their authenticated operational records are encrypted with
the deployment key present when written. Wrapping-key rotation changes live
root-key envelopes only. Explicit external historical secret files extend read
authentication for archives, receipts and activity; all writes keep the current
key. Archive verification owns one encrypted copy and selects a key through
manifest authentication before streaming component verification. Remote retry
may update the receipt under the current key but cannot rewrite the archive.
Configuration/secret failures occur before catalogue corruption filtering.

Actual restore/activation keep an explicitly selected deployment key; isolated
rehearsals may receive the configured historical archive keys. No historical
key is inserted into the restored database or used as a fallback for live root
keys. The operator retains keys for both the outer archive and the SQL dump's
root-key wrapping version. See [custody and deployment](../deployment/backups.md).
