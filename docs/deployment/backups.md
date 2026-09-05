# Complete server recovery

The API creates an encrypted complete backup every night and before migration
of a nonempty database. Defaults are 04:00 UTC and 90 days. Configure
`MYOWNNOTION_BACKUP_TIME_ZONE` with an IANA name such as `Europe/Paris`; missed
runs catch up at startup and failed attempts retry every five minutes while the
server is running. A stopped server cannot create a backup until it restarts.

`MYOWNNOTION_BACKUP_ROOT/full/` contains `.monfull` archives and encrypted
verification/activity records. Keep this directory on durable storage outside
`MYOWNNOTION_BLOB_ROOT`. In Compose the backup and original file volumes are
separate. A local volume alone does not protect against loss of the host.
Google Drive copying is optional through the mounted token and folder settings
in `.env.example`; failed transfers preserve local recovery and are retried.

The deployment key file is required to read an archive. Retain a separate copy
of that key and the backup storage; neither is embedded in the other. A full
archive includes authentication records and encrypted application key envelopes.
The source version, commit/image when known, migrations and PostgreSQL version
are authenticated inside it. An unrecorded V0 version is displayed explicitly.

## Create, inspect and rehearse

The image includes PostgreSQL 18 client tools and the same CLI as development:

```bash
docker compose exec api bun dist/admin/admin-cli.js backup full run --json
docker compose exec api bun dist/admin/admin-cli.js backup full list --json
docker compose exec api bun dist/admin/admin-cli.js backup full inspect --file /var/lib/myownnotion/backups/full/ARCHIVE.monfull --json
docker compose exec api bun dist/admin/admin-cli.js backup full verify --file /var/lib/myownnotion/backups/full/ARCHIVE.monfull --json
docker compose exec api bun dist/admin/admin-cli.js restore full test --file /var/lib/myownnotion/backups/full/ARCHIVE.monfull --json
```

Replace `ARCHIVE.monfull` with a listed archive filename. Inspection and
verification do not require the source database catalogue. Listing reports
missing/corrupt files and uncatalogued archives separately; an archive without
its old receipt can still be inspected and restored directly.

The rehearsal creates a disposable database, performs an actual restore and
reads the restored file bytes before deleting its temporary resources. The
database role needs permission to create/drop the disposable database. Settings
offers the same isolated rehearsal to an authenticated owner. A successful
archive verification and a successful restoration rehearsal are separate facts.

## Restore to a new target

Provision an empty PostgreSQL 18 database and an empty, writable file directory
outside the active file tree. The target role must be able to restore the schema
and inspect its database/cluster identity. The official Compose PostgreSQL role
has these capabilities. The CLI refuses the active database, nonempty targets,
and file paths overlapping active storage, including existing parent symlinks.

On the administrative host, set `MYOWNNOTION_RESTORE_DATABASE_URL` through the
environment or mounted operational configuration. Keep credentials out of CLI
arguments. Run the same Bun CLI with the source `DATABASE_URL`, source blob root,
mounted deployment key, readable archive and separate target directory:

```bash
bun run admin -- restore full apply --file /backups/ARCHIVE.monfull --target-directory /recovered-files --dry-run --json
bun run admin -- restore full apply --file /backups/ARCHIVE.monfull --target-directory /recovered-files --yes --json
bun run admin -- restore full activate --target-directory /recovered-files --yes --json
```

In a container, mount the archive, key and new target volume and pass the target
environment variable to the CLI container; use `bun dist/admin/admin-cli.js`
instead of the development command. Never place the new target inside the live
blob volume. The complete archive is authenticated before target writes.

After data restore, `.full-restore-state` blocks application startup. Explicit
activation authenticates this marker against the target database and cluster,
invalidates old sessions and temporary capabilities, and requires fresh owner
authentication. Device identities and already revoked states are retained;
active recovery kits remain valid. Activation does not issue any session or
authorize an old device automatically.

Point the intended compatible application image at the recovered database and
file directory only after activation. If the archive is historical, follow the
normal guarded migration path before serving it. Keep the source and archive
until the recovered application has been checked. A failed restore leaves its
target marked incomplete; investigate it and retry into another empty target.
Deleting the marker manually is not recovery.

## Portable exports

Legacy `backup run` and `restore apply --id …` handle portable content exports,
with their original in-place restore workflow and safety export. They are shown
separately in settings. They do not contain the complete historical server
database and do not satisfy nightly or pre-migration complete-backup protection.


## Protected-storage upgrade and interrupted retirement

The protected-storage transition retains its original pre-update archive identity
until completion. Stop the previous API process before upgrading. The guarded
migration verifies the authenticated receipt and the actual archive, then binds
its encrypted source inventory and per-object checkpoints to that backup. A
restart resumes those checkpoints; it cannot replace missing original evidence
with a newer snapshot of a partially migrated installation. Repair or remount the
original archive and external deployment key, then rerun the same migration
command. Never delete transition rows or change their phase to unblock startup.

Provision space for the complete encrypted source archive, a private archive
verification copy, and encrypted replacements while the readable originals still
exist. Budget at least two copies of the source files in the blob volume during
backfill, plus the archive and verification copy in the backup volume, database
snapshot/WAL growth and normal free-space margin. Compression and deduplication
are not guaranteed capacity savings. Disk or authentication failures leave the
transition incomplete; release space or repair the underlying storage and rerun.
The old application version is not marked successfully upgraded on such failure.

Unreferenced historical files and unacknowledged upload tails are preserved as
protected quarantine contents. Their chunk references and encrypted manifests
survive key rotation and portable workspace replacement; they are included in
complete backups. They have no ordinary page placement and are not automatically
discarded by garbage collection. Retain this recovery inventory while investigating
historical data; removing its database references manually discards that protection.

For a full rollback, restore the original archive into separate empty PostgreSQL
and file targets using the commands above, activate recovery, and use the matching
source application version. Preserve both the interrupted source and its archive
until the recovered installation has been checked. Completed transitions do not
require an ancient archive to remain forever: normal backup retention applies
after completion. SQL neutralization and file retirement do not erase old WAL,
dead PostgreSQL pages, pre-existing archives or storage snapshots; manage those
through the storage system's own retention and access controls.
