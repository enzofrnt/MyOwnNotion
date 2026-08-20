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
| Sync protocol | version 2 | `packages/domain/src/sync/protocol-version.ts` |

### The sync protocol version is part of the toolchain

`packages/domain/src/sync/protocol-version.ts` declares three numbers, and a
release has to think about all three:

| Constant | Meaning |
| --- | --- |
| `PROTOCOL_VERSION` | what this server speaks, sent on every response as `X-MyOwnNotion-Protocol` |
| `MINIMUM_WRITE_VERSION` | the oldest client still allowed to write |
| `MINIMUM_READ_VERSION` | the oldest client still allowed to read |

**The window is two stable versions.** A stable server accepts the matching
stable client and the one immediately before it, for as long as their protocol
stays compatible. That is what makes an upgrade something an owner can do at
their own pace on each device instead of all at once.

Raising `MINIMUM_WRITE_VERSION` is therefore a decision with a date attached: it
stops a device that is one release behind from writing. Raising
`MINIMUM_READ_VERSION` is heavier still, because a client that can read can at
least copy an owner's work out of a machine that is behind, and refusing reads
takes that away. Prefer read-only over refused whenever a read is safe.

`MINIMUM_READ_VERSION` must never exceed `MINIMUM_WRITE_VERSION`; inverted, the
read-only state would be unreachable and the pair would express nothing a single
number could not. A unit test holds that invariant.

Feature 009 is the first incompatible write change: protocol 2 adds structured
database state that protocol 1 cannot represent. Protocol 1, including a client
that sends no version header, therefore remains readable but is read-only;
protocol 2 is required for writes.

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

Every published port binds to `127.0.0.1` only.

Copy `.env.example` to `.env` to override defaults. Never put real secrets in
`.env.example`.

### Backup and recovery commands

Administrative recovery runs locally, with the same mounted deployment key as
the API. It is not exposed as a destructive HTTP endpoint.

```bash
pnpm admin backup run --json
pnpm admin backup verify --latest --json
pnpm admin restore test --latest --json
pnpm admin restore apply --id <backup-id> --dry-run
pnpm admin version inspect --json
```

`restore test` creates and migrates a disposable PostgreSQL database, writes the
whole archive into it, then drops it. It never opens the live database as a
restore target. `restore apply` first checks the key, archive integrity,
compatibility and scope, takes a safety backup, and finally requires either the
interactive `RESTORE` confirmation or `--yes`. Without a terminal it refuses to
assume consent. Use `--dry-run` to perform the checks without writing or taking
the safety backup.

The filesystem destination defaults to `.dev-backups/` locally. In Compose it
uses the durable `backup-store` volume, separate from the original blob volume.
To use Google Drive, set `MYOWNNOTION_BACKUP_DESTINATION=google-drive`, mount an
access-token file, and set both Drive variables documented in `.env.example`.

If `/health` reports `restoration-incomplete`, do not treat the installation as
ready. Re-run the same `restore apply --id …` command after fixing the cause, or
deploy the safety backup recorded immediately before the attempt.

Both `pnpm db:migrate` and the Compose migration job run the update guard. On a
version change, it produces and re-reads a `pre-update` backup before any pending
migration. A failed verification stops the process with the previous schema
untouched. `pnpm admin version inspect` shows the running and recorded versions,
pending migrations, and whether a verified backup exists for the version being
left. After an update it also names the exact previous `sha-…` image tag, the
matching backup, and the previous schema and encrypted-record format versions.

### Server logging

The API has one logger factory in `apps/api/src/plugins/logging.ts`. In an
interactive terminal it renders compact single-line logs with colored severity
labels. In Docker/Compose it writes one JSON object per line to stdout without
ANSI codes, so the container runtime can parse and route records. Configure
verbosity with `MYOWNNOTION_LOG_LEVEL`; use
`MYOWNNOTION_LOG_COLOR=auto|always|never` only when the destination is known.
`auto` is the safe default.

Feature code uses the logger Fastify already provides:

```ts
request.log.info({ itemId, operation: "move" }, "content item moved");
```

- Use `request.log`/`reply.log` for request work and `app.log` for lifecycle or
  background work.
- Put stable safe context in the first object and a stable message second.
- Never instantiate a feature-owned logger or use `console.*` for server
  events; doing so bypasses shared metadata, output selection, and redaction.
- Never interpolate private content, names, bodies, credentials, tokens, kits,
  cookies, authorization values, or key material into a message or field.
- Extend and test the central allowlist/redaction policy when a feature needs a
  new field. Do not locally disable a serializer or redaction path.

