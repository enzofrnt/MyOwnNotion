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

## Retain keys across wrapping-key rotation

A wrapping-key rotation rewraps the live SQL root keys. It does not rewrite old
archives, their receipts or activity records. Keep each old deployment key in
private external custody while any archive, recovery artifact or restored
installation still depends on it. Do not destroy A merely because the live
installation now uses B. Retaining A also retains the ability to decrypt those
historical snapshots; rotation does not revoke access to already copied backups.

Maintain a separate inventory by wrapping-key version and fingerprint. Record
`fromVersion`, `toVersion` and `newKeyFingerprint` from the rotation command's
JSON result, and associate retained archive IDs/dates with the applicable
version. For the original key, the existing deployment-key loader's
`fingerprint` identifies its bytes without revealing them. Keep keys and this
custody inventory separately from archive storage, with an offline recovery copy.

Set `MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES` to a JSON array of explicitly
selected absolute secret-file paths, empty by default. The limit is 16 unique
files, 4096 bytes per secret file, 4096 characters per path and 16 KiB of JSON.
Keys must be outside blob and backup storage, including symlink aliases, and
must satisfy the normal deployment-key permissions: owner-only on POSIX or the
existing private Windows ACL checks. An invalid configured file fails closed.
No keys are discovered automatically or saved in SQL/backups. Restart after
changing the configured file list; configured file contents are read on each
operation. New archives, receipts and activity records use only the current key.
Historical reads support listing, inspection, verification, rehearsal, remote
retry and retention. Archive bytes remain immutable; a retried receipt may be
rewritten under the current key. Without its key an old receipt is invalid and
cannot authorize pruning; restore the missing key configuration instead of
manually deleting an archive whose protection is unknown.

The optional tracked Docker override mounts an existing private directory into
both API and migration containers. Populate it outside all data/backup volumes,
make it traversable only by the API's `bun` user and make each key readable only
by that user. Bind mounts preserve host permissions; a mount does not make a
permissive file private. Configure paths, never key material:

```bash
export MYOWNNOTION_BACKUP_HISTORICAL_KEYS_DIRECTORY=/srv/myownnotion-secrets/backup-key-history
export MYOWNNOTION_BACKUP_HISTORICAL_KEY_FILES='["/run/secrets/backup-key-history/wrapping-v1"]'
docker compose -f compose.yaml -f compose.backup-key-history.yaml config --quiet
docker compose -f compose.yaml -f compose.backup-key-history.yaml up -d
```

This mounts the directory read-only, refuses to create a missing host directory
and leaves the current `deployment-key` secret in place. Use the same Compose
file pair for subsequent lifecycle operations. The override is optional; hosts
using another secret manager can explicitly mount the same configured files.

For an actual historical restore, point `MYOWNNOTION_DEPLOYMENT_KEY_FILE`
explicitly at the key that encrypted the chosen archive and use that same key
for activation. `restore full apply` and `activate` do not silently select a key
from the historical list. Mount the secret in a separate administrative
container or select its existing path through that command's environment;
do not replace the live service's current key just to perform the restore.

The SQL dump preserves its own historical root-key envelopes. The restored
application must start with the wrapping key matching those envelopes, normally
the same historical key A. If a backup overlapped an operational wrapping-key
cutover, the outer archive key and the dump's wrapping version may differ;
retain both versions and select the dump's wrapping key before opening the
restored application. Do not run a scheduled/manual backup during that cutover:
stop the API/scheduler and other writers, finish rotation, replace the current
secret, configure retained history and restart before creating the B backup.
Validate both the restored file bytes and protected record/root-key access
before retiring any recovery material. A byte-level restore rehearsal alone
does not establish that all historical SQL key envelopes can be reopened.

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
