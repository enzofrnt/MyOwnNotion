# Operations CLI Contract

The operations image has one entry point: `node dist/cli.mjs <group> <command> [options]`. It emits one bounded JSON result to stdout and redacted diagnostics to stderr. Free-form child-process output is never forwarded.

## Exit codes

- `0`: command completed and all requested verification passed.
- `2`: invalid command, missing protected configuration, or invalid option.
- `3`: another backup/restore/storage migration owns the operation lock.
- `4`: preflight failure such as non-empty restore target or incompatible manifest.
- `5`: integrity failure such as missing object or digest mismatch.
- `6`: external dependency failure such as PostgreSQL, object storage, restic, or rclone unavailable.
- `7`: completed restore target remains guarded because apply or verification failed.

## Safe result envelope

```json
{
  "operationId": "019...",
  "command": "backup.create",
  "status": "succeeded",
  "startedAt": "2026-08-08T00:00:00.000Z",
  "finishedAt": "2026-08-08T00:00:10.000Z",
  "snapshotId": "0123456789abcdef",
  "counts": { "objects": 3, "bytes": 42 },
  "failureCode": null
}
```

The envelope never contains database URLs, passwords, remote configuration, object locators, filenames, file/page content, document bodies, relationship metadata, or captured command lines.

## Commands

### `storage audit [--limit <count>]`

Read-only. Compares current verified content rows with private object storage, re-hashes objects, classifies missing/mismatched/unreferenced/temporary findings, and returns counts. The default report limit is 100; `--limit 0` returns counts only. It never deletes or updates.

### `storage migrate-filesystem [--confirm]`

Dry-run by default. With `--confirm`, copies each canonical legacy filesystem object through the object adapter, verifies it, and changes that content row's locator in one transaction. Repeated confirmed runs are idempotent. It never copies unreferenced files or removes the legacy volume.

### `backup create`

Acquires exclusive operation and repository locks, exports a synchronized PostgreSQL snapshot, stages and verifies exactly referenced objects plus manifest, creates an encrypted restic snapshot, checks it, tags it `myownnotion-complete`, and writes success status. Any failure omits the complete tag and records a safe failure code.

### `backup list`

Lists only `myownnotion-complete` snapshots as stable IDs, timestamps, and bounded counts. It never lists paths or object names.

### `backup check [--read-data]`

Runs repository structure verification; `--read-data` explicitly requests complete pack-data verification. Non-zero restic results become exit code 5 or 6 and a safe failure code.

### `backup status`

Returns the last atomically persisted backup state, snapshot identity when complete, bounded counts, and a safe failure code. It never returns repository configuration, paths, captured output, or content.

### `backup prune [--dry-run|--confirm]`

`--dry-run` is the default. Computes retention for complete snapshots using 7 daily, 4 weekly, and 12 monthly groups. Only `--confirm` may execute forget and prune. It refuses ambiguous or empty policies.

### `backup schedule`

Long-running optional scheduler. Runs once at the configured UTC time per day, delegates to the same `backup create` implementation, and relies on exclusive locks to skip overlap. Invalid schedule configuration stops with exit code 2.

### `restore verify --snapshot <id>`

Read-only for targets. Requires the complete tag, restores into ephemeral staging, validates manifest/schema/tool compatibility, database dump digest, every object digest/length, and restic repository state. Returns compatible counts or a safe preflight/integrity error.

### `restore apply --snapshot <id> --confirm-empty`

Runs all verify steps, proves the database and bucket are empty, writes the persistent restore guard, applies database and objects, re-verifies counts/digests, and removes the guard only on success. Missing confirmation is exit code 2; a non-empty target is exit code 4. Failure after guard creation is exit code 7 and deliberately preserves the guard.