Inspect container output with `docker compose logs --no-color api`. Application
containers do not own log files or rotation; retention belongs to the Docker
logging driver or the deployment's collector.

### Running the published stack locally

`docker compose up -d` also loads `compose.override.yaml`, which builds the
images from this checkout. To run the published images instead, select the base
file only:

```bash
MYOWNNOTION_API_IMAGE=ghcr.io/enzofrnt/myownnotion-api:sha-<commit> \
MYOWNNOTION_WEB_IMAGE=ghcr.io/enzofrnt/myownnotion-web:sha-<commit> \
MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1 \
docker compose -f compose.yaml up -d
```

Then open the published web port. The client and the API share that one origin:
nginx serves the static shell and proxies `/v1/` and `/health` to the API,
because the `__Host-` session cookie is returned only to the origin that set it.

The `migrate` job applies the reviewed SQL and the API waits for it to exit
successfully, so a first run against an empty volume needs no extra step. Watch
it with `docker compose logs migrate`.

Three settings decide whether this works, and each fails quietly on its own:

- **the ports must be free.** `pnpm dev` already holds 3001; Compose then
  leaves the containers `Created` and prints no container logs at all;
- **`MYOWNNOTION_PUBLIC_ORIGIN` must be the origin you open**, port included.
  It defaults to the published web port;
- **`MYOWNNOTION_DEV_LOOPBACK_HTTP_COOKIE=1` is required for an http origin.**
  Without it the security configuration is refused. Under `NODE_ENV=production`
  the API then refuses to start rather than serve a workspace with no
  installation, bootstrap, authentication, or session routes, so the container
  exits and restarts instead of reporting itself healthy. `docker compose logs
  api` carries the reason.

In a real deployment the administrator's reverse proxy terminates HTTPS in
front of the stack. There `MYOWNNOTION_PUBLIC_ORIGIN` is the public https
origin, the loopback exception stays off, and the production `__Host-` cookie
is used.

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
| `pnpm test:migration` | Empty-database and forward-fixture migrations | **yes** |
| `pnpm test:security` | Owner security foundation suites across every project | **yes** |
| `pnpm test:e2e` | Playwright journeys, 5 browser/viewport projects | **yes** |
| `pnpm test:coverage` | All of the above plus coverage thresholds | **yes** |
| `pnpm test:performance` | 10,000-item / 1,000-operation suites | **yes** |
| `pnpm db:test-migrations` | Alias of `test:migration`, kept for existing scripts | **yes** |

¹ `tests/contract/export.spec.ts` needs PostgreSQL, so it fails inside
`test:unit` when Docker is unavailable. Everything else in that command runs
without it.

### The browser matrix locally

```bash
pnpm test:e2e:local          # fast feedback: projects in parallel
pnpm test:e2e:gate           # the pre-push answer: one project at a time
pnpm test:e2e:local -- --grep "live sync"   # arguments pass through
```

**Two commands, because they answer different questions.** `test:e2e:local` runs
projects side by side and is what to use while working. `test:e2e:gate` is the
same runner with one project at a time, and it is what `checks:local` runs before
a push.

The split is not caution, it is a measured limit: a handful of journeys cannot
share a machine with another browser. The clearest is the keyboard-navigation
journey, which fails with `toBeFocused` receiving `inactive` — the operating
system does not consider that window active, because another browser has the
focus. No timeout can fix that, and no amount of it is the application's
behaviour. Others simply miss their budget while three engines compete.

CI is unaffected: it gives each project its own runner, so nothing there competes
for anything.

**Every browser project runs at once, each on its own stack.** The matrix used
to run one project after another, and the reason was not the browsers: every
journey resets the same database, so two projects sharing one would delete each
other's content mid-test. That is a statement about shared state, so
`scripts/e2e/run-local-matrix.ts` gives each project state of its own instead of
making them take turns —

| Isolated per project | Why |
| --- | --- |
| its own database, created and dropped by the runner | the reason the suites were sequential |
| its own API and web ports (from 3301 and 5473) | five dev servers have to coexist |
| its own blob root | otherwise file journeys read each other's bytes |
| its own deployment key | a shared file is a shared fate if a run rewrites it |

PostgreSQL itself is *not* isolated: one server, several databases. Starting
five servers would cost more than the parallelism saves.

The runner refuses to start when one of its ports is taken, and says which.
That check is not politeness. Playwright's `reuseExistingServer` is on locally,
so a port held by another checkout is silently *adopted* — and the matrix then
reports on code nobody is looking at. That has happened, and it cost more than
the failed run it replaced.

