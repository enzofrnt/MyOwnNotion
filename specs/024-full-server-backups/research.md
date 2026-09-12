# Research: Complete server recovery

Research completed 2026-09-05 through local code inspection and primary
PostgreSQL documentation, including an independent read-only research agent
requested by the Spec Kit planning workflow.

## Complete database, not a content projection

**Decision**: PostgreSQL 18 custom-format `pg_dump`, including all schemas/tables,
large objects, sequences and constraints in the application's one database.
**Rationale**: Current `BackupService` serializes `buildManifest`; unknown tables
and security state fall outside that projection. `pg_dump` can use an exported
transaction snapshot and its custom archive is portable across architectures.
**Alternatives**: A physical PGDATA copy requires cluster/WAL coordination and
same-major physical recovery. `pg_dumpall` includes unrelated databases and
cluster roles outside this installation's ownership.
**Source**: [PostgreSQL pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html).

## Streaming encrypted persistence

**Decision**: Frame the database component, file components and manifest in a
versioned full-backup envelope. Use existing AES-256-GCM primitives with a distinct
full-backup AAD and random nonces; stream bytes into encrypted staging only.
Authenticate all components before admitting them as restore input. Publish with
exclusive temporary files, fsync and atomic rename; retain verified local artifacts.
**Rationale**: Current portable backup first writes plaintext and removes local
staging even after remote failure. Its unbounded whole-archive reader is not
suitable for complete database recovery.
**Alternatives**: Reusing the portable reader/writer would retain those limitations;
relying only on disk encryption violates constitution IV.

## Consistent file boundary

**Decision**: Take a schema-independent PostgreSQL advisory backup lock. Coordinate
mutable upload prefixes under a separate lock acquired before upload row locks;
freeze these mutations while exporting the SQL snapshot and copying their
committed prefixes. Hold the blob-deletion lock through the immutable blob copy.
Writers may continue adding pages and immutable blobs after the snapshot.
**Rationale**: Immutable files written before their SQL references can be copied
after the snapshot, but deleting them or concurrently modifying upload bytes
can invalidate restoration. Extra unreferenced immutable files are safe.
**Alternatives**: Copying arbitrary live files without writer coordination is not
coherent. Locking every page write for the entire backup is unnecessary.

## Guard without current-schema initialization

**Decision**: Inspect catalogues, migration inventory and existing version columns
before invoking `migrate`, `createInstallation` or `getOrCreateWorkspace`. Existing
data requires a verified full backup; an empty database can initialize. Unknown
source version is explicitly V0/unknown. Store a durable external receipt.
**Rationale**: Current `guarded-migration.ts` applies through 0006 before backup,
constructs current repositories and labels unknown sources with the target version.
**Alternatives**: Bootstrapping backup tables first defeats pre-migration protection.

## Restore before security reactivation

**Decision**: Restore authenticated backup bytes into a prevalidated empty target
with `pg_restore --exit-on-error --single-transaction --no-owner --no-acl`, without
`--clean`. Preserve the exact source records for verification; create an explicit
recovery activation boundary that blocks service until historical sessions and
device trust have been reviewed/reset through the existing recovery flow.
**Rationale**: A restore executes source SQL, and old session records are not proof
of current trust. Device identities must remain available for reauthorizing and
reconciling newer offline operations.
**Alternatives**: Live overwrite risks the only working data; silently restoring
all old device authority can reinstate revoked devices.
**Source**: [PostgreSQL pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).

## Production runtime and schedule

**Decision**: Install the pinned PostgreSQL 18 client package from authenticated
PGDG metadata in the actual Bun Debian 13 runtime for amd64 and arm64. The local
pinned Bun image reports Debian trixie. Use explicit `TZ` configuration and a
calendar deadline based on verified complete backups, with five-minute retries.
**Rationale**: The API image currently lacks pg_dump. Current scheduler counts
scheduled attempt creation and cannot catch up before 04:00 after downtime.
**Alternatives**: A Docker socket or host-only pg_dump is not a production path;
a fixed 24-hour interval drifts over daylight-saving changes.
**Source**: [PostgreSQL Debian packages](https://www.postgresql.org/download/linux/debian/).
