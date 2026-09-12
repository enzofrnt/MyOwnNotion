# Data model: Complete backups

## Full manifest, format version 1

Identity: format, formatVersion, backupId, createdAt, reason (manual/scheduled/pre-update),
source installation identity. Durable lineage records remain inside the complete
SQL dump. Provenance: source applicationVersion (nullable),
derived display label (V0/unknown when absent), known commit/image (nullable), PostgreSQL
server version and applied migration identifiers. The archive framing carries
its own format version; encrypted record formats are preserved in the complete
database dump. Historical schemas do not record migration-file checksums, so
none are inferred from the newer checkout. Client-tool major compatibility is
checked before capture and restoration. Components: kind, relative safe name, byte length,
SHA-256 of plaintext and authenticated encrypted framing identity.

Files retain paths relative to the configured blob root and validated immutable
identity, or upload identity plus committed prefix length. No absolute source
path, external key, credential URL or private content enters exposed metadata.

## Outcome receipt

Backup identity, reason, createdAt, verifiedAt, sourceVersion, archiveBytes,
archiveSha256, remote state and remoteVerifiedAt. A receipt only describes a
locally verified artifact; remote state is not-configured/pending/verified/failed.
The separate encrypted backup activity records startedAt, finishedAt, outcome
(running/succeeded/failed) and nullable backupId. A persisted running activity is
displayed as unfinished, never inferred to still be running after a restart.
Writes are atomic. A final archive remains independently verifiable if its
receipt is lost, and a receipt without matching artifact bytes is not protection.

## Restore attempt

The encrypted target marker contains backup identity, format version, target
database name/OID/cluster identity, and incomplete/data-restored stage. Its
presence prevents service startup. Reactivation does not change the archive;
it invalidates restored session/bootstrap/download authority and records the
explicit device security transition before removing the barrier.
The separate encrypted rehearsal activity uses startedAt/finishedAt/outcome and
backupId, independent of the portable in-database restoration catalogue.

## Schedule

Configured IANA zone and hour, most recent due calendar deadline, most recent
verified complete backup, last failure/attempt. Receipts survive restart;
interprocess locks are ephemeral and released by PostgreSQL on process death.

## Installed build provenance

Migration `0014_full_backup_provenance` adds nullable `application_commit`,
`application_image` and `previous_full_backup_id` to installations. The latter
references the independent archive identity, without a foreign key into the
portable backup catalogue. Legacy `previous_backup_id` remains portable-only.
Installed build fields change only after successful guarded migrations and
integrity checks; historical missing values remain unknown.