**Two projects at a time by default, not five.** A stack is a browser, a Vite
server and an API process, and what gives way under saturation is not the machine
but the journeys — a click waiting on a render, an assertion budgeted for a quiet
machine. Five at once failed differently on every attempt; three was green once
and then failed twice, both times on WebKit, which is the expensive engine. Two is
what proved repeatable on a fourteen-core laptop, and it still runs the matrix in
about nine minutes against sixteen sequentially.

The number is measured rather than derived from the core count, because cores are
not the scarce resource here — memory and the dev servers are.
`MYOWNNOTION_E2E_JOBS` raises it on a machine with room, or lowers it to `1` to
reproduce a sequential run. A gate that is green two times in three is not a gate.

`MYOWNNOTION_E2E_API_PORT_BASE` and `MYOWNNOTION_E2E_WEB_PORT_BASE` move the port
range, which is rarely needed.

Each project's full output is written to `.e2e-logs/<project>.log`, always —
five runs interleaving into one terminal is unreadable, and a summary is at the
mercy of whatever the caller piped it through. Failure artefacts go to
`test-results/<project>/`, one directory per stack: Playwright *clears* its
output directory when it starts, so a shared one means each stack deleting the
traces and screenshots of the others.

On macOS, Firefox runs inside the pinned Linux image, because Playwright's
patched Firefox hangs before opening a page on the macOS development runtime.
That project starts its servers inside the container and reaches PostgreSQL
through `host.docker.internal`, so it needs a database of its own and nothing
else. It runs alongside the others rather than after them.

`pnpm test:e2e` remains the single-stack command CI uses, and the one to reach
for when debugging one journey.

### Security test harness

`tests/fixtures/security.ts` is the entry point for the controlled clock,
disposable installation, mounted deployment-key fixtures, feature-001 identity
snapshots, the software WebAuthn authenticator, and fault injection.
`packages/database/tests/helpers/security-db.ts` adds the database-backed
variants (committed `ownerCount`/`workspaceCount`, serializable concurrency).

Playwright journeys use `attachVirtualAuthenticator` in `tests/e2e/helpers.ts`,
which is Chromium-only and returns `supported: false` elsewhere so a journey
skips rather than fails.

Security suites never sleep for a timeout: advance the controlled clock
instead, so the 15-minute bootstrap window and the session bounds are asserted
at exact instants.

### Search checks

Search spans the shared domain engine, canonical source reads, the API, the
local worker and browser journeys. These commands give focused feedback while
working on that feature; they do not replace `pnpm checks:local` before a push.

```bash
pnpm exec vitest run --project domain \
  tests/search-normalise.spec.ts tests/search-document-text.spec.ts \
  tests/search-index.spec.ts tests/search.property.spec.ts
pnpm exec vitest run --project database-integration \
  tests/search-source.integration.spec.ts tests/reference-backups.integration.spec.ts
pnpm exec vitest run --project api-contract \
  tests/search-service.spec.ts tests/search.contract.spec.ts \
  tests/search-rebuild.spec.ts tests/search-security.spec.ts
pnpm exec vitest run --project client-core \
  tests/local-search-source.spec.ts tests/search-merge.spec.ts
pnpm exec vitest run --project web \
  tests/search-dialog.spec.ts tests/search-worker.spec.ts
pnpm test:e2e:local -- --grep "workspace search|search dialog"
```

The dedicated benchmark is:

```bash
pnpm exec vitest run --project performance tests/performance/search.perf.spec.ts
```

It models 100,000 pages, one million flattened visible blocks and 50,000 file
names on the server, plus a 10,000-item local index. It records server and local
p50/p95, build time and heap, local upserts, second-device propagation and
10,000 idempotent replays. The operational interpretation and the latest
reference figures live in `docs/architecture/search.md`.

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
drag the total below the threshold. Development and targeted non-database tests
may continue, but a branch that requires the application pre-push gate MUST NOT
be pushed until the Docker-backed gate has run successfully on this machine or
an equivalent development environment. The documentation-only exception below
does not require Docker. CI is confirmation of required local evidence, not a
substitute for it.

## Before you push

First classify the complete diff against its merge base.

A change is **documentation-only** when every changed file is maintained prose
or a Spec Kit artifact with no executable consumer. Typical examples are
Markdown under `docs/` or `specs/`, plus repository guidance such as
`AGENTS.md`, `README.md`, or `CONTRIBUTING.md`. OpenAPI documents, security
schemas, fixtures, generated templates, scripts, workflow files, configuration,
and documentation consumed by tests are not documentation-only.

