# Production-like deployment and integration test

This guide starts the complete MyOwnNotion stack from versioned container images or a clean local build. It is intended for local integration testing and self-hosting evaluation.

> **Security boundary:** authentication and authorization are not implemented. The supplied composition binds PostgreSQL, the API, and the web application to `127.0.0.1` only. Do not publish these ports through a public interface, reverse proxy, tunnel, or port-forwarding rule.

## Prerequisites

- Docker Engine or Docker Desktop with Compose v2 and BuildKit
- At least 4 GB of free memory and 5 GB of free disk space for a clean multi-service build
- Ports `5432`, `3001`, and `8080` available on the local machine, or unused alternatives selected in `.env.prod`
- Access to GitHub Container Registry when pulling a private package

The published API and web images support Linux AMD64 and ARM64. Each accepted `main` revision is tagged `sha-<full-commit>`. Release tags also receive a human-readable version alias; `latest` is a convenience alias for `main`, not a reproducibility guarantee.

## Configure the stack

Create the untracked production-like environment file:

```text
cp .env.prod.example .env.prod
```

Edit `.env.prod` before starting:

- Replace `MYOWNNOTION_DB_PASSWORD` with a long random value.
- Replace both private object-storage credentials.
- Set `MYOWNNOTION_IMAGE_TAG` to the immutable `sha-<full-commit>` tag under test.
- Set `MYOWNNOTION_VCS_REF` to the corresponding full hexadecimal commit.
- Change the three host ports only when their loopback defaults conflict with another local service.

Never commit `.env.prod`; it is ignored by Git.

## Authenticate to GitHub Container Registry when required

Public packages can be pulled without authentication. For a private package, create a GitHub token with `read:packages` and authenticate without placing the token in command history:

```text
docker login ghcr.io --username YOUR_GITHUB_USER
```

Enter the token at the password prompt. Package access is separate from repository access, so confirm that the account can read both `myownnotion-api` and `myownnotion-web`.

## Pull and start published images

```text
docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml up --detach --wait
```

Startup order is enforced:

1. PostgreSQL must report healthy.
2. The one-shot `migrate` service applies every reviewed SQL migration and must exit successfully.
3. The private object service must report healthy; it publishes no host port.
4. The API starts and must report ready with its S3 adapter.
5. The web service starts and proxies `/health` and `/v1` to the API over the internal network.

If migration fails, the API stays unavailable and the existing named volumes remain intact for diagnosis.

## Build locally before images are published

Pull requests build the images in CI but do not publish them. To test a revision before it reaches `main`, set these values in `.env.prod`:

```text
MYOWNNOTION_IMAGE_TAG=local
MYOWNNOTION_VCS_REF=<full-commit>
```

Then build and start from the checkout:

```text
docker compose --env-file .env.prod -f compose.prod.yaml build
docker compose --env-file .env.prod -f compose.prod.yaml up --detach --wait
```

Both Dockerfiles use the committed frozen lockfile and digest-pinned runtime images. The API image contains the server and reviewed migration runner; the web image uses an unprivileged static server with same-origin API proxying.

## Verify the application

```text
docker compose --env-file .env.prod -f compose.prod.yaml ps
curl --fail http://127.0.0.1:3001/health
curl --fail http://127.0.0.1:8080/health
```

Expected results:

- `postgres`, `object-storage`, `api`, and `web` are healthy.
- `migrate` has exited with status `0`.
- Both health calls return `{"status":"ready","schemaVersion":1}`.
- The application opens at `http://127.0.0.1:8080`.

For a functional knowledge-network check, create two pages in the interface, type `[[` in the first page, select the second, and save. Open the second page and confirm that the first appears under **Backlinks**. Switch between **Local graph** and **Global graph**, filter by either page name, and open a page from the accessible graph list.

For a functional task check, insert a task in either page, place the caret inside it, and set **In progress**, a due date, and **High** priority. Save, then find it under **Tasks**. Exercise its calendar scope, text/status/priority filters, list and board views, and the action that opens the source block. Reload once with the browser network unavailable to confirm the already-loaded page and task view remain local; reconnect and wait for the workspace to report synchronization.

For a functional database check, insert a database in a page and add select, date, number, and relation properties. Add at least two records, relate the first to the second, then exercise search, numeric sorting, select-grouped board, and gallery. Save and reload. Disconnect the browser network, edit a record and the current view, reload once, reconnect, and wait for synchronization. The same database identity, schema, records, relation, query, sort, and view must remain present.

For a functional canvas check, insert a canvas in a page, add one text card and one page card, connect and label them, then draw a thick stroke. Move and resize a card, pan and zoom the viewport, save, and reload. Open the page card and confirm its backlink. Disconnect the browser network, change geometry and the viewport, reload once, reconnect, and wait for synchronization. The same canvas/card/connection/stroke identities, geometry, page target, label, stroke points, and viewport must remain present.

