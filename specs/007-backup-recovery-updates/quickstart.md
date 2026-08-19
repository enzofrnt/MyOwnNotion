# Quickstart: Backup, Recovery and Updates

How to prove this feature works, by hand, in about ten minutes. Every step here
uses the local destination, so none of it needs an account or a network.

## Prerequisites

```bash
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev
```

Set a destination for the run:

```bash
export MYOWNNOTION_BACKUP_DESTINATION=filesystem
export MYOWNNOTION_BACKUP_ROOT=./.dev-backups
```

## 1. Produce a backup and watch it verify

```bash
pnpm admin backup run --json
```

Expect exit 0 and two verification results — `after-creation` and
`after-transfer`. The second is the interesting one: it re-reads the object from
the destination rather than re-hashing the local file.

Then look at what was written:

```bash
ls .dev-backups/
```

One opaque object. Not a directory, not a readable manifest beside it.

## 2. Confirm it carries no secret

```bash
grep -a "mn_dev_session\|BEGIN PRIVATE KEY\|recovery-kit" .dev-backups/* ; echo "exit=$?"
```

Expect no matches. An archive that is encrypted before transfer should also
survive this check *after* being decrypted — the sealed suite asserts the
stronger form.

## 3. Rehearse a restoration

```bash
pnpm admin restore test --latest --json
```

Expect exit 0, a count of restored items, and — the point of the exercise — a
live workspace that is untouched. Confirm by reloading the browser: the tree is
exactly as it was.

The rehearsal creates a database, restores into it, and drops it. If it were a
dry run that validated without writing, it would prove the archive is readable
and nothing about whether it can be written back.

## 4. See it from the interface

Open the workspace and find the backup panel. It shows when the last verified
backup succeeded, and when the last rehearsal happened. Neither shows a secret.

To see the staleness warning without waiting a day, move the recorded time back:

```bash
psql "$DATABASE_URL" -c "UPDATE backups SET created_at = now() - interval '30 hours'"
```

Reload. The warning is stated plainly, not badged.

## 5. Refuse an incompatible restoration

```bash
pnpm admin restore apply --id <backup-id> --dry-run
```

Then edit the archive's manifest `schemaVersion` to a future number and try
again. Expect a refusal that names both versions, before anything is written.

## 6. Watch an update refuse to migrate

Simulate a version change with no verified backup:

```bash
psql "$DATABASE_URL" -c "UPDATE installations SET application_version = '0.0.1'"
psql "$DATABASE_URL" -c "DELETE FROM backup_verifications"
pnpm dev
```

Expect the application to refuse to run migrations and to say why. This is the
one failure in this feature that protects against an unrecoverable loss, so it
fails loudly rather than continuing on the old schema under a new binary.

## What this does not cover

- **Google Drive.** Every step above uses the local destination. The Drive path
  is exercised by its own suite against a recorded interaction, and by hand
  against a real account before a release.
- **A large workspace.** These steps use whatever is in the development
  database. The size at which streaming stops being merely preferable is
  measured in `validation.md`, not here.