For a documentation-only change, run all of the following that apply:

```bash
git diff --check
# Review links, headings, terminology, and references in every changed document.
# For Spec Kit artifacts, run the feature prerequisite and cross-artifact
# consistency checks described by the relevant project skills.
```

Do not start application tests, browser suites, builds, image builds, security
scans, or Compose checks for a documentation-only change. Record the checks
performed in the pull request.

For code, dependency, migration, build, deployment, configuration,
executable-schema, or mixed changes, run:

```bash
pnpm checks:local
```

This is the hard pre-push gate for executable or potentially executable
changes, not a suggested smoke test. It runs the local equivalents of every
repository-controlled PR job: toolchain policy, shell, format/lint, strict
types, aggregate coverage, the separately observable database/migration and
contract suites, the complete browser/viewport matrix, production and
multi-architecture image builds, dependency/secret/static/license security
checks, and Compose boundaries. Every command must finish successfully against
the exact commit that will be pushed. If classification is uncertain, fail
closed to this full gate.

Targeted tests are still the fastest feedback while editing, but they are not
pre-push evidence. Do not push with a known failure, an interrupted gate, or a
required check silently skipped. If a local runtime cannot execute a check, use
the documented equivalent runtime. If no equivalent is available, stop and
report the blocker instead of delegating discovery of it to the pull request.

The container vulnerability job itself is implemented by a pinned GitHub
Action. When dependency manifests, lockfiles, Dockerfiles, or pinned base-image
digests change, run an equivalent local Trivy scan before pushing or do not
push. When none of those inputs changed, a green scan for the branch's current
base commit is valid unchanged-input evidence; the PR reruns and confirms it.
SARIF upload and GitHub Security-tab publication are GitHub-only presentation
steps, not local product validation.

### Firefox end-to-end tests on macOS

The patched Firefox binary downloaded by Playwright currently hangs during
startup on the macOS development workstation, in both headless and headed
modes, before the first page is created. The symptom is a Firefox process at
100% CPU with a `RenderCompositorSWGL failed mapping default framebuffer` log.
This is a browser/runtime issue, not an application-test failure.

`pnpm checks:local` invokes `pnpm test:e2e:local`. On macOS that wrapper runs
Chromium and WebKit directly, then runs Firefox in the official Playwright
Linux container. The
container uses the same Playwright version as the repository and reaches the
host PostgreSQL service through `host.docker.internal`:

```bash
docker compose up -d --wait postgres
pnpm db:migrate
pnpm test:e2e:firefox-container -- --project=firefox-desktop
```

Additional Playwright arguments are forwarded after `--`, for example:

```bash
pnpm test:e2e:firefox-container -- --project=firefox-desktop --grep "first-run gate"
```

This is the required local path for Firefox on macOS. Chromium and WebKit may
still run directly on the host. The container is headless by default; failed
journeys retain the usual Playwright traces and screenshots for debugging.

**Run the container and the host suites one after the other, never at the same
time.** Both reach the same PostgreSQL database, and every journey resets the
canonical content in its `beforeEach`, so two concurrent suites delete each
other's fixtures. The failures that follow look nothing like the cause: rows
that never appear, and journeys that normally take a second taking twenty. Run
Firefox first or last, but alone.

Pushing a work branch triggers no automated gate: **the pull request is the
first remote gate**, so the applicable local gate must pass before every push.

### Pull-request test impact policy

Pull-request CI calculates one versioned impact plan before starting test jobs.
The policy lives in `ci/test-impact.json`; its executable implementation is
`scripts/ci/test-impact.ts`. The generated `test-impact.json` is uploaded with
the run and the same selection is rendered in the GitHub job summary.

The policy has three outcomes for each changed path:

- maintained Markdown and other declared non-executable paths with no test
  consumer start no application test process;
- supported TypeScript sources use Vitest's static dependency graph, while E2E
  journeys use the explicit owner map in `ci/test-impact.json`;
- lockfiles, global fixtures/configuration, missing comparison data, and any
  unknown executable path fail closed to the complete relevant corpus.

A changed test always runs directly. Test-consumed documents, such as the
committed OpenAPI and security schemas, map to their contract tests even though
they live under `specs/`. Unit, integration, contract, and E2E jobs remain
present when their selection is empty and report a successful explicit no-op;
branch protection therefore never relies on a skipped or missing check.