To verify the configured images and loopback bindings without starting services:

```text
docker compose --env-file .env.prod -f compose.prod.yaml config --images
docker compose --env-file .env.prod -f compose.prod.yaml config
```

## Inspect logs and failures

```text
docker compose --env-file .env.prod -f compose.prod.yaml logs --tail 200 postgres migrate api web
docker compose --env-file .env.prod -f compose.prod.yaml ps --all
```

Application diagnostics redact private content, but logs should still be treated as private operational data. Never post `.env.prod`, database dumps, blob volumes, or unreviewed logs publicly.

## Stop and restart without losing data

Stop the services while preserving the named volumes:

```text
docker compose --env-file .env.prod -f compose.prod.yaml down
```

Start them again and re-run idempotent migrations:

```text
docker compose --env-file .env.prod -f compose.prod.yaml up --detach --wait
```

Canonical metadata and page content remain in the project-scoped `postgres-data` volume. Immutable file content remains in the private `object-data` volume. The legacy `blob-data` volume is mounted read-only only by the explicit migration command. A normal `down` or host restart does not delete these volumes.

After restarting, reopen the linked source and target. The inline link, backlink occurrence count, graph edge, task identity, status, due date, priority, task-workspace result, database schema, records, relation, selected view, canvas cards, geometry, connection, stroke, page target, and viewport must still be present. The automated container smoke performs the same persistence check through the same-origin web proxy using one version-6 document containing its task metadata, derived wiki and canvas page-card relationships, structured database, and complete canvas atom.

## Update to another immutable revision

1. Back up or snapshot the named volumes according to your host policy.
2. Set `MYOWNNOTION_IMAGE_TAG=sha-<new-full-commit>` in `.env.prod`.
3. Pull, stop, and recreate the services:

```text
docker compose --env-file .env.prod -f compose.prod.yaml pull
docker compose --env-file .env.prod -f compose.prod.yaml down
docker compose --env-file .env.prod -f compose.prod.yaml up --detach --wait
```

4. Re-run the health and interface checks above.

A newer image may apply a forward-only migration; do not assume that selecting an older image safely reverses database changes. Create and verify an encrypted backup before every update.

## Initialize encrypted backups

Backups use restic encryption and must leave the application host. Before enabling the `backup` profile:

1. Create `MYOWNNOTION_BACKUP_SECRETS_DIR` outside the checkout with owner-only permissions.
2. Put a long random password in `restic-password`, make it readable by the non-root operations-image user (UID/GID `1000`), and set it to mode `0600`. On a rootful Linux host, use `chown 1000:1000 <secrets-dir>/restic-password` followed by `chmod 0600 <secrets-dir>/restic-password`; adapt the ownership mapping for rootless Docker. Apply the same ownership and mode to `rclone.conf` when present.
3. Point `MYOWNNOTION_BACKUP_DESTINATION` at an existing directory on a separately mounted disk or failure domain.
4. Keep the default local `MYOWNNOTION_RESTIC_REPOSITORY`, or set it to an `rclone:remote:path` repository and add an owner-only `rclone.conf` beside the password file.

Initialize the encrypted repository exactly once:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm --entrypoint restic backup-operations init
```

If initialization reports that the password or rclone configuration cannot be read, correct the host ownership for container UID/GID `1000`; do not loosen the secret files to group- or world-readable modes.

The source revision must be a full hexadecimal commit. Backup creation refuses `local`, `latest`, or an unknown source revision because those values cannot prove compatibility later.

## Create, inspect, and verify backups

Use the same pinned operations image for every command:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup create
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup status
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup list
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup check
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup check --read-data
```

Creation holds both the shared operation lock and a PostgreSQL advisory lock, exports one repeatable-read snapshot, runs `pg_dump` against that snapshot, stages only verified referenced objects, re-hashes the dump and objects, and writes a deterministic manifest. A restic snapshot becomes selectable only after repository verification and the `myownnotion-complete` tag. Interrupted or failed runs may leave encrypted untagged data for diagnosis, but `backup list` never advertises it as recoverable.

Command output and the persistent status file contain only state, safe identifiers, timestamps, and bounded counts. They exclude database URLs, credentials, filenames, object locators, page text, document bodies, and child-process output.

## Scheduled backups and retention

`MYOWNNOTION_BACKUP_SCHEDULE_UTC` uses exact `HH:MM` UTC notation. Start the optional scheduler with:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup-scheduler up --detach backup-scheduler
```

The scheduler delegates to the same locked creation path, records the attempted UTC date atomically, and therefore runs at most once per UTC day across restarts. Inspect its current outcome with `backup status`.

The default retention policy is 7 daily, 4 weekly, and 12 monthly complete recovery points. Always review the dry run first; only `--confirm` may forget snapshots and prune encrypted packs:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup prune --dry-run
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup prune --confirm
```

