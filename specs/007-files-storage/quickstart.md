# Quickstart: Files and Durable Storage

## Prerequisites

- Node.js 24 and the repository-pinned pnpm release.
- Docker with Compose v2.
- A clean PostgreSQL test database and enough temporary space for the acceptance fixture.
- For production rehearsal, a private S3-compatible endpoint plus an encrypted restic repository in a separate failure domain. The local test profile supplies disposable equivalents.

## Focused development checks

```text
pnpm exec vitest run packages/blob-store/tests apps/api/tests/files.contract.spec.ts apps/operations/tests
pnpm exec vitest run --project database-integration packages/database/tests/files-storage.integration.spec.ts
pnpm exec vitest run tests/contract/files-storage.spec.ts tests/performance/files-storage.perf.spec.ts
pnpm exec playwright test tests/e2e/files-storage.spec.ts
```

Expected: streamed filesystem/S3 parity, full and single-range file contracts, safe disposition, existing-file reuse, quota-admitted offline reads, audits, backup manifests, fault-injected restore behavior, responsive accessibility, and deterministic screenshots all pass.

## Production-like object-storage path

1. Copy `.env.prod.example` to `.env.prod` and replace every password or access key.
2. Build the pinned images and start the private composition:

```text
MYOWNNOTION_IMAGE_TAG=local MYOWNNOTION_VCS_REF=local docker compose --env-file .env.prod -f compose.prod.yaml build
docker compose --env-file .env.prod -f compose.prod.yaml up --detach --wait
```

3. Open the loopback web URL, create two pages, import an image and a document on the first page, attach the existing document to the second page, preview/download, replace it, and restart the composition.
4. Confirm the object service has no host-published port and both placements return the replacement digest after restart.

## Read-only integrity audit

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile operations run --rm operations storage audit
```

Expected: the report shows stable counts, zero missing/mismatched objects, and no storage locators, filenames, or content. Fault fixtures report injected categories but do not delete anything.

## Encrypted backup rehearsal

Configure `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, and rclone credentials through protected mounted files. The mode-`0600` files must be owned by, or mapped readably to, the pinned non-root operations user (UID/GID `1000` on a rootful Linux host). Then run:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup create
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup status
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup list
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup check
docker compose --env-file .env.prod -f compose.prod.yaml --profile backup run --rm backup-operations backup prune --dry-run
```

Expected: only a snapshot that passed database/object/manifest and restic verification appears with complete status. A second simultaneous run reports `operation.already-running`. The prune command remains non-destructive until explicit confirmation.

## Empty-target restore rehearsal

1. Create and fully check a source backup, then stop the source project without deleting its volumes.
2. Copy `.env.prod` to the ignored `.env.restore`, retaining the same pinned images, backup destination, and protected secret paths.
3. Use the distinct project name `myownnotion-restore`; this provisions fresh target database, object, operations-state, and staging volumes.
4. Verify the selected complete snapshot without changing targets:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore --profile backup run --rm backup-operations restore verify --snapshot <snapshot-id>
```

5. Apply only after verification and explicit empty-target confirmation:

```text
docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore --profile backup run --rm backup-operations restore apply --snapshot <snapshot-id> --confirm-empty
```

6. Start the restored project, run the audit, restart it once, and repeat identity/digest checks.

Expected: item, placement, revision, relationship, page-document, file-content, task, database, and canvas fixture identities match the source manifest; every downloaded file reproduces its source digest. Wrong passwords, non-empty targets, incompatible manifests, missing objects, and digest corruption leave the restore guard in place and prevent API readiness.

After any guarded failure, preserve the safe result for diagnosis and recreate the entire disposable target with `docker compose --env-file .env.restore -f compose.prod.yaml -p myownnotion-restore down --volumes --remove-orphans`. Never remove only the guard or use the source project name for this cleanup.

## Legacy filesystem migration rehearsal

Mount the old blob volume read-only and begin with a dry run:

```text
docker compose --env-file .env.prod -f compose.prod.yaml --profile operations run --rm operations storage migrate-filesystem
docker compose --env-file .env.prod -f compose.prod.yaml --profile operations run --rm operations storage migrate-filesystem --confirm
```

Expected: each canonical legacy object is read, hashed, written, re-read, and only then repointed; rerunning is idempotent. Missing or mismatched legacy content stops that object without changing its database locator.

## Full merge gates

```text
pnpm toolchain:check
pnpm shell:check
pnpm format:check
pnpm lint:ci
pnpm typecheck
pnpm test:coverage
pnpm test:integration
pnpm test:contract
pnpm test:performance
pnpm test:e2e
pnpm build
pnpm test:containers
```

Record exact results, browser screenshots, backup snapshot evidence, fault-injection outcomes, and clean-host restore comparison in `validation.md`. Never commit `.env.prod`, restic credentials, rclone configuration, database dumps, object data, or restored private content.