Selection is intentionally limited to pull requests. Pushes to `main`, version
tags through the reusable gate, manual diagnostics, and `pnpm checks:local`
always run the full corpus. Documentation-only work branches use the targeted
local policy above; executable or mixed work branches still run
`pnpm checks:local` in full before push. Full runs are both release evidence and
the safety net that exposes an incomplete ownership map.

Useful local diagnostics:

```bash
pnpm ci:test-impact --event pull_request --ref refs/pull/1/merge \
  --base HEAD~1 --head HEAD --pr-number 1 --changed docs/development.md
pnpm ci:test:affected --plan test-impact.json --group unit
```

When adding or renaming a Playwright `tests/e2e/*.spec.ts` journey, add it to
`e2eJourneys` in the same change. Policy contract tests fail if any maintained
journey is missing, duplicated, ownerless, or points to a nonexistent consumer.

### CI cache boundaries

Every Node job uses `actions/setup-node`'s pnpm store cache. Installs remain
`--frozen-lockfile`: a hit avoids package downloads but does not replace
lockfile validation or pnpm's materialization step. E2E jobs separately cache
Playwright browser binaries by runner OS, architecture, and the installed
Playwright version; the system dependency check still runs on every selected
browser job.

Container jobs use BuildKit's GitHub Actions backend in `mode=max`, with
separate `api-…` and `web-…` scopes. Pull requests use a scope owned by their PR
number, `main` uses the trusted `main` scope, and releases use an exact
`release-<sha>` scope. Main and release publication never import a `pr-…` scope,
so untrusted layers cannot become trusted publication input. Cache loss or
eviction only makes the clean operation slower; it never counts as gate
evidence.

Superseded runs for the same pull request are cancelled automatically. Main,
release, manual, and unrelated pull-request runs use distinct concurrency
groups and cannot cancel one another.

Write mode for formatting is separate on purpose: `pnpm format:write` and
`pnpm lint --write` change files, the `:check`/`ci` variants never do.

### Delivery gate inventory

The same gate responsibilities exist at all three stages — local checks, the
pull request, and `main`. Local and trusted runs execute the complete named
scripts. A pull request may instead run the equivalent affected subset through
`ci:test:affected`, using the policy above. `scripts/ci/check-toolchain.ts`
fails when any complete or selective entry point is missing from
`package.json`, so the gate cannot silently lose a check.

| Script | Stage | Blocking rule | Artifact |
| --- | --- | --- | --- |
| `toolchain:check` | local, PR, main | Unpinned toolchain, foreign lockfile, or a missing gate script blocks | — |
| `shell:check` `format:check` `lint:ci` `typecheck` | local, PR, main | Any finding blocks | — |
| `test:unit` `test:property` `test:integration` `test:contract` `test:migration` `test:security` | full locally/main; affected subset or explicit no-op on PR | Any selected failure blocks; unknown impact selects the full suites | — |
| `test:e2e` (`test:e2e:local` on macOS) | full locally/main; owned journeys or explicit no-op on PR | Any selected journey blocks; unknown impact selects every journey | Playwright report per browser/viewport |
| `security:audit` | local, PR, main | Any high/critical vulnerability or an unavailable audit blocks | `dependency-audit.json` |
| `security:secrets` | local, PR, main | Any detected secret or a scanner failure blocks | `secret-scan.sarif` |
| `security:static` | local, PR, main | Any high-confidence finding or an analyzer failure blocks | `static-security.sarif` |
| `security:licenses` | local, PR, main | Any denied or unresolvable license blocks | `license-policy.json` |
| `build` `compose:check` | local, PR, main | Build failure or a Compose boundary violation blocks | — |
| `images:build` | local, PR, main | Unpinned base digest or a build failure blocks; builds on every candidate and pushes nothing | `image-build.json` |
| pinned Trivy container scan | conditional local evidence, PR, main | Any high/critical vulnerability with a fix, or an unavailable required scan, blocks | `container-scan.sarif` |
| `release:gate` | tag | Missing, stale, foreign-commit, or artifact-less gate evidence blocks publication | — |

Base images are pinned by manifest-list digest in `docker/base-images.json`.
`pnpm images:build` refuses to build while a digest is empty; run
`pnpm images:build --resolve` on a machine with a Docker daemon and commit the
result.

Secrets never live in the repository, an image, a log, or `.env.example`. A
variable whose name ends in `_FILE` holds a path; the value arrives as a
mounted file. The deployment wrapping key is
`MYOWNNOTION_DEPLOYMENT_KEY_FILE`, mounted at `/run/secrets/deployment-key` in
the official stack. `secrets/` is gitignored and excluded from every build
context.

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
