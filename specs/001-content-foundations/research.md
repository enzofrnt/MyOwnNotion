# Phase 0 Research: Canonical Content Foundations

## Decision 1: TypeScript monorepo with platform-independent domain

**Decision**: Use TypeScript strict mode exclusively on Node.js 24 LTS with pnpm workspaces. All maintained application, configuration, and test source uses `.ts` or `.tsx`; first-party `.js` and `.jsx` source is forbidden. JavaScript emitted by the compiler or bundler is build output only. Keep canonical rules in `packages/domain`; React, Fastify, PostgreSQL, and future Electron/local-storage adapters depend on the domain rather than the reverse.

**Rationale**: One language allows contracts and invariants to be exercised across server, browser, and future Electron clients while clean package boundaries prevent platform coupling. Node.js 24 is an LTS line suitable for production. [Node.js release schedule](https://nodejs.org/en/about/previous-releases)

**Alternatives considered**:

- Separate backend language: strong options exist, but duplicating canonical types and validation raises drift risk for this single-owner project.
- Next.js full-stack: useful for server-rendered public pages later, but unnecessary for the private offline-oriented SPA and less reusable inside Electron.

## Decision 2: React and Vite for the shared responsive renderer

**Decision**: Build a React SPA with Vite. Share UI and domain-facing client packages with the future Electron renderer.

**Rationale**: React provides composable UI primitives and Vite provides a fast HMR development server plus static production output suitable for self-hosting. [React](https://react.dev/), [Vite guide](https://vite.dev/guide/)

**Alternatives considered**:

- Server-rendered React framework: defer to the later public-sharing spec if public rendering requires it.
- Separate desktop UI: rejected because it duplicates nearly all interaction and accessibility work.

## Decision 3: Fastify API with schema-first validation

**Decision**: Use Fastify 5 with shared JSON Schemas and an OpenAPI 3.1 contract. Validate every request and serialize every response against owned schemas.

**Rationale**: Fastify has a schema-based validation and serialization model and works well with TypeScript. Schemas are application-owned constants, never accepted dynamically from users. [Fastify validation and serialization](https://fastify.dev/docs/v5.8.x/Reference/Validation-and-Serialization/)

**Alternatives considered**:

- Large decorator-based server framework: unnecessary before the service surface grows.
- Ad hoc handlers without schemas: rejected because malformed identifiers, types, and lineage claims must be rejected consistently.

## Decision 4: PostgreSQL 18 canonical store

**Decision**: Use PostgreSQL 18 with adjacency-list placements, recursive CTEs for traversal and cycle checks, foreign keys/check constraints for local invariants, and transactions for atomic mutations.

**Rationale**: PostgreSQL supports recursive traversal, explicit cycle handling, serializable transactions, durable constraints, and UUIDv7. It keeps hierarchy, relationships, revisions, and mutation idempotency in one transactional boundary. [Recursive queries](https://www.postgresql.org/docs/18/queries-with.html), [transaction isolation](https://www.postgresql.org/docs/current/sql-set-transaction.html), [PostgreSQL 18](https://www.postgresql.org/docs/18/release-18.html)

**Alternatives considered**:

- Graph database: graph rendering does not justify a second authoritative store; relations and recursive traversal fit PostgreSQL at the target scale.
- Document database: weaker relational constraints and multi-entity invariants increase integrity risk.
- SQLite as server authority: excellent for a future desktop cache, but PostgreSQL better matches concurrent devices and server-side transactional validation.

## Decision 5: Drizzle with committed SQL migrations

**Decision**: Declare typed schema with Drizzle, generate SQL migrations, review and commit the SQL, and apply migrations explicitly. Never use schema push in production.

**Rationale**: Drizzle supports PostgreSQL and transactional access while preserving inspectable SQL migration artifacts. [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [Drizzle transactions](https://orm.drizzle.team/docs/transactions)

**Alternatives considered**:

- Runtime schema push: rejected because destructive or ambiguous changes must be reviewed and tied to backup/update gates later.
- Heavy active-record ORM: obscures recursive SQL and constraint behavior needed by this model.

## Decision 6: UUIDv7 stable identity

**Decision**: Assign UUIDv7 to canonical items, placements, relationships, mutations, and revisions. IDs may be generated before server acceptance but are validated and scoped to the one workspace.

**Rationale**: UUIDv7 is standardized, time-ordered for index locality, and does not couple identity to path or name. [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html)

**Alternatives considered**:

- Sequential database IDs: difficult for offline creation and cross-device queues.
- Random UUIDv4: valid but loses useful index locality.
- Path-based identity: rejected because rename and move must preserve identity.

## Decision 7: Append-only lineage plus materialized current state

**Decision**: Store immutable revision headers and parent edges; retain complete superseded snapshots for 24 hours, except unresolved conflicts, trash, and backups. Keep current state materialized in canonical tables.

**Rationale**: Parent edges distinguish ancestor, descendant, and concurrent revisions without trusting device clocks. Materialized state avoids replaying an unbounded log for normal reads.

**Alternatives considered**:

- Last-write-wins timestamps: violates the no-silent-loss requirement.
- Full event sourcing forever: unnecessarily increases operational and migration complexity.
- CRDT as the global model: unsuitable for atomic hierarchy, trash, placement, and multi-entity invariants; later editor specs may use Yjs or Automerge only for document bodies.

## Decision 8: Immutable blob content and logical-file separation

**Decision**: Store file bytes as immutable content objects addressed by SHA-256 plus length, verify full byte equality before physical reuse, and point independent logical files at content objects. Updates create new content objects.

**Rationale**: This permits safe physical deduplication while ensuring separate imports never become one logical file and edits never leak between files.

**Alternatives considered**:

- Merge by name/size/type: unsafe and explicitly forbidden.
- Mutable shared blob paths: risks cross-file mutation and broken backup verification.
- No deduplication: logically valid fallback; the content contract permits adapters to skip reuse.

## Decision 9: Test pyramid with generative invariants

**Decision**: Use Vitest and fast-check for pure domain rules, PostgreSQL Testcontainers for constraints/transactions/migrations, contract tests for OpenAPI/export, fault injection for atomicity, and Playwright for complete UI journeys.

**Rationale**: UI automation cannot prove graph invariants or database atomicity alone. Playwright projects cover multiple browsers and viewports, while property tests exercise large operation sequences. [Playwright projects](https://playwright.dev/docs/test-projects), [Playwright web servers](https://playwright.dev/docs/test-webserver)

**Alternatives considered**:

- Playwright-only testing: rejected because backend and model failures would be slow and poorly localized.
- Mock database tests only: rejected because transaction isolation, recursive queries, and constraints require PostgreSQL.

## Decision 10: Future operational boundaries

**Decision**: This feature prepares, but does not implement, later operational concerns. Future specs should use Compose with explicit dev/production overrides, host-level encrypted storage such as LUKS for Linux deployments, separate active-data and backup failure domains, encrypted restic repositories transferred to Google Drive through rclone, and immutable image digests.

**Rationale**: Docker local volumes are not inherently encrypted. Host encryption protects offline disks; application/backup encryption provides an additional boundary. Backup validity requires coherent snapshots and isolated restore tests, not copying a live database. [Docker volumes](https://docs.docker.com/engine/storage/volumes/), [Compose production](https://docs.docker.com/compose/how-tos/production/), [Ubuntu storage encryption](https://documentation.ubuntu.com/security/security-features/storage/encryption-full-disk/), [restic design](https://github.com/restic/restic/blob/master/doc/design.rst)

**Alternatives considered**:

- Claim Compose encrypts local volumes: factually incorrect.
- Implement backup/update services now: violates the approved scope and minimal-architecture principle.

## Decision 11: Minimum browser-local persistence and catch-up

**Decision**: Use Dexie over IndexedDB for the browser projection, mutation outbox, causal revision headers, change cursor, and unresolved-conflict records. Use Workbox only to retain the versioned application shell. Submit stable mutation IDs to the server and catch up through a durable ordered cursor; transient notifications are never the source of truth.

**Rationale**: The constitution requires already local core content to remain readable and editable without the server. IndexedDB provides transactional structured storage, and Dexie supplies schema migrations and a focused TypeScript API. Browser storage can still be evicted, so the UI must request persistence where supported, expose storage failure, and never report a local mutation accepted unless state and outbox commit together. [Dexie](https://dexie.org/docs/Dexie.js), [StorageManager](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager), [Web storage guidance](https://web.dev/articles/storage-for-the-web)

**Alternatives considered**:

- Server-only first slice: rejected because it violates the constitution's offline requirement as soon as an interactive core flow ships.
- SQLite-WASM immediately: deferred because its worker/OPFS locking complexity is unnecessary for this initial projection.
- WebSocket-only delivery: rejected because disconnected clients need durable catch-up and idempotent replay.

## Decision 12: Reproducible toolchains and blocking quality gates

**Decision**: Use pnpm exclusively for Node.js workspaces, pin its exact release in root package metadata, commit `pnpm-lock.yaml`, and verify frozen installs in CI. Use Biome as the TypeScript/TSX formatter and linter, plus strict TypeScript checking. Check tracked Bash with pinned ShellCheck and shfmt releases. If Python is introduced by a later feature, use uv exclusively with a pinned `.python-version`, `pyproject.toml`, and committed `uv.lock`. Run all test layers and production builds behind one stable GitHub Actions `quality-gate` required by the protected `main` ruleset.

**Rationale**: pnpm derives its CI version from package metadata and enforces frozen lockfile behavior in CI. uv pins Python versions, maintains a universal lockfile, and runs commands in the locked project environment. Biome's `ci` command checks formatting and lint rules without modifying files. ShellCheck performs shell static analysis and shfmt supplies deterministic formatting checks. GitHub required status checks prevent merging when the selected check has not passed. [pnpm CI](https://pnpm.io/continuous-integration), [pnpm package metadata](https://pnpm.io/package_json), [uv project workflow](https://docs.astral.sh/uv/guides/projects/), [uv locking](https://docs.astral.sh/uv/concepts/projects/sync/), [Biome CLI](https://biomejs.dev/reference/cli/), [ShellCheck](https://github.com/koalaman/shellcheck), [shfmt](https://github.com/mvdan/sh), [GitHub rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)

**Alternatives considered**:

- npm, Yarn, or Bun beside pnpm: rejected because multiple package managers and lockfiles make local and CI resolution diverge.
- ESLint plus Prettier: viable, but Biome supplies one modern, read-only CI gate for the languages used in this feature; strict TypeScript remains separate.
- Python virtual environments or dependency files managed outside uv: rejected because they create a second, non-canonical resolution path.
- Advisory CI without a required ruleset check: rejected because a green workflow is not enforceable if a pull request can merge without it.

## Resolved Unknowns

All technical-context unknowns needed for this feature are resolved. Yjs versus Automerge, Electron SQLite details, encrypted-volume provisioning, backup-key recovery, authentication, and public rendering remain deliberate decisions for their later feature plans, not unresolved inputs to this plan.
