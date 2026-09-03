# Development guide

How to work on this repository: the pinned toolchain, the test layers, the
commands you run locally, and what blocks a merge.

## Toolchain policy

| Concern | Tool | Where it is pinned |
| --- | --- | --- |
| Runtime, package manager and bundler | Bun 1.4.0 exactly | `packageManager` and `engines.bun` in `package.json` |
| Dependency lock | `bun.lock` | committed; installations use `bun ci` |
| Format + lint (TS/TSX/JSON/CSS) | Biome | `biome.jsonc` |
| Types | TypeScript strict | `tsconfig.base.json` |
| Shell | ShellCheck + shfmt, pinned versions | `scripts/ci/check-shell.ts`, `.github/workflows/ci.yml` |
| Line endings | LF only | `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` |
| Tests | Vitest + fast-check + Playwright | `vitest.config.ts`, `playwright.config.ts` |
| Database | PostgreSQL 18 | `compose.yaml` |
| Sync protocol | version 3 | `packages/domain/src/sync/protocol-version.ts` |

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
database state that protocol 1 cannot represent. Feature 017 adds protocol 3
for convergent page operations. Protocol 1, including a client that sends no
version header, remains readable but is read-only. Protocol 2 can still perform
compatible non-editorial writes, while the page-operation routes require
protocol 3 through their capability-specific gate.

### Bun is the only JavaScript/TypeScript toolchain

Use Bun 1.4.0 for dependency, workspace, script, runtime and production-build
operations. Node.js, npm, pnpm and Yarn workflows or lockfiles must not be
introduced — `bun run toolchain:check` fails on a different Bun patch, a
foreign lockfile or an active command from the retired toolchain.

```bash
bun --version            # must print exactly 1.4.0
bun ci
bun run toolchain:check
```

`bun ci` is the canonical frozen installation. It fails when a manifest and
`bun.lock` differ, and running it twice must leave the lock byte-identical.
JavaScript tools such as TypeScript, Vitest, Vite development server and
Playwright remain specialized dependencies, but Bun installs and launches
them. Imports from `node:*` use Bun's compatibility APIs and do not imply a
Node.js process.

### Python (not used yet)

This feature ships no first-party Python. If a later feature introduces it,
it must use **uv exclusively**: a `pyproject.toml`, a pinned `.python-version`,
and a committed `uv.lock`. Ad hoc `pip`, `virtualenv`, Poetry, Pipenv, and
Conda project workflows are forbidden and `bun run toolchain:check` rejects them.

### TypeScript only

Maintained application and test source is TypeScript. CI rejects first-party
`.js` and `.jsx` files outside generated build output.

## Running the app locally

```bash
docker compose up -d --wait postgres
bun run db:migrate
bun run dev
```

Every published port binds to `127.0.0.1` only.

### Application URLs

The browser path is the source of truth for the visible destination. Use
`/notes` for the workspace, `/notes/<item-id>` for every page-backed item
(pages, folders, databases, and database entries), and the dedicated settings
paths under `/settings/`: `security`, `navigation`, `backups`, `storage-sync`,
`trash`, plus `/settings/page/<item-id>` for one item's details. `/setup` and
`/login` preserve only a validated internal return destination.

Opening a deep path directly must return the application shell. Vite provides
that fallback during development; the Web image provides it through nginx;
the production service worker serves its precached `index.html` for offline
same-origin navigations. API, health, immutable assets, and the service worker
itself are excluded from those fallbacks.

### HTTPS development stack (passkeys)

`http://127.0.0.1:5173` is not a secure context, so the browser will not offer
passkeys. The local helper `compose.dev.yaml` runs PostgreSQL, the schema job,
the Bun API and Vite with hot reload, and a small Caddy with an internal
certificate. The Compose project stays detached: containers keep running, and
file edits are picked up by `bun --watch` and Vite HMR inside those processes.

```bash
bun run dev:stack
```

Open **http://localhost:8080** in an embedded browser (Cursor) — that origin
needs no certificate. Open **https://localhost:8443** in Safari or Chrome; the
hostname must be `localhost`, not an IP. Trust Caddy's local CA once for HTTPS:

```bash
bun run dev:trust
```

`dev:trust` writes the CA and opens it in Keychain Access. Add it to the
**login** keychain (not System Roots), then set SSL to Always Trust. Cursor's
embedded Chromium does not use that store; use HTTP there instead of clicking
through `ERR_CERT_AUTHORITY_INVALID`.

