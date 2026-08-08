# Development guide

## Supported toolchain

Use Node.js 24 and the exact pnpm release declared by `packageManager` in the root `package.json`. Corepack is the supported way to activate pnpm:

```text
corepack enable
pnpm install --frozen-lockfile
```

pnpm is the only Node.js package manager for this repository. Do not add npm, Yarn, or Bun lockfiles. The current product contains no Python. If first-party Python is introduced by a later specification, it must use uv, a pinned interpreter, and a committed `uv.lock`; do not create pip, Poetry, Pipenv, or Conda workflows.

Run `pnpm toolchain:check` after changing dependencies, runtime configuration, or repository scripts. The check rejects unsupported source languages, foreign lockfiles, and unmanaged Python projects.

## Local services

Start the loopback-only development database and apply reviewed migrations:

```text
docker compose up -d --wait postgres
pnpm db:migrate
```

Then start the API and web client with `pnpm dev`. Copy `.env.example` only when local overrides are needed. Never commit secrets. Development ports and the production-like evaluation composition bind to `127.0.0.1` because authentication is not implemented yet.

Page authoring, the version 3 document format, wiki links, backlinks, graphs, slash commands, Markdown shortcuts, auto-save states, offline restart, and compatibility behavior are documented in [editor.md](./editor.md).

## Formatting and static checks

Biome is the formatter and linter for TypeScript, TSX, JSON, and CSS:

```text
pnpm format:check
pnpm lint:ci
pnpm typecheck
```

Use `pnpm format:write` for intentional formatting changes. Tracked first-party shell scripts are checked by pinned ShellCheck 0.11.0 and shfmt 3.12.0 through `pnpm shell:check`. Generated files under `.specify/scripts/` are the sole explicit exclusion: refresh them with the Specify CLI instead of editing them manually.

## Test layers

Run the smallest relevant suite while developing, then the full gates before requesting review:

```text
pnpm test:unit
pnpm test:property
pnpm test:integration
pnpm db:test-migrations
pnpm test:contract
pnpm test:performance
pnpm test:coverage
pnpm test:e2e
pnpm test:containers
pnpm build
```

Database and API suites use disposable PostgreSQL instances. Playwright starts the API and web client and exercises Chromium, Firefox, and WebKit across desktop and mobile profiles. The container smoke test builds the API and web images, verifies migrations and direct/proxied health, restarts the composition, and proves named-volume persistence.

For focused block-editor work, run the web unit project, the editor Playwright files, and `tests/performance/block-editor.perf.spec.ts` before the complete gates. Browser journeys cover online/offline reload, conflicts, slash commands, Markdown input rules, keyboard focus, responsive overflow, and critical Axe findings.

For focused links-and-knowledge-graph work, run the domain, client-core, database-integration, API-contract, and web-unit projects before the wiki-link/backlink/graph Playwright files and `tests/performance/knowledge-graph.perf.spec.ts`. Principal browser journeys attach deterministic desktop and mobile images to the Playwright report; the CI report and traces are the GitHub review evidence rather than committed generated binaries.

When debugging link projection, compare three identities before changing data: the source page UUID, the target page UUID, and the occurrence UUID stored in the document mark. The occurrence UUID is also the derived relationship identity. A page save, revision restore, snapshot rebuild, and incremental catch-up must always update the document and its `link:references` rows as one logical state. Conflict records deliberately preserve the local document and link projection until the owner resolves them.

Canonical export tests must assert the versioned page document and the corresponding relationship rows together. `validateCanonicalExport` checks endpoint and revision references; canonical serialization additionally proves deterministic round-trip behavior.

Coverage floors are 90% for statements, lines, and functions and 85% for branches. These numbers supplement property, contract, fault-injection, browser, and container journeys; they do not replace them.

## Pull requests and CI

The `quality-gate` check aggregates frozen installation, toolchain policy, Biome, ShellCheck/shfmt, strict types, coverage, database integration, migrations, API contracts, Playwright, production builds, and the production-like container smoke test. The protected `main` branch requires a pull request and a successful `quality-gate`; failed, cancelled, skipped, or missing jobs block merge.

Container pull requests build both images without publishing them. Accepted `main` revisions and release tags publish multi-architecture API and web images to GitHub Container Registry with immutable `sha-<full-commit>` tags. See [deployment.md](./deployment.md) for the documented production-like evaluation flow.
