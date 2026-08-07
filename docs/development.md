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

Coverage floors are 90% for statements, lines, and functions and 85% for branches. These numbers supplement property, contract, fault-injection, browser, and container journeys; they do not replace them.

## Pull requests and CI

The `quality-gate` check aggregates frozen installation, toolchain policy, Biome, ShellCheck/shfmt, strict types, coverage, database integration, migrations, API contracts, Playwright, production builds, and the production-like container smoke test. The protected `main` branch requires a pull request and a successful `quality-gate`; failed, cancelled, skipped, or missing jobs block merge.

Container pull requests build both images without publishing them. Accepted `main` revisions and release tags publish multi-architecture API and web images to GitHub Container Registry with immutable `sha-<full-commit>` tags. See [deployment.md](./deployment.md) for the documented production-like evaluation flow.