Follow container logs with `bun run dev:stack:logs` without attaching the
project. API and migration entries are compact, human-readable, and colored by
default; set `MYOWNNOTION_DEV_LOG_COLOR=auto` (or `never` to also prohibit
ANSI) for newline-delimited JSON. Stop the stack with
`bun run dev:stack:down`. Wipe the development database, encrypted files, and
local backups (Caddy's CA stays) with `bun run dev:stack:reset`. Starting or
resetting the stack rebuilds images (`docker compose up --build`). File edits
do not rebuild or restart containers; Bun `--watch` and Vite HMR pick them up
inside the running processes. This helper is not the official deployment;
`compose.yaml` still publishes HTTP only.

For a reproducible Knowledge Graph acceptance workspace, run
`bun run dev:stack:demo`. It performs the same destructive local reset, creates
the dummy owner/password and a verified 240-item forest corpus (243 relationships),
and refuses every non-local, non-empty or non-development target. Follow the
separate [server and browser reset procedure](testing/knowledge-graph-demo.md)
before judging a redeployment; a hard reload alone does not clear IndexedDB,
cookies or service-worker caches.

Copy `.env.example` to `.env` to override defaults. Never put real secrets in
`.env.example`.

### Backup and recovery commands

Administrative recovery runs locally, with the same mounted deployment key as
the API. It is not exposed as a destructive HTTP endpoint.

```bash
bun run admin -- backup run --json
bun run admin -- backup verify --latest --json
bun run admin -- restore test --latest --json
bun run admin -- restore apply --id <backup-id> --dry-run
bun run admin -- version inspect --json
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

Both `bun run db:migrate` and the Compose migration job run the update guard. On a
version change, it produces and re-reads a `pre-update` backup before any pending
migration. A failed verification stops the process with the previous schema
untouched. `bun run admin -- version inspect` shows the running and recorded versions,
pending migrations, and whether a verified backup exists for the version being
left. After an update it also names the exact previous `sha-…` image tag, the
matching backup, and the previous schema and encrypted-record format versions.

### Server logging

The API has one logger factory in `apps/api/src/plugins/logging.ts`. In an
interactive terminal it renders compact single-line logs with colored severity
labels. The official Docker/Compose stack writes one JSON object per line to
stdout without ANSI codes, so the container runtime can parse and route
records. The development helpers (`compose.dev.yaml` and
`compose.override.yaml`) explicitly select the same human renderer because
their output is read directly by a developer; configure that choice with
`MYOWNNOTION_DEV_LOG_COLOR=always|auto|never`. Configure verbosity with
`MYOWNNOTION_LOG_LEVEL`; use
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

Inspect local container output with `docker compose logs api`, or
`bun run dev:stack:logs` for the HTTPS helper. Use
`docker compose -f compose.yaml logs --no-color api` when validating the
official JSON output. Application containers do not own log files or rotation;
retention belongs to the Docker logging driver or the deployment's collector.

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

- **the ports must be free.** `bun run dev` already holds 3001; Compose then
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
| `bun run test:unit` | Domain rules, client-core, contracts, blob store | **yes**¹ |
| `bun run test:property` | Randomized invariants (fast-check) | no |
| `bun run test:integration` | PostgreSQL constraints, transactions, migrations | **yes** |
| `bun run test:contract` | OpenAPI conformance, export round-trips, compose security | **yes**¹ |
| `bun run test:migration` | Empty-database and forward-fixture migrations | **yes** |
| `bun run test:security` | Owner security foundation suites across every project | **yes** |
| `bun run test:e2e` | Playwright journeys, 5 browser/viewport projects | **yes** |
| `bun run test:coverage` | Maintained unit/integration/contract code under coverage thresholds | **yes** |
| `bun run test:performance` | 10,000-item / 1,000-operation suites | **yes** |
| `bun run db:test-migrations` | Alias of `test:migration`, kept for existing scripts | **yes** |

¹ `tests/contract/export.spec.ts` needs PostgreSQL, so it fails inside
`test:unit` when Docker is unavailable. Everything else in that command runs
without it.

### The browser matrix locally

```bash
bun run test:e2e:local                       # fast feedback: two projects at a time
bun run test:e2e:gate                        # pre-push: complete matrix, two at a time
bun run test:e2e:local -- --grep "live sync" # arguments pass through
MYOWNNOTION_E2E_JOBS=5 bun run test:e2e:local -- tests/e2e/databases-views.spec.ts
```

**Two commands, because they answer different questions.** Both use isolated
stacks and run two projects concurrently by default. `test:e2e:local` is the
fast feedback command while working; `test:e2e:gate` runs the same complete
matrix from `checks:local` before a push and preserves an explicit
`MYOWNNOTION_E2E_JOBS` value.

Vitest already schedules its test files in parallel within each test layer. For
a focused Playwright relaunch, setting `MYOWNNOTION_E2E_JOBS=5` runs the selected
journey on all five isolated browser profiles at once; this is the fastest way
to confirm a targeted correction. Do not use width five for the complete
Playwright corpus: on the reference fourteen-core laptop, five full stacks
exhaust the browser/server budget, prevent WebKit pages from loading and
can deadlock test cleanup. The complete pre-push gate therefore uses the
measured repeatable width of two. The non-test build, image, security and
Compose gates retain their dependency order.

The split is not caution, it is a measured limit: a handful of journeys cannot
share a machine with another browser. The clearest is the keyboard-navigation
journey, which fails with `toBeFocused` receiving `inactive` — the operating
system does not consider that window active, because another browser has the
focus. No timeout can fix that, and no amount of it is the application's
behaviour. Others simply miss their budget while three engines compete.

CI gives each project its own runner. Every runner builds the browser application
once, then serves the production bundle throughout its selected journeys.

Performance budgets run in their own Vitest project and their own CI job. They
must never run under V8 coverage instrumentation: instrumentation changes the
timings being measured, so a red budget would describe the profiler rather than
the application. `test:coverage` and `test:performance` are both mandatory in
the complete local gate; CI starts their jobs concurrently. The performance
project uses the single worker declared by `REALTIME_REFERENCE_MACHINE`: its
seven benchmark files do not compete with one another, so the 100,000-entry
search fixture and the 10,000-operation page/database fixtures measure the
application instead of worker starvation. Each benchmark file also gets a
fresh Vitest coordinator process while the outer wrapper keeps one disposable
PostgreSQL server for the whole project. This prevents a large completed
fixture from retaining worker/RPC state that distorts or aborts the next file.
This limit does not relax a product budget or serialize the wider test
families. The PostgreSQL Vitest wrapper also starts this project alone with
Bun's `--smol` memory profile. Bun then collects more frequently on the
reference workload, so the strict 512 MiB heap-growth budget is repeatable
instead of depending on the host's available-memory GC heuristic; every other
test project keeps the normal runtime profile. The page benchmark forces a full
collection only between its timed business phases and applies the ceiling to
the maximum live heap observed there. Those collections are outside the
ingest, catch-up and compaction clocks. This measures retained working state
rather than garbage whose reclamation timing depends on the host.

### Fast, safe parallel feedback

Run independent targeted families concurrently while developing, but give each
family one owner and one log. A useful three-lane split is:

1. pure projects: contracts, domain, page-state, client-core and Web;
2. database/API contracts against the disposable PostgreSQL harness;
3. one selected Playwright journey through `test:e2e:local`.

Start those lanes concurrently from the test orchestrator or from separate
terminals. Inside a lane, use one Vitest invocation with several `--project`
arguments rather than spawning one process per file; Vitest then schedules its
files with the available worker pool. When several database lanes run, set
`TEST_DATABASE_URL` to the same disposable PostgreSQL server: each suite still
creates its own random database, while avoiding one container per process.

Do not run two raw Playwright commands concurrently. They share the default
database and reset fixtures. `bun run test:e2e:local` is the parallel-safe browser
entry point because it allocates a database, ports, blob root and deployment key
per project, then builds one immutable web bundle before starting them. Keep its
default width of two on a small runner.

This parallel feedback does not replace `bun run checks:local`. The full gate owns
its resource ordering and must run once, without a competing test process,
against the exact commit that will be pushed.

**Every browser project runs at once, each on its own stack.** The matrix used
to run one project after another, and the reason was not the browsers: every
journey resets the same database, so two projects sharing one would delete each
other's content mid-test. That is a statement about shared state, so
`scripts/e2e/run-local-matrix.ts` gives each project state of its own instead of
making them take turns —

| Isolated per project | Why |
| --- | --- |
| its own database, created and dropped by the runner | the reason the suites were sequential |
| its own API and web ports (from 3301 and 5473) | five preview servers have to coexist |
| its own blob root | otherwise file journeys read each other's bytes |
| its own deployment key | a shared file is a shared fate if a run rewrites it |

The web assets are deliberately shared: the runner performs one Bun production
build before launching any browser, and every preview server only reads that
immutable output. This avoids concurrent builds and prevents a cold WebKit page
from depending on hundreds of individual Vite development-module transfers.
The two migration journeys that inspect encrypted local state use a fixture hook
compiled only when `MYOWNNOTION_E2E_BUILD=1`; the normal production build checks
that this hook is absent before succeeding.

The dedicated E2E bundle does not register the production service worker.
Playwright request routes model outages and server responses, and requests made
through an active worker bypass those routes. The ordinary production bundle
still builds, precaches, and registers the worker; the Bun build rejects either
bundle if it contains the wrong registration behavior.

The auto fixture resets canonical content, seeds the owner and creates the
session before Playwright asks the engine for a browser context. The context
then receives that session through its initial `storageState`. Keep this order:
making reset depend on an already-created context couples database preparation
to a long-lived WebKit process and can turn an engine stall into an opaque
fixture timeout before the test body starts.

PostgreSQL itself is *not* isolated: one server, several databases. Starting
five servers would cost more than the parallelism saves.

The runner refuses to start when one of its ports is taken, and says which.
That check is not politeness. Playwright's `reuseExistingServer` is on locally,
so a port held by another checkout is silently *adopted* — and the matrix then
reports on code nobody is looking at. That has happened, and it cost more than
the failed run it replaced.

**Two projects at a time by default, not five.** A stack is a browser, a static
preview server and an API process, and what gives way under saturation is not the machine
but the journeys — a click waiting on a render, an assertion budgeted for a quiet
machine. Five at once failed differently on every attempt; three was green once
and then failed twice, both times on WebKit, which is the expensive engine. Two is
what proved repeatable on a fourteen-core laptop, and it still runs the matrix in
about nine minutes against sixteen sequentially.

The number is measured rather than derived from the core count, because cores are
not the scarce resource here — memory and the browser stacks are.
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

Interrupt the matrix once with `Ctrl+C`; its runner forwards termination to the
complete process group for every active browser stack, waits for those children
to close, then removes their temporary files and databases. A second manual
cleanup should not be necessary. If the host itself is killed and cannot run
that handler, verify the configured API/web port ranges and remove only
`mon_e2e_*` databases before the next run.

On macOS, Firefox runs inside the pinned Linux image, because Playwright's
patched Firefox hangs before opening a page on the macOS development runtime.
That project starts its servers inside the container and reaches PostgreSQL
through `host.docker.internal`. The launcher streams an immutable source
snapshot into the container, explicitly excluding local `.env`, secrets,
dependencies, builds and test artefacts, then rebuilds the same E2E bundle in a
private temporary directory. Docker Desktop can otherwise expose stale or
truncated file handles after the host replaces a file or `dist`; the snapshot
and private output remain immutable for the whole run. It runs alongside the
others rather than after them and never rewrites the host bundle another
project is reading. The `secrets/` directory remains excluded: only the exact
generated E2E deployment key is appended as one additional archive member and
made read-only immediately after extraction. This also prevents a newly
replaced host key from becoming a stale bind-mounted file.

Before creating any browser database, the matrix prepares one local image from
the pinned Playwright runtime and copies Bun from the project's pinned Bun base
image. Its locked dependency layer is shared by Firefox and both WebKit lanes,
so a later profile never redownloads the toolchain or packages. Only that one
idempotent dependency bootstrap retries, at most four times with a bounded
backoff, so a short package-mirror or DNS interruption does not invalidate a
long gate. The web build and every test remain single-attempt failures; a
persistent initial bootstrap outage blocks the matrix before it creates test
databases.

`bun run test:e2e` remains the single-stack command to reach for when debugging
one journey; it builds the web bundle before starting Playwright. CI performs
the same build as an explicit step before each isolated browser job.

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

### Realtime synchronization debugging and fault injection

The page channel is `/v1/page-sync/socket`. In browser network tools, a healthy
session upgrades once and follows `hello` → `ready`; edits use correlated
`sync`/`sync-result` exchanges and other devices receive content-free
`page-advanced` announcements. Repeated socket creation while the page is idle,
an HTTP page-sync call while a socket owns that invocation, or a success status
before `sync-result` are defects.

The compact UI exposes separate states for the live connection, local
durability, pending page operations and pending files. Do not diagnose a denied
persistent-storage permission as a content conflict: it is only a storage-risk
warning. A genuine ambiguity remains scoped to its page and keeps both
intentions recoverable.

Server logs put safe diagnostics under `realtimeSync`: `session-opened`,
`session-ready`, `exchange-completed` and `session-closed`. Correlate with
connection, device and request UUIDs plus bounded outcome/latency fields. Page
text, update bytes, vectors, cookies, CSRF tokens and keys must never appear.
For a Compose stack, inspect only those records with:

```bash
docker compose logs --no-color api | jq 'select(.realtimeSync != null)'
```

Use deterministic seams for faults; do not add sleeps or production-only
failure switches. The focused matrix is:

```bash
bun run --bun vitest run --project client-core \
  packages/client-core/tests/page-operation-atomicity.spec.ts \
  packages/client-core/tests/page-reconciler.property.spec.ts
bun run --bun vitest run --project api-contract \
  apps/api/tests/realtime-page-sync.contract.spec.ts \
  apps/api/tests/page-sync-session.spec.ts \
  apps/api/tests/realtime-device-revocation.integration.spec.ts
bun run --bun vitest run --project web \
  apps/web/tests/realtime-page-sync-transport.spec.ts \
  apps/web/tests/local-content-realtime-sync.spec.ts
bun run test:e2e:local -- \
  tests/e2e/page-multi-tab-convergence.spec.ts \
  tests/e2e/realtime-sync-security-and-restore.spec.ts
```

Together these inject local transaction failures, lost replies after server
commit, half-open sockets, shutdown, device revocation, browser death and
restore with newer offline work. Every case must retain the same durable update
identity and converge without a whole-document replacement.

### Search checks

Search spans the shared domain engine, canonical source reads, the API, the
local worker and browser journeys. These commands give focused feedback while
working on that feature; they do not replace `bun run checks:local` before a push.

```bash
bun run --bun vitest run --project domain \
  tests/search-normalise.spec.ts tests/search-document-text.spec.ts \
  tests/search-index.spec.ts tests/search.property.spec.ts
bun run --bun vitest run --project database-integration \
  tests/search-source.integration.spec.ts tests/reference-backups.integration.spec.ts
bun run --bun vitest run --project api-contract \
  tests/search-service.spec.ts tests/search.contract.spec.ts \
  tests/search-rebuild.spec.ts tests/search-security.spec.ts
bun run --bun vitest run --project client-core \
  tests/local-search-source.spec.ts tests/search-merge.spec.ts
bun run --bun vitest run --project web \
  tests/search-dialog.spec.ts tests/search-worker.spec.ts
bun run test:e2e:local -- --grep "workspace search|search dialog"
```

The dedicated benchmark is:

```bash
bun run --bun vitest run --project performance tests/performance/search.perf.spec.ts
```

It models 100,000 pages, one million flattened visible blocks and 50,000 file
names on the server, plus a 10,000-item local index. It records server and local
p50/p95, build time and heap, local upserts, second-device propagation and
10,000 idempotent replays. The operational interpretation and the latest
reference figures live in `docs/architecture/search.md`.

### Structured database checks

Feature 009 spans the domain evaluator, PostgreSQL mutation path, protected API,
local projection and five browser views. Use these focused commands while
editing; they do not replace the full pre-push gate:

```bash
bun run --bun vitest run --project domain packages/domain/tests/databases
bun run --bun vitest run --project client-core packages/client-core/tests/database-query.spec.ts \
  packages/client-core/tests/database-local-mutation.spec.ts \
  packages/client-core/tests/database-reconciliation.spec.ts
bun run --bun vitest run --project database-integration packages/database/tests/database.integration.spec.ts \
  packages/database/tests/database-lifecycle.integration.spec.ts
bun run --bun vitest run --project api-contract apps/api/tests/database.contract.spec.ts \
  apps/api/tests/database-security.spec.ts
bun run test:e2e:local -- --grep "database|structured"
```

Migration `0007_databases.sql` creates only the structural database and
membership tables, their integrity triggers and indexes. Apply it through
`bun run db:migrate`; do not create definitions or values directly in those
tables. Test both an empty database and the forward fixture with:

```bash
bun run db:test-migrations
```

The dedicated benchmark is:

```bash
bun run --bun vitest run --project performance tests/performance/databases.perf.spec.ts
```

It measures the first 100 results from 100,000 entries in all five views,
structured local commits, second-projection propagation and 10,100 mixed
create/edit/replay/trash/restore operations. Reference figures and the
operational model live in `docs/architecture/databases.md`; the manual product
scenarios remain in the feature quickstart rather than being duplicated here.

### Working without Docker

Suites that need PostgreSQL prefer, in order:

1. `TEST_DATABASE_URL` — an already running disposable PostgreSQL. Each
   acquisition creates a uniquely named database and drops it afterwards.
2. Testcontainers, which starts one `postgres:18` server per Vitest project.

The database, API-contract, workspace-contract, and performance projects share
their server only as infrastructure. Every suite still creates and drops a
randomly named database, so files remain isolated. Database files, API files,
and independent Vitest projects can therefore all run in parallel using the
worker capacity available on the host. Keeping the server at project scope
avoids repeatedly creating containers and publishing random host ports during
the complete gate; that container churn is both slower and vulnerable to
Docker port-binding delays under load.

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
bun run checks:local
```

This is the hard pre-push gate for executable or potentially executable
changes, not a suggested smoke test. It runs the local equivalents of every
repository-controlled PR job: toolchain policy, shell, format/lint, strict
types, aggregate coverage, uninstrumented performance budgets, the separately
observable database/migration and contract suites, the complete browser/viewport matrix, production and
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

### Containerized end-to-end browsers on macOS

The patched Firefox binary downloaded by Playwright currently hangs during
startup on the macOS development workstation, in both headless and headed
modes, before the first page is created. The symptom is a Firefox process at
100% CPU with a `RenderCompositorSWGL failed mapping default framebuffer` log.
This is a browser/runtime issue, not an application-test failure.

Patched WebKit can also enter an internal `WebLoaderStrategy` failure late in a
long desktop or mobile corpus on macOS. Once that engine failure occurs, later
pages cannot reach `domcontentloaded` and context cleanup times out. Short
focused tests may stay green, so the complete local gate must not use native
WebKit as evidence.

`bun run checks:local` invokes `bun run test:e2e:gate`. On macOS that wrapper runs
Chromium directly, then runs Firefox, WebKit desktop and WebKit mobile in the
official Playwright Linux container. The
container uses the same Playwright version as the repository and reaches the
host PostgreSQL service through `host.docker.internal`:

```bash
docker compose up -d --wait postgres
bun run db:migrate
bun run test:e2e:firefox-container -- --project=firefox-desktop
```

The generic command can run any containerized lane directly:

```bash
bun run test:e2e:browser-container -- --project=webkit-desktop
bun run test:e2e:browser-container -- --project=webkit-mobile
```

A complete WebKit lane is split into three sequential shards inside the
container. Each shard starts a fresh WebKit process, which bounds the engine's
long-corpus resource accumulation while preserving `--fail-on-flaky-tests`.
WebKit projects use a 120-second total watchdog because the Linux engine can
occasionally spend more than 60 seconds inside `browser.newPage()` before any
application code runs. Functional expectations keep their 10–30 second limits.
Focused diagnostics using `--grep`, and an explicit caller-provided `--shard`,
run once exactly as requested.

To rerun one lane with the same isolated database and deployment-key lifecycle
as the complete local gate, select the exact project on the matrix command:

```bash
bun run test:e2e:gate -- --project=firefox-desktop
```

Additional Playwright arguments are forwarded after `--`, for example:

```bash
bun run test:e2e:browser-container -- --project=webkit-desktop --grep "first-run gate"
```

This is the required local path for Firefox and WebKit on macOS. Chromium still
runs directly on the host. The container is headless by default; failed journeys
retain the usual Playwright traces and screenshots for debugging. The historical
`test:e2e:firefox-container` command remains an alias for Firefox-only reruns.

When invoking the raw `bun run test:e2e` and
`bun run test:e2e:browser-container` commands yourself, run them one after the
other. Those commands use the default PostgreSQL database, and concurrent
journeys can delete each other's fixtures. `bun run test:e2e:local` is the safe
parallel exception: its matrix runner allocates an isolated database, ports,
and temporary directories to every browser project, then serves one prebuilt
production bundle read-only across the matrix.

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
tags through the reusable gate, manual diagnostics, and `bun run checks:local`
always run the full corpus. Documentation-only work branches use the targeted
local policy above; executable or mixed work branches still run
`bun run checks:local` in full before push. Full runs are both release evidence and
the safety net that exposes an incomplete ownership map.

Useful local diagnostics:

```bash
bun run ci:test-impact --event pull_request --ref refs/pull/1/merge \
  --base HEAD~1 --head HEAD --pr-number 1 --changed docs/development.md
bun run ci:test:affected --plan test-impact.json --group unit
```

When adding or renaming a Playwright `tests/e2e/*.spec.ts` journey, add it to
`e2eJourneys` in the same change. Policy contract tests fail if any maintained
journey is missing, duplicated, ownerless, or points to a nonexistent consumer.

### CI cache boundaries

Every JavaScript/TypeScript job uses the repository's pinned Bun setup action.
The official action keeps its own exact Bun executable cache enabled, then the
repository action always executes `bun ci`. It deliberately does not persist
`node_modules` or `~/.bun/install/cache` between runners. On the reference CI,
restoring that package cache transferred about 196 MiB and took about five
seconds per job while a warm cache saved less time than it cost to restore.
Reintroducing a cross-run dependency cache therefore requires a measured win on
this repository. E2E jobs separately cache Playwright browser binaries by
runner OS, architecture, and the installed Playwright version; the system
dependency check still runs on every selected browser job.

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

Write mode for formatting is separate on purpose: `bun run format:write` and
`bun run lint --write` change files, the `:check`/`ci` variants never do.

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
| `test:unit` `test:property` `test:integration` `test:contract` `test:migration` `test:performance` `test:security` | full locally/main; affected subset or explicit no-op on PR | Any selected failure blocks; unknown impact selects the full suites; performance budgets run without coverage instrumentation | — |
| `test:e2e` (`test:e2e:local` on macOS) | full locally/main; owned journeys or explicit no-op on PR | Any selected journey blocks; unknown impact selects every journey | Playwright report per browser/viewport |
| `security:audit` | local, PR, main | Any high/critical vulnerability or an unavailable audit blocks | `dependency-audit.json` |
| `security:secrets` | local, PR, main | Any detected secret or a scanner failure blocks | `secret-scan.sarif` |
| `security:static` | local, PR, main | Any high-confidence finding or an analyzer failure blocks | `static-security.sarif` |
| `security:licenses` | local, PR, main | Any denied or unresolvable license blocks | `license-policy.json` |
| `build` `compose:check` | local, PR, main | Build failure or a Compose boundary violation blocks | — |
| `images:build` | local, PR, main | Unpinned base digest, a build failure, a missing packaged Loro runtime, or an unloadable API/migration entrypoint blocks; builds every platform, then executes a native image smoke without publishing | `image-build.json` |
| pinned Trivy container scan | conditional local evidence, PR, main | Any high/critical vulnerability with a fix, or an unavailable required scan, blocks | `container-scan.sarif` |
| `release:gate` | tag | Missing, stale, foreign-commit, or artifact-less gate evidence blocks publication | — |

Base images are pinned by manifest-list digest in `docker/base-images.json`.
`bun run images:build` refuses to build while a digest is empty; run
`bun run images:build --resolve` on a machine with a Docker daemon and commit the
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

`vitest.config.ts` uses Istanbul under Bun and enforces an absolute
no-regression budget over `packages/*/src` and `apps/api/src`: at most 2,216
uncovered statements, 1,866 uncovered lines, 337 uncovered functions, and
2,465 uncovered branches. Vitest interprets negative thresholds as maximum
uncovered counts. These values are the first complete Bun/Istanbul baseline,
recorded in `specs/019-bun-toolchain/plan.md`; adding covered code cannot hide
new untested code by diluting a percentage.

Excluded, with the reason:

- `apps/web/**` — exercised by Playwright journeys; browser rendering is not
  meaningfully measurable under V8/node.
- `apps/api/src/context.ts`, `packages/blob-store/src/blob-store.ts` — type-only
  declarations with no executable statements.
- `apps/api/src/server.ts` — process entry point (binds signals, calls
  `listen()`/`process.exit()`). Recorded as an explicit exception in
  `specs/001-content-foundations/plan.md`.

Increasing an uncovered-item budget or excluding executable first-party code
requires a recorded exception in the active feature's plan. A future reduction
of any budget is an improvement and should be kept.

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
