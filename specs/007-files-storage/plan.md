# Implementation Plan: Files and Durable Storage

**Branch**: `codex/files-and-storage` | **Date**: 2026-08-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-files-storage/spec.md`

## Summary

Complete the existing canonical-file foundation by adding private verified full/range reads, safe raster previews, existing-file placement reuse, and immutable revision-keyed offline caching. Replace complete in-memory upload buffering with a streaming blob contract implemented by the existing filesystem adapter and a private S3-compatible adapter used by the production composition. Add a small TypeScript operations application that performs read-only integrity audits plus encrypted, locked, manifest-driven restic backups and empty-target restores across PostgreSQL and immutable objects. The restore workflow writes a persistent in-progress guard before target mutation so the API cannot become ready until verification succeeds.

## Technical Context

**Language/Version**: TypeScript 5.9 in strict mode on Node.js 24 LTS; pnpm 10.33.3 exclusively

**Primary Dependencies**: Fastify 5 and `@fastify/multipart` 9 streaming parts; AWS SDK for JavaScript v3 S3 client and multipart helper; Drizzle ORM 0.44/PostgreSQL 18; React 19, Dexie 4, Vite 7, Workbox 7; restic 0.19.1, rclone, `pg_dump`, and `pg_restore` in a pinned operations image

**Storage**: PostgreSQL remains canonical metadata; immutable bytes use `BlobStore` with filesystem development and S3-compatible production adapters; Cache Storage retains bounded immutable revision responses; encrypted restic repositories live in an operator-configured separate failure domain; a small named volume retains redacted operation status and the restore guard

**Testing**: Vitest unit/property/contract/integration/coverage projects, Testcontainers PostgreSQL plus S3-compatible object storage, Playwright Chromium/Firefox/WebKit desktop and mobile, Axe, fault-injected operation-command tests, production Compose smoke, deterministic restore comparison

**Target Platform**: Loopback-only responsive PWA and Linux OCI composition on a single-owner self-hosted host; current macOS/Linux development paths remain supported

**Project Type**: pnpm monorepo with web client, HTTP API, domain/client/database/storage packages, and a one-shot/scheduled operations CLI image

**Performance Goals**: Stream a 256 MiB upload with less than 32 MiB process-buffer growth; support complete and single-range streaming reads without full buffering; render attachment metadata immediately and safe preview without page overflow; audit 10,000 objects in under 60 seconds excluding remote transfer; restore acceptance fixture before the 10-minute Compose test timeout

**Constraints**: Single owner and no authentication means every published port remains loopback-only; no presigned or public object URL; object acceptance requires independent persisted-byte verification; no automatic object deletion; new uploads require connectivity; cached revisions are immutable and quota-admitted; backups must unite one exported PostgreSQL snapshot with exactly its referenced objects; restore accepts only empty targets and never performs downgrade or live in-place rollback

**Scale/Scope**: One workspace, up to 256 MiB per file, 10,000 referenced objects in audit/manifest fixtures, 24 cached revisions no larger than 16 MiB each and no older than 30 days, one backup or restore operation at a time, default 7 daily/4 weekly/12 monthly retention policy

## Constitution Check

*GATE: Passed before research and re-checked after design.*

- **I. User Ownership and Local Resilience — PASS**: exact private downloads, quota-bounded immutable offline content, durable encrypted remote backups, verified clean-host restore, and documented formats make cloud or one host non-exclusive paths to user data.
- **II. One Spec, Any Agent — PASS**: every requirement, decision, task, contract, and validation result remains under `specs/007-files-storage/`.
- **III. Incremental, Verifiable Delivery — PASS**: four independently testable stories progress from user retrieval to object durability, backup, and restore; unit, contract, integration, browser, fault-injection, and Compose evidence are planned before implementation tasks.
- **IV. Privacy and Security by Default — PASS**: object keys and credentials remain server-side, no public/presigned route is introduced, inline media is allow-listed, names and headers are sanitized, logs/reports are redacted, backups are encrypted, and restore fails closed.
- **V. Simple, Modular Architecture — PASS**: existing `BlobStore`, repository, attachment surface, API, and Compose boundaries are extended. One operations application is justified by current backup/audit/restore requirements and is not a long-running product service except its optional scheduler command.
- **VI. Accessible and Predictable Experience — PASS**: attachment actions, preview, cached/online-only state, integrity errors, and responsive behavior receive semantic keyboard and browser journeys.
- **VII. Reproducible Toolchains and Enforced Quality — PASS**: all maintained source is TypeScript; pnpm remains pinned; operations binaries and base images are pinned; formatting, lint, exact types, tests, migrations, builds, container smoke, and browser artifacts remain merge gates.
- **Product/technical constraints — PASS**: self-hosted object storage has a documented local path; offline behavior is explicit; backup scheduling is in this dedicated storage spec; authentication, sharing, malware processing, and multi-device binary synchronization remain excluded.

### Post-design re-check

The design adds no constitution exception. S3 compatibility avoids provider lock-in, restic repositories accept local or rclone-backed destinations, the restore guard prevents silent partial state, and legacy filesystem objects receive an explicit verified migration command instead of a hidden format change.

## Project Structure

### Documentation (this feature)

```text
specs/007-files-storage/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── validation.md
├── checklists/
│   └── requirements.md
└── contracts/
    ├── file-content.openapi.yaml
    ├── backup-manifest.schema.json
    └── operations-cli.md
```

### Source Code (repository root)

```text
apps/api/
├── src/app.ts
├── src/routes/files.ts
└── tests/files.contract.spec.ts

apps/web/src/
├── features/attachments/
│   ├── attachment-panel.tsx
│   └── file-preview.tsx
├── services/content-api.ts
└── service-worker.ts

apps/operations/
├── Dockerfile
├── package.json
├── src/
│   ├── cli.ts
│   ├── backup.ts
│   ├── restore.ts
│   ├── audit.ts
│   ├── manifest.ts
│   ├── process-runner.ts
│   └── status-store.ts
└── tests/

packages/blob-store/src/
├── blob-store.ts
├── content-store.ts
├── filesystem-blob-store.ts
└── s3-blob-store.ts

packages/database/src/repositories/
└── file-repository.ts

packages/contracts/src/content-api.ts
packages/client-core/src/local-store/

packages/database/migrations/
tests/contract/
tests/e2e/files-storage.spec.ts
tests/performance/files-storage.perf.spec.ts
scripts/ci/test-containers.ts
compose.prod.yaml
.env.prod.example
docs/deployment.md
docs/development.md
docs/editor.md
```

**Structure Decision**: Keep canonical storage mechanics in `packages/blob-store`, metadata queries in `packages/database`, HTTP privacy/range behavior in `apps/api`, and user interaction/cache behavior in `apps/web`. Add `apps/operations` because backup and restore require pinned external tools, PostgreSQL snapshot coordination, encrypted repository control, and a separate least-privilege container lifecycle; it reuses contracts rather than adding another network API.

## Complexity Tracking

No constitution violation requires an exception.
