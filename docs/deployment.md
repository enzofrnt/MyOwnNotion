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
- Set `MYOWNNOTION_IMAGE_TAG` to the immutable `sha-<full-commit>` tag under test.
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
3. The API starts and must report ready.
4. The web service starts and proxies `/health` and `/v1` to the API over the internal network.

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

- `postgres`, `api`, and `web` are healthy.
- `migrate` has exited with status `0`.
- Both health calls return `{"status":"ready","schemaVersion":1}`.
- The application opens at `http://127.0.0.1:8080`.

For a functional knowledge-network check, create two pages in the interface, type `[[` in the first page, select the second, and save. Open the second page and confirm that the first appears under **Backlinks**. Switch between **Local graph** and **Global graph**, filter by either page name, and open a page from the accessible graph list.

For a functional task check, insert a task in either page, place the caret inside it, and set **In progress**, a due date, and **High** priority. Save, then find it under **Tasks**. Exercise its calendar scope, text/status/priority filters, list and board views, and the action that opens the source block. Reload once with the browser network unavailable to confirm the already-loaded page and task view remain local; reconnect and wait for the workspace to report synchronization.

For a functional database check, insert a database in a page and add select, date, number, and relation properties. Add at least two records, relate the first to the second, then exercise search, numeric sorting, select-grouped board, and gallery. Save and reload. Disconnect the browser network, edit a record and the current view, reload once, reconnect, and wait for synchronization. The same database identity, schema, records, relation, query, sort, and view must remain present.

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

Canonical metadata and page content remain in the project-scoped `postgres-data` volume. Immutable file content remains in `blob-data`. A normal `down` or host restart does not delete either volume.

After restarting, reopen the linked source and target. The inline link, backlink occurrence count, graph edge, task identity, status, due date, priority, task-workspace result, database schema, records, relation, and selected view must still be present. The automated container smoke performs the same persistence check through the same-origin web proxy using one version-5 document containing its task metadata, derived wiki relationship, and structured database.

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

Automated backup, rollback, encrypted-volume provisioning, and public exposure are deliberately outside this feature. A newer image may apply a forward-only migration; do not assume that selecting an older image safely reverses database changes.

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
