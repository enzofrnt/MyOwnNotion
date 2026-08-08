# Research: Files and Durable Storage

## Streaming object adapter and verification

**Decision**: Extend the project-owned `BlobStore` contract with streaming put/open/head/list/compare operations and implement an S3-compatible adapter with the AWS SDK for JavaScript v3. Upload to an opaque temporary object while hashing, read the persisted object back to verify length and SHA-256, then either reuse a byte-equal verified candidate or retain the new immutable key. The API never emits a presigned URL.

**Rationale**: AWS SDK v3 returns `GetObject` as a stream and its multipart helper supports bounded large uploads; S3 accepts a single byte range and does not support multiple ranges in one request. The SDK also supports explicit upload checksums, but project verification still reads persisted bytes because the canonical contract requires independent evidence rather than trusting metadata. This adapter works against self-hosted S3-compatible storage without coupling the canonical model to one vendor. Sources: [AWS S3 v3 streaming and multipart guidance](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-s3.html), [AWS SDK checksum guidance](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html), [S3 GetObject range contract](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

**Alternatives considered**:

- Continue buffering complete files: rejected because the 256 MiB product limit would translate directly into per-request memory pressure.
- Expose presigned object URLs: rejected because it expands the access-control surface before authentication and leaks the storage boundary to clients.
- Depend on one object server's native client: rejected because the existing interface and self-hosting goal benefit from portable S3 semantics.

## Private self-hosted object service

**Decision**: Pin a single-node MinIO container for the production-like composition, keep it on the internal Compose network with no published console or data port, create one private bucket through application initialization, and persist it in a dedicated named volume. The API waits for the official liveness and read/write health probes before accepting content operations.

**Rationale**: MinIO documents an S3-compatible container deployment and exposes narrow unauthenticated health probes that reveal status but not objects. Single-node storage is appropriate for local self-host evaluation; the remote encrypted backup remains the separate failure domain. Source: [MinIO container deployment](https://min.io/docs/minio/container/index.html), [MinIO healthcheck API](https://min.io/docs/minio/linux/operations/monitoring/healthcheck-probe.html).

**Alternatives considered**:

- Keep the API filesystem volume in production: rejected because the roadmap explicitly calls for an object-storage boundary and independent auditing.
- Publish the object port on loopback: rejected as unnecessary; the API and operations container are the only consumers.
- Enable automatic version expiration or object deletion: rejected because the feature requires non-destructive audit and canonical lifecycle remains in PostgreSQL.

## Retrieval and safe inline rendering

**Decision**: Add `HEAD` and `GET /v1/files/{itemId}/content?revisionId=...`. Require the immutable revision identity, support zero or one HTTP byte range, return sanitized RFC 5987 filenames, `X-Content-Type-Options: nosniff`, a restrictive content security policy, an immutable private cache policy, digest and length headers, and `Content-Disposition: inline` only for PNG, JPEG, GIF, WebP, and AVIF. All other types use attachment disposition.

**Rationale**: Revision-qualified URLs are safe offline cache keys and cannot silently change when content is replaced. Server mediation protects private storage configuration, gives range behavior one contract, and blocks active SVG/HTML content from executing.

**Alternatives considered**:

- Cache the current unversioned URL: rejected because replacement could make stale bytes appear current.
- Infer safety from filename extension: rejected because declared media type and extension are untrusted presentation metadata.
- Render SVG or PDF inline: rejected until a dedicated sandboxing/rendering feature exists.

## Offline immutable file cache

**Decision**: Use a Workbox route only for successful revision-qualified content reads. Admit responses no larger than 16 MiB, keep at most 24 entries for 30 days, purge on quota error, and show whether an attachment is cached or online-only. Metadata remains in the existing Dexie canonical projection; byte payloads remain in Cache Storage.

**Rationale**: Revision URLs are immutable, so cache-first cannot masquerade as synchronization. Entry, age, and size admission bounds make behavior predictable while avoiding a second canonical database for binary data.

**Alternatives considered**:

- Store blobs inside the existing Dexie tables: rejected because it enlarges the transactional projection and outbox without adding canonical semantics.
- Cache every successful file regardless of size: rejected because one 256 MiB file can exhaust mobile quota.
- Network-first for immutable revisions: rejected because it weakens the explicit offline journey without improving freshness.

## Consistent encrypted backup set

**Decision**: A TypeScript operations command acquires a PostgreSQL advisory lock, opens a repeatable-read transaction, exports its snapshot, reads the exact verified content-object inventory, and holds the transaction while `pg_dump --format=custom --snapshot=...` runs. It downloads and re-hashes exactly those immutable objects into an ephemeral staging directory, writes a deterministic manifest and dump digest, then asks restic to create an encrypted snapshot in an operator-configured local or rclone-backed repository. Only a successful restic check and manifest re-read add the `myownnotion-complete` tag. Repository locks plus the advisory lock prevent overlap.

**Rationale**: PostgreSQL documents that `pg_dump` makes a consistent export during concurrent use and supports an exported synchronized snapshot. `restic --stdin-from-command` correctly fails on a producer error, but staging the custom dump together with object files and the manifest yields one restorable tree and allows full pre-snapshot integrity checks. restic encryption is intrinsic, and a rclone-backed repository transfers encrypted packs directly to the separate destination. Sources: [PostgreSQL 18 pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [restic backup command input safety](https://restic.readthedocs.io/en/v0.17.3/040_backup.html), [restic encryption](https://restic.readthedocs.io/en/stable/070_encryption.html), [rclone copy/remote semantics](https://rclone.org/docs/).

**Alternatives considered**:

- Back up named Docker volumes directly: rejected because a live PostgreSQL data directory copy is not a portable consistent logical backup.
- Pipe `pg_dump` to restic with plain `--stdin`: rejected because restic warns that producer failures can be masked.
- Back up every object currently in the bucket: rejected because interrupted and unreferenced objects are not part of the canonical snapshot.

## Verification, retention, and status

**Decision**: Treat only snapshots tagged `myownnotion-complete` as selectable. Run `restic check` after creation, support an explicit full-data check, apply `forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12` only to complete snapshots, and prune only through an explicit command after a dry-run. Write bounded JSON status to the operations-state volume with timestamps, snapshot ID, counts, and safe error code only.

**Rationale**: restic documents that interrupted backup/prune operations do not corrupt the repository, that `check --read-data` verifies packs, and that retention policies can preserve daily/weekly/monthly snapshots. Its repository locks complement the application advisory lock. Sources: [restic troubleshooting and full-data check](https://restic.readthedocs.io/en/stable/077_troubleshooting.html), [restic policy retention](https://restic.readthedocs.io/en/v0.17.1/060_forget.html).

**Alternatives considered**:

- Mark a snapshot complete as soon as restic returns: rejected because manifest and repository verification are required acceptance evidence.
- Automatically prune after every backup: rejected because pruning is destructive and can be expensive; it remains explicit and separately observable.
- Store operation status in the canonical workspace database: rejected because a database-loss incident must not erase the only local indication that restore is in progress.

## Empty-target restore and readiness guard

**Decision**: Restore a selected complete snapshot into ephemeral staging, validate its manifest and every object before target mutation, require an empty database and bucket, then persist `.restore-in-progress` in a shared operations-state volume. Run `pg_restore`, upload objects under their manifest keys, re-read and re-hash them, and remove the guard only after cross-count and digest verification. API startup refuses to initialize while the guard exists. An interrupted restore therefore leaves targets requiring explicit cleanup but cannot expose them as ready.

**Rationale**: This is the smallest safe workflow without pretending that PostgreSQL and S3 support one cross-system atomic commit. Empty-target enforcement and the readiness guard make partial state visible and non-serving. PostgreSQL warns that restoring a dump executes source database content, so only backups from this owned installation are accepted and compatibility metadata is checked first. Source: [PostgreSQL pg_dump restore warning](https://www.postgresql.org/docs/18/app-pgdump.html).

**Alternatives considered**:

- Restore over live volumes: rejected because failure could destroy the last working state.
- Automatically delete partial targets after failure: rejected because destructive cleanup requires explicit operator intent and forensic evidence may be useful.
- Claim an atomic rename across database and object storage: rejected because no shared transaction exists.

## Legacy filesystem migration

**Decision**: Keep the filesystem adapter and add `storage migrate-filesystem`. It enumerates canonical `file_contents` rows, reads each legacy key from the mounted old blob volume, verifies length and digest, writes through the S3 adapter, verifies again, and updates only the affected storage key inside one database transaction per object. Dry-run is the default; repeated confirmed execution is idempotent.

**Rationale**: Existing production-like installations used a filesystem volume. A verified explicit migration preserves current file identities and revisions while allowing new deployments to use object storage.

**Alternatives considered**:

- Mount the old volume forever beside object storage: rejected because reads would depend on hidden adapter ordering.
- Copy the directory without consulting canonical metadata: rejected because it would silently carry temporary/unreferenced content and could miss integrity faults.
