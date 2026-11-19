# Parallel execution and stack hygiene

Normative for every test run, every feature agent, and every long-running local
stack. Constitution article IX makes these rules binding; they are written to be
checked, not interpreted. When a rule and a habit disagree, the rule wins.

The motivation is measured, not stylistic: agent sessions that ran suites one
project at a time left four separate Compose projects, four PostgreSQL servers,
twenty volumes, four networks and abandoned databases on one machine (see
"Observed leak" below). Every one of those came from a run that was allowed to
create a stack without a name, an owner or an end.

## 1. Run in parallel, by default

- A multi-project suite MUST be launched through `bun run test:e2e:gate`
  (complete) or `bun run test:e2e:local` (fast feedback). Both default to
  `MYOWNNOTION_E2E_JOBS=2` and both give each project its own database, ports and
  artefact directory.
- `MYOWNNOTION_E2E_JOBS=1` MUST NOT be used to validate a feature, a repair or a
  merge candidate. It is reserved for reproducing one named failure, and that
  use MUST be recorded in the feature's `validation.md` with the failure it was
  reproducing.
- A raw `playwright test` invocation against one file is a reproduction tool,
  never a gate. A gate claim MUST name the matrix command that produced it.
- A suite that cannot run in parallel is a defect in the suite. Fix the shared
  state (ports, database name, artefact directory, global fixture) instead of
  serialising the corpus.


## 2. Isolate every stack

Each parallel project owns, and MUST NOT share:

| Resource | Isolation rule |
| --- | --- |
| Database | Its own database: `mon_e2e_<project>_<suffix>` from the matrix, `mon_test_<hex>` from `startDisposablePostgres`. Never the dev database. |
| API and web ports | Derived from `MYOWNNOTION_E2E_API_PORT_BASE` / `MYOWNNOTION_E2E_WEB_PORT_BASE`, one block per stack. Never 3001/5173 by default. |
| Blobs, backups, deployment key | `MYOWNNOTION_BLOB_ROOT`, `MYOWNNOTION_BACKUP_ROOT` and the key file are per stack. |
| Artefacts | `MYOWNNOTION_E2E_WEB_OUTDIR` / `MYOWNNOTION_WEB_DIST_DIR` are dedicated `myownnotion-e2e-web-*` directories under the system temporary root. |
| Playwright output | `--output=test-results/<project>`, one report directory per project. |

Ports are fixed, not negotiated:

| Port | Owner |
| --- | --- |
| 5432 | the development stack (`myownnotion-dev`) |
| 5499 | one shared e2e template server, optional, never a second one |
| 5500–5600 | ephemeral per-feature stacks, one port per stack |
| 8080 / 8443 | the development stack behind Caddy |
| 6300+ / 6470+ | matrix API / web port bases |

Two processes MUST NOT ask for the same port. A bind failure is not a reason to
kill an unrelated container.


## 3. Name and label every stack

- Long-lived stacks are exactly two: the Compose project `myownnotion-dev`
  (`bun run dev:stack`) and the Compose project `myownnotion` (`compose.yaml`).
  Neither may be created by a test run.
- Any other container, volume or network created for a feature or an
  investigation MUST carry both labels:
  `com.myownnotion.stack=<feature>-<slug>` and
  `com.myownnotion.ephemeral=true`.
- A stack MUST be created with an explicit Compose project name that starts with
  the feature directory (`docker compose -p 067-<slug>`), never with the default
  directory-derived name.
- An investigation stack MUST NOT outlive the conversation that created it.


## 4. No standalone database stack

A Compose project whose only service is a database, or a `docker run postgres`,
MUST NOT be created to test anything. It is the most common leftover and the
least useful one: a bare server gives no isolation, carries an ownerless volume
and survives every session that forgets it.

Testing a database-backed feature uses one of exactly two mechanisms:

- the parallel matrix, which creates a full stack per project and one database
  per stack inside the server it owns;
- `startDisposablePostgres()`, which either creates `mon_test_<hex>` on the
  declared template server and drops it on release, or starts a container whose
  lifetime is the test's.

A database container is therefore only legitimate as the `postgres` service of
the development stack or of a full matrix stack. The audit names a project with
nothing but a database as a violation, separately from other ephemeral stacks.


## 5. Guarantee the tear-down

Cleanup in a `finally` block is not a guarantee: `SIGKILL`, a crashed runner or a
closed terminal skips it. The rules therefore require an explicit end state, not
an intention:

1. Before a run: `bun run stacks:audit` MUST report no ephemeral stack that the
   run does not own. Reap anything it reports first.
2. After a run, a killed run, or the end of a work session:
   `bun run stacks:audit` MUST report zero ephemeral stacks, and the template
   server MUST contain no `mon_e2e_*` or `mon_test_*` database.
3. A run that cannot reach that state is a failed run, even if every assertion
   passed. Record the leftover and remove it before the next run.
4. Reaping is explicit and scoped: `docker compose -p <stack> down -v` for a
   Compose project, `docker rm -f <name>` for a stray container. A blanket
   `docker system prune` is forbidden: it deletes other agents' work and the
   development stack's data.


## 6. Leftovers that `docker ps` never shows

A session can leave nothing running and still waste gigabytes. These count as
leftovers exactly like a running stack:

| Leftover | Rule |
| --- | --- |
| Images built by the matrix (`myownnotion-e2e-playwright:*`) | Reclaimed after the session; one build per run is not a cache. |
| Dangling images | Removed with `docker image prune -f`, which is safe; a blanket `system prune` is not. |
| Temporary web roots (`$TMPDIR/myownnotion-e2e-web-*`) | Removed at the end of the session; each is roughly fifty megabytes. |
| Repository artefacts (`coverage/`, `playwright-report/`, `test-results/`, `.e2e-logs/`) | Regenerable, removed after the evidence has been read. |
| Anonymous volumes | Reported, never removed automatically: their owner is unknown. |

`bun run stacks:audit` reports all of them and fails while any is present, so the
rule cannot be satisfied by stopping containers alone.


## 7. Databases are dropped by identity, never by pattern

`DROP DATABASE IF EXISTS <exact name> WITH (FORCE)` is allowed. Dropping by
pattern (`mon_%`, `myown%`) is forbidden: a concurrent stack owns a matching name.


## 8. Verification commands

```bash
bun run stacks:audit                       # what exists, what is ephemeral
docker ps -a --format '{{.Names}}\t{{.Status}}'
docker compose -p <stack> down -v --remove-orphans
```

The audit prints, for every Compose project and stray container, its name,
project, ports, age and labels, and exits non-zero when an ephemeral stack is
still running. A green audit is the only accepted evidence that a session left
no stack behind.


## 9. Observed leak (2026-11-18)

One working session left the machine with:

- Compose projects `myownnotion`, `myownnotion-dev`, `mn059-investigation`
  (3 days old) and `myownnotion-057-e2e` (6 days old);
- a stray `oven/bun:1.4.2` container with no project label, 5 hours old;
- twenty volumes, including four from deleted projects and two unrelated to this
  repository;
- databases `myownnotion_e2e_lane_repro` and
  `mon_e2e_chromium_desktop_e06251` in servers whose runs had been interrupted.

On top of that: fourteen matrix images, six dangling images, twenty-one
temporary web roots totalling 1.1 GB, and regenerable repository artefacts (40 MB).

The causes were structural: no ownership label, no expiry, no audit, and suites
started one project at a time so that the number of stack lifetimes multiplied.
The rules above remove each of those causes; they do not depend on an agent
remembering to be tidy.
