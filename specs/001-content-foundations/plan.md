# Implementation Plan: Canonical Content Foundations

**Branch**: `codex/001-content-foundations-spec` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-content-foundations/spec.md`

## Summary

Deliver the first vertical slice of the single-owner knowledge workspace: a responsive offline-capable hierarchy UI and versioned API for creating, nesting, ordering, moving, trashing, restoring, and relating pages, folders, and canonical files. Keep domain rules platform-independent, persist authoritative state and causal revision lineage transactionally in PostgreSQL, persist the browser projection and outbox transactionally in IndexedDB, store immutable file content behind a blob-store contract, and prove invariants with unit, property, integration, contract, fault-injection, and Playwright tests.

This feature deliberately does not implement authentication, production exposure, rich block editing, real-time notifications, automatic conflict merging, backup execution, or encrypted volumes. It does implement the minimum local projection, outbox, cursor catch-up, and conflict capture needed for honest offline reading and editing.

## Technical Context

**Language/Version**: TypeScript 5.x exclusively, in strict mode, on Node.js 24 LTS; no first-party `.js` or `.jsx` source files

**Primary Dependencies**: React 19, Vite, Dexie over IndexedDB, Workbox for the versioned application shell, Fastify 5, JSON Schema, Drizzle ORM with reviewed SQL migrations, pnpm workspaces, Biome for TypeScript-family formatting/linting, ShellCheck and shfmt for Bash

**Storage**: PostgreSQL 18 for server-canonical metadata/revisions; Dexie/IndexedDB for the browser projection, outbox, and cursors; immutable file blobs behind a filesystem adapter for development and a storage contract for later encrypted/object-backed adapters

**Testing**: Vitest with V8 coverage, fast-check property tests, Testcontainers with PostgreSQL 18, OpenAPI contract validation, Playwright across Chromium/Firefox/WebKit and desktop/mobile viewports

**Target Platform**: Self-hosted Linux server through Docker Compose; current evergreen browsers for the responsive web client

**Project Type**: TypeScript monorepo containing a web client, HTTP API, domain packages, persistence adapters, contracts, and end-to-end tests

**Performance Goals**: Common hierarchy reads and single-item mutations complete within 150 ms p95 on the reference 10,000-item fixture; initial hierarchy navigation becomes usable within 2 seconds on the reference local deployment; randomized 1,000-operation integrity suites complete within CI limits without invariant failures

**Constraints**: Permanent single owner; all maintained application and test source is TypeScript, never handwritten JavaScript; pnpm is the only Node.js package manager and its exact release plus dependency lock are committed; any future first-party Python uses only uv with a pinned interpreter and `uv.lock`; core loaded content remains readable/editable offline; local mutation state and outbox commit atomically; no fixed product nesting depth; cycle-free hierarchy; atomic multi-record mutations; 30-day trash; complete superseded revision content retained 24 hours; lineage metadata retained after content expiry; one canonical file may have many placements; independent imports never become one logical file; all service ports bind to `127.0.0.1` until authentication is complete

**Scale/Scope**: One workspace, 10,000 canonical items in acceptance fixtures, at least 100 placements for one file, hierarchies deep enough to exercise iterative traversal and resource guards, and complete coverage of all containment combinations

## Constitution Check

*GATE: Passed before research and re-checked after design.*

| Principle | Gate | Result |
| --- | --- | --- |
| I. User Ownership and Local Resilience | Canonical data has a durable export contract; a durable local projection and outbox keep loaded core content readable/editable without the server | Pass |
| II. One Spec, Any Agent | All requirements, design, contracts, and tasks remain under this single feature directory | Pass |
| III. Incremental, Verifiable Delivery | Each user story has focused lower-layer tests and every changed interactive flow has a Playwright journey | Pass |
| IV. Privacy and Security by Default | Single-owner boundary is explicit; inputs are schema-validated; API is not production-exposed before authentication | Pass |
| V. Simple, Modular Architecture | One API, one web app, one database, and focused packages; no premature sync, backup, MCP, or microservices | Pass |
| VI. Accessible and Predictable Experience | Responsive hierarchy controls use semantic, keyboard-accessible interactions and explicit error/state feedback | Pass |
| VII. Reproducible Toolchains and Enforced Quality | pnpm, lockfiles, Biome, strict types, layered tests, builds, and a protected-branch required check are explicit | Pass |

Post-design re-check: the data model, API contract, and validation guide preserve every gate. No exception requires complexity tracking.

## Project Structure

### Documentation (this feature)

```text
specs/001-content-foundations/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── content-api.openapi.yaml
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
├── api/
│   ├── src/
│   │   ├── app.ts
│   │   ├── routes/
│   │   └── plugins/
│   └── tests/
└── web/
    ├── src/
    │   ├── features/hierarchy/
    │   ├── components/
    │   └── services/
    └── tests/

