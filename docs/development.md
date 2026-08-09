# Development guide

How to work on this repository: the pinned toolchain, the test layers, the
commands you run locally, and what blocks a merge.

## Toolchain policy

| Concern | Tool | Where it is pinned |
| --- | --- | --- |
| Node.js | 24 LTS (`>=24.0.0 <25`) | `engines.node` in `package.json` |
| Package manager | pnpm, exact release | `packageManager` in `package.json` |
| Dependency lock | `pnpm-lock.yaml` | committed; installs use `--frozen-lockfile` |
| Format + lint (TS/TSX/JSON/CSS) | Biome | `biome.jsonc` |
| Types | TypeScript strict | `tsconfig.base.json` |
| Shell | ShellCheck + shfmt, pinned versions | `scripts/ci/check-shell.ts`, `.github/workflows/ci.yml` |
| Tests | Vitest + fast-check + Playwright | `vitest.config.ts`, `vitest.workspace.ts`, `playwright.config.ts` |
| Database | PostgreSQL 18 | `compose.yaml` |

### pnpm is the only Node.js package manager

Use `pnpm` for every dependency and script operation. `npm`, Yarn, and Bun
lockfiles or install workflows must not be introduced — `pnpm toolchain:check`
fails the build if a foreign lockfile appears.

```bash
corepack enable          # once, to get the pinned pnpm release
pnpm install --frozen-lockfile
```

### Python (not used yet)

This feature ships no first-party Python. If a later feature introduces it,
it must use **uv exclusively**: a `pyproject.toml`, a pinned `.python-version`,
and a committed `uv.lock`. Ad hoc `pip`, `virtualenv`, Poetry, Pipenv, and
Conda project workflows are forbidden and `pnpm toolchain:check` rejects them.

### TypeScript only

Maintained application and test source is TypeScript. CI rejects first-party
`.js` and `.jsx` files outside generated build output.

## Running the app locally

```bash
docker compose up -d --wait postgres
pnpm db:migrate
pnpm dev
```

Every published port binds to `127.0.0.1` only. There is no supported
production composition before authentication exists.

Copy `.env.example` to `.env` to override defaults. Never put real secrets in
`.env.example`.

> **PostgreSQL 18 volume note**: the volume must mount at
> `/var/lib/postgresql`, not `/var/lib/postgresql/data`. The `postgres:18`
> image places data in a major-version subdirectory itself and refuses to
> start when the inner path is mounted directly.

## Test layers

Each layer answers a different question. A numeric coverage target never
substitutes for the behavioral layers.

| Command | Layer | Needs Docker |
| --- | --- | --- |
| `pnpm test:unit` | Domain rules, client-core, contracts, blob store | no¹ |
| `pnpm test:property` | Randomized invariants (fast-check) | no |
| `pnpm test:integration` | PostgreSQL constraints, transactions, migrations | **yes** |
| `pnpm test:contract` | OpenAPI conformance, export round-trips, compose security | **yes**¹ |
| `pnpm test:e2e` | Playwright journeys, 5 browser/viewport projects | **yes** |
| `pnpm test:coverage` | All of the above plus coverage thresholds | **yes** |
| `pnpm test:performance` | 10,000-item / 1,000-operation suites | **yes** |
| `pnpm db:test-migrations` | Empty-database and forward-fixture migrations | **yes** |

¹ `tests/contract/export.spec.ts` needs PostgreSQL, so it fails inside
`test:unit` when Docker is unavailable. Everything else in that command runs
without it.

### Working without Docker

Suites that need PostgreSQL prefer, in order:

1. `TEST_DATABASE_URL` — an already running disposable PostgreSQL. Each
   acquisition creates a uniquely named database and drops it afterwards.
2. Testcontainers, which starts `postgres:18` per suite.

On WSL, enable Docker Desktop's WSL integration, or point
`TEST_DATABASE_URL` at a reachable instance:

```bash
export TEST_DATABASE_URL=postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion_test
```

Without either, the aggregate coverage percentage cannot be reproduced
locally: the DB and API suites contribute to it, so their files report 0% and
drag the total below the threshold. Validate coverage in CI in that case.

## Before you push

```bash
pnpm toolchain:check
pnpm format:check
pnpm lint
pnpm shell:check
pnpm typecheck
pnpm test:unit
pnpm test:property
pnpm build
```

Then, with Docker available:

```bash
pnpm test:integration
pnpm test:contract
pnpm test:coverage
pnpm test:e2e
```

Write mode for formatting is separate on purpose: `pnpm format:write` and
`pnpm lint --write` change files, the `:check`/`ci` variants never do.

### Vendored Spec Kit scripts

`.specify/scripts/bash/` holds upstream Spec Kit workflow scripts. They are
still checked by ShellCheck and shfmt and their findings are printed, but they
do not fail the shell gate: we do not own their style and must not rewrite
them. Findings in every first-party script do fail the gate.

## Coverage thresholds

`vitest.config.ts` enforces 90% statements, lines, and functions and 85%
branches over `packages/*/src` and `apps/api/src`.

Excluded, with the reason:

- `apps/web/**` — exercised by Playwright journeys; browser rendering is not
  meaningfully measurable under V8/node.
- `apps/api/src/context.ts`, `packages/blob-store/src/blob-store.ts` — type-only
  declarations with no executable statements.
- `apps/api/src/server.ts` — process entry point (binds signals, calls
  `listen()`/`process.exit()`). Recorded as an explicit exception in
  `specs/001-content-foundations/plan.md`.

Lowering a threshold or excluding executable first-party code requires a
recorded exception in the active feature's plan.

## What blocks a merge

CI runs the checks above as parallel jobs and aggregates them into one
`quality-gate` status. `quality-gate` fails when any required job fails, is
cancelled, is skipped, or is missing.

`.github/rulesets/main.json` is the branch-protection definition that makes
`quality-gate` and a pull request mandatory on `main`. It is imported and
active, and it applies to the owner too (`bypass_actors` is empty), so:

- **`main` accepts no direct pushes.** Work on a branch and open a pull request.
- A PR cannot merge until `quality-gate` passes.

```bash
git switch -c feat/my-change
# ... commit ...
git push -u origin feat/my-change
gh pr create --fill
```

The definition is a file, not automatically an active setting — if it is ever
re-created from scratch, import it and verify:

```bash
gh api --method POST repos/<owner>/<repo>/rulesets --input .github/rulesets/main.json
gh api repos/<owner>/<repo>/rulesets   # an empty array means main is unprotected
```

## Specification workflow

Product intent lives in `spec.md`, technical decisions in `plan.md`, and
progress in `tasks.md`, all under one directory per feature in `specs/`.
Never copy them into agent-specific documents. The governing rules are in
`.specify/memory/constitution.md`.

Typical order: `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` →
`/speckit-analyze` → `/speckit-implement` → `/speckit-converge`.