Retention touches only the configured restic repository, never PostgreSQL or active object storage. A repository, dump, object, digest, lock, transfer, check, or tag failure returns a closed safe failure code and no new complete recovery point. Correct the dependency, run `backup check --read-data`, then create a new backup; do not manually add the completion tag.

## Verify and restore on a clean target

Never apply a restore over the active installation. The following rehearsal uses a distinct Compose project, so Docker creates fresh PostgreSQL, object, operations-state, and staging volumes. It shares only the protected backup secret directory and backup destination configured in the environment file.

After creating and fully checking a source backup, stop the source services without deleting their volumes:

```text
docker compose --env-file .env.prod -f compose.prod.yaml -p myownnotion down
cp .env.prod .env.restore
```

Keep the same immutable image tag, source revision, backup destination, and secret directory in `.env.restore`. If the source must remain online in parallel, assign unused database, API, and web host ports in `.env.restore`; otherwise the existing loopback ports can be reused. Never commit either environment file.

First select an ID from `backup list` and run the read-only staging verification:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore --profile backup run --rm backup-operations restore verify --snapshot <snapshot-id>
```

This starts only the fresh target dependencies, decrypts into ephemeral staging, and verifies the complete tag, repository, closed manifest, source/tool/schema compatibility, PostgreSQL archive, exact dump digest, object inventory, lengths, and digests. It does not mutate the target database or bucket.

Apply only after verification and explicit empty-target confirmation:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore --profile backup run --rm backup-operations restore apply --snapshot <snapshot-id> --confirm-empty
```

Immediately before the first target mutation, the operation writes `.restore-in-progress` in `operations-state`. The API mounts that state read-only and refuses startup while the guard exists. The restore loads the data-only PostgreSQL archive, streams each verified object, then compares all canonical counts and every stored digest. Only full success removes the guard.

After success, start the restored application and run the read-only audit:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore up --detach --wait
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore --profile operations run --rm operations storage audit
```

Open the restored loopback interface, compare the expected workspace/item/placement/revision/relationship identities, and download the acceptance files to compare their recorded SHA-256 values before treating the target as recovered. Stop and restart the target once and repeat health, audit, and digest checks. Preserve the old installation unchanged until this rehearsal passes.

If apply fails after the guard is written, do not remove the guard manually and do not start the API. The rollback boundary is the entire disposable target: retain the safe failure code for diagnosis, delete only the named restore-project containers and volumes, then repeat verify/apply against newly empty targets:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore down --volumes --remove-orphans
```

This command must never be run with the source project name. Wrong passwords, incomplete snapshots, incompatible schemas, damaged dumps/objects, non-empty targets, and preflight errors stop before target mutation. After a successful rehearsal, choose either the restored project or the untouched source as the active installation; never merge their volumes.

## Storage, backup, and restore troubleshooting

- If the API or web service never becomes healthy, inspect the safe service state and logs. A message that restore is in progress means `.restore-in-progress` exists; treat that target as partial and follow the whole-target rollback above rather than deleting the guard.
- If file metadata loads but download or preview reports unavailable/integrity failure, run `storage audit`. Check object-service health, credentials, bucket, endpoint, referenced/missing/mismatched counts, and migration status without publishing locators or filenames. Audit never repairs or deletes.
- If a private GHCR pull returns `403 Forbidden`, the login may have succeeded while the token or account still lacks `read:packages` access to that package. Confirm package visibility and authorization for every requested image and immutable tag.
- If backup creation does not yield a complete snapshot, read `backup status`, restore repository connectivity or protected secrets, then run `backup check --read-data` and create a new backup. Never manually add the completion tag.
- If restore verification reports wrong secret, corruption, incompatibility, or an unavailable snapshot, do not apply. Confirm that the selected ID comes from `backup list`, the same protected password/repository is mounted, PostgreSQL major and migrations match, and repository verification succeeds.
- If an operations command reports `operation.already-running`, do not remove the lock while another operations container may be alive. Inspect the Compose project and retry only after the owner has exited; overlapping backup, prune, migration, and restore are intentionally refused.

## Cleanup

Remove containers and networks while preserving data:

```text
docker compose --env-file .env.prod -f compose.prod.yaml down --remove-orphans
```

The following command permanently deletes the composition's database and blob volumes. Use it only for disposable test data:

```text
docker compose --env-file .env.prod -f compose.prod.yaml down --volumes --remove-orphans
```

For the automated clean-build, health-proxy, migration, and restart-persistence scenario, run `pnpm test:containers` from a Node.js 24 and pnpm-enabled checkout. The script uses an isolated Compose project and deletes only that project's disposable volumes.