packages/
├── domain/
│   ├── src/content/
│   ├── src/revisions/
│   └── tests/
├── database/
│   ├── src/schema/
│   ├── src/repositories/
│   ├── migrations/
│   └── tests/
├── blob-store/
│   ├── src/
│   └── tests/
├── client-core/
│   ├── src/local-store/
│   ├── src/outbox/
│   ├── src/reconciliation/
│   └── tests/
├── contracts/
│   ├── src/
│   └── tests/
└── test-utils/

tests/
├── e2e/
├── contract/
└── fixtures/

.github/workflows/
└── ci.yml

compose.yaml
compose.override.yaml
```

**Structure Decision**: pnpm workspaces keep domain rules, browser-local behavior, storage, contracts, and applications independently testable without creating independent deployable services for every module. `apps/api` is the sole application service for this feature; `apps/web` is built and served for local validation. PostgreSQL is the only supporting service. Future Electron, real-time transport, backup, proxy, and scheduler components require their own specs before being added.

## Design Decisions

- Domain commands return typed results and never depend on Fastify, React, Drizzle, browser APIs, or filesystem APIs.
- PostgreSQL is authoritative for accepted canonical mutations. Each mutation runs in one transaction; serializable isolation plus bounded retry is used where parent/placement concurrency can violate invariants.
- UUIDv7 provides client-generatable stable identities while keeping index locality. Identity never depends on names or paths.
- A single placement table models page/folder hierarchy membership and file hierarchy/attachment placements. Constraints and domain validation enforce the permitted matrix.
- Revisions are append-only and link to one or more parents. Current state is materialized for efficient reads; expired 24-hour snapshots may be pruned while minimal ancestry remains.
- File bytes are immutable and content-addressed. Independent logical file records remain separate. Physical reuse requires complete digest verification and byte equality before reuse; updates are copy-on-write.
- The HTTP contract is OpenAPI-first. Runtime request and response schemas are derived from or checked against the shared contract.
- The initial web interface demonstrates all user stories but does not introduce the rich editor. Page content is represented by the versioned canonical document envelope and edited only through minimal test-oriented controls in this slice.
- Dexie stores the browser projection, causal revision headers, durable outbox, last applied change cursor, and conflict records in one versioned local schema. A local mutation commits projected state and outbox entry in one IndexedDB transaction.
- The API exposes ordered durable changes by cursor plus idempotent mutation submission. Notifications are not a delivery mechanism; later WebSockets only prompt cursor catch-up.
- A stale causal base returns a structured conflict containing competing revision identities. The local command and content remain durable until the later conflict-resolution workflow resolves them.
- `compose.yaml` and its development override bind API, web, and database ports to loopback only. No supported production composition exists before authentication.
- Placement identities are client-generatable like every other canonical identity: `CreatePlacement` accepts an optional client UUIDv7 `id` that the server persists verbatim. Without it, an offline client that creates an item and then queues a move against its locally generated placement id would see the move rejected after reconciliation because the server had assigned a different placement identity (decision recorded 2026-08-07 during implementation).

## Development Toolchain

- Root `package.json` pins the supported Node.js line and an exact pnpm release through package metadata. `pnpm-lock.yaml` is committed, local and CI installs use frozen-lockfile verification, and a repository guard rejects npm, Yarn, or Bun lockfiles and install scripts.
- This feature introduces no Python runtime or Python application source. If a later feature introduces first-party Python, it must add a uv-managed `pyproject.toml`, a pinned `.python-version`, and committed `uv.lock`; dependency changes and commands run through uv.
- Biome is the single TypeScript/TSX/JSON/CSS formatter and linter for this feature. CI uses its read-only `ci` command; developer scripts expose separate check and write modes. TypeScript strict checking remains a separate mandatory gate because formatting and linting do not replace type analysis.
- Tracked Bash, including Spec Kit workflow scripts, is checked with pinned ShellCheck and shfmt releases. Managed Spec Kit files are checked without rewriting them; intentional upstream incompatibilities require an explicit narrow configuration and cannot be silently ignored.
- Vitest reports V8 coverage for maintained TypeScript. Initial aggregate floors are 90% for statements, lines, and functions and 85% for branches; lowering a floor or excluding executable first-party code requires a recorded plan exception. These percentages complement rather than replace requirement, property, fault-injection, contract, and end-to-end coverage.
- Every interactive UI behavior added by this feature has a Playwright journey. The complete suite runs against Chromium, Firefox, and WebKit with desktop and mobile-sized projects; CI forbids focused tests and retains reports and traces for failures.
- GitHub Actions exposes one stable aggregate `quality-gate` result covering toolchain policy, frozen dependency installation, formatting, lint, strict types, all test layers, migrations, Playwright, and production builds. The `main` ruleset requires this check and a pull request, so a failing, cancelled, skipped, or missing gate prevents merge.

## Quality Gates

- Frozen pnpm installation, toolchain-policy verification, Biome formatting/linting, ShellCheck, shfmt verification, strict type checking, unit tests, coverage thresholds, property tests, database integration tests, contract tests, Playwright tests, and production builds run in CI.
- CI rejects first-party `.js` and `.jsx` source files outside generated build output, vendored dependencies, and explicitly documented tool-generated artifacts.
- CI rejects foreign Node.js lockfiles and any future unmanaged Python project or dependency workflow.
- Migrations are generated as reviewable SQL and tested both from an empty database and by forward migration from the previous fixture schema.
- Fault injection verifies atomicity around every multi-record mutation boundary.
- The 10,000-item and 100-placement acceptance fixtures run in CI with recorded timings.
- Playwright covers keyboard operation and responsive layouts on Chromium, Firefox, WebKit, and mobile-sized projects.
- Playwright reloads the web app with the API unavailable, validates offline mutations and visible status, then reconnects against duplicate delivery and concurrent-revision fixtures.
- The protected `main` ruleset requires the aggregate `quality-gate`; individual jobs may run in parallel, but the aggregate fails when any required job fails, is cancelled, skipped, or missing.

## Complexity Tracking

No constitution violations or unjustified architecture layers are present.

## Recorded Exceptions

- **Scope**: `apps/api/src/server.ts` is excluded from the Vitest coverage floor (`vitest.config.ts` coverage `exclude`).
- **Reason**: it is the process entry point — it binds `SIGINT`/`SIGTERM`, calls `app.listen()` against a real port, and calls `process.exit()`. Exercising it under a unit/integration test would require starting a live bound server and sending OS signals, which the test suites deliberately do not attempt. Every behavior it wires together (`buildApp()`) is fully covered by the API contract-test suites.
- **Risk**: a regression in the ~20 lines of bootstrap wiring (env var defaults, signal handling, listen-failure exit code) would not be caught by automated tests.
- **Review/removal condition**: revisit this exception if `server.ts` grows beyond bootstrap wiring (e.g., gains branching business logic), or if a smoke-test harness that can bind a real port in CI is introduced.
