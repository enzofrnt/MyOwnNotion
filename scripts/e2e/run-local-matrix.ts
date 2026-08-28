/**
 * The local Playwright matrix, one isolated stack per browser project, all at
 * once.
 *
 * The matrix used to run sequentially, and the comment saying so gave the real
 * reason: every journey resets the same database, so two projects sharing one
 * would delete each other's content mid-test. That is a statement about *shared
 * state*, not about parallelism — so this gives each project its own state
 * instead of taking turns.
 *
 * Per project, isolated:
 *
 *   - **its own database**, created and migrated here, dropped afterwards. This
 *     is the one that made the suites sequential.
 *   - **its own API and web ports**, so five isolated stacks coexist.
 *   - **its own blob root**, or file journeys would read each other's bytes.
 *   - **its own deployment key**, because the security journeys mount one and a
 *     shared file is a shared fate if a run rewrites it.
 *
 * The web application is built once before the matrix. Every preview server
 * reads the same immutable production bundle, so parallel stacks neither race
 * a dependency optimiser nor rebuild into a shared output directory.
 *
 * What is *not* isolated is PostgreSQL itself — one server, several databases.
 * Starting five servers would cost more than the parallelism saves.
 *
 * On macOS, Firefox runs inside the pinned Linux image, because Playwright's
 * patched Firefox hangs before opening a page on the macOS development runtime.
 * That stack talks to the same PostgreSQL through `host.docker.internal` and
 * starts its own servers inside the container, so it needs a database of its own
 * plus host-side migration fixtures before the container starts.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import pg from "pg";
import { BROWSER_PROJECTS } from "../../tests/e2e/projects.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** The server every stack's database lives on. */
const BASE_DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://myownnotion:myownnotion-dev@127.0.0.1:5432/myownnotion";

/**
 * Where port allocation starts.
 *
 * Deliberately clear of the development defaults (3001 and 5173). A run that
 * borrowed those would fight `bun run dev` for them — and worse, Playwright's
 * `reuseExistingServer` is on locally, so it would quietly *reuse* whatever was
 * already listening and test that instead. A matrix that silently exercises
 * another checkout's code is the failure mode this range exists to avoid.
 */
const API_PORT_BASE = Number(process.env["MYOWNNOTION_E2E_API_PORT_BASE"] ?? 3301);
const WEB_PORT_BASE = Number(process.env["MYOWNNOTION_E2E_WEB_PORT_BASE"] ?? 5473);

/**
 * How many stacks run at once.
 *
 * Not every project by default, and that was measured rather than assumed. A
 * stack is a browser, a static preview server and an API process, so five of them saturate
 * a laptop — and the first thing that gives way under saturation is not the
 * machine but the *journeys*: a click waiting on a render, an assertion budgeted
 * for a quiet machine. Runs at full width failed differently each time, in
 * different projects, which is the signature of contention rather than of a
 * defect. A red run nobody trusts is worth less than a slower green one.
 *
 * **Two**, measured on a fourteen-core laptop rather than derived from the core
 * count. Three was green once and then failed twice, differently each time and
 * always on WebKit: a `createRootItem` missing its fifteen-second budget, and a
 * browser context closed underneath a running test. WebKit is the expensive one,
 * and cores are not the scarce resource — memory and the five browser stacks are.
 *
 * Raise it with `MYOWNNOTION_E2E_JOBS` on a machine with room, or lower it to one
 * to reproduce a sequential run. A gate that is green two times in three is not a
 * gate.
 */
const JOBS = Number(process.env["MYOWNNOTION_E2E_JOBS"] ?? 2);

const onMac = os.platform() === "darwin";

interface Stack {
  readonly project: string;
  readonly databaseName: string;
  readonly databaseUrl: string;
  /** Ports are absent for the container stack, which listens inside the container. */
  readonly apiPort?: number;
  readonly webPort?: number;
  readonly blobRoot?: string;
  readonly backupRoot?: string;
  readonly deploymentKeyFile?: string;
  readonly inContainer: boolean;
}

function databaseUrlFor(name: string): string {
  const url = new URL(BASE_DATABASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * The URL the container stack uses.
 *
 * `host.docker.internal` rather than the loopback address in
 * `BASE_DATABASE_URL`: inside a container, `127.0.0.1` is the container.
 */
function containerDatabaseUrlFor(name: string): string {
  const url = new URL(databaseUrlFor(name));
  url.hostname = "host.docker.internal";
  return url.toString();
}

function planStacks(selectedProjects: ReadonlySet<string>): Stack[] {
  const suffix = randomBytes(3).toString("hex");
  return BROWSER_PROJECTS.map((project, index): Stack | null => {
    if (!selectedProjects.has(project.name)) return null;
    const databaseName = `mon_e2e_${project.name.replaceAll("-", "_")}_${suffix}`;
    const inContainer = onMac && project.containerOnMac === true;
    const blobRoot = path.join(repoRoot, ".dev-blobs-e2e", `${project.name}-${suffix}`);
    const backupRoot = path.join(repoRoot, ".dev-backups-e2e", `${project.name}-${suffix}`);
    const deploymentKeyFile = path.join(repoRoot, "secrets", `deployment-key.e2e-${project.name}`);
    if (inContainer) {
      return {
        project: project.name,
        databaseName,
        databaseUrl: databaseUrlFor(databaseName),
        // Migrations run on the host for every isolated database, including
        // Firefox's. The update guard needs the same disposable backup/key
        // fixtures as host browser stacks before the container is launched.
        blobRoot,
        backupRoot,
        deploymentKeyFile,
        inContainer: true,
      };
    }
    return {
      project: project.name,
      databaseName,
      databaseUrl: databaseUrlFor(databaseName),
      apiPort: API_PORT_BASE + index,
      webPort: WEB_PORT_BASE + index,
      blobRoot,
      backupRoot,
      deploymentKeyFile,
      inContainer: false,
    };
  }).filter((stack): stack is Stack => stack !== null);
}

function parseMatrixArguments(args: readonly string[]): {
  readonly selectedProjects: ReadonlySet<string>;
  readonly extraArgs: readonly string[];
} {
  const selectedProjects = new Set<string>();
  const extraArgs: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined || argument === "--") continue;
    if (argument === "--project") {
      const project = args[index + 1];
      if (project === undefined) throw new Error("--project requires an exact browser project");
      selectedProjects.add(project);
      index += 1;
      continue;
    }
    if (argument.startsWith("--project=")) {
      selectedProjects.add(argument.slice("--project=".length));
      continue;
    }
    extraArgs.push(argument);
  }

  const knownProjects = new Set(BROWSER_PROJECTS.map((project) => project.name));
  for (const project of selectedProjects) {
    if (!knownProjects.has(project)) {
      throw new Error(
        `unknown browser project ${project}; expected one of ${[...knownProjects].join(", ")}`,
      );
    }
  }
  if (selectedProjects.size === 0) {
    for (const project of knownProjects) selectedProjects.add(project);
  }
  return { selectedProjects, extraArgs };
}

/**
 * Refuses to start when a port is taken.
 *
 * Loudly, and before anything runs. `reuseExistingServer` is on locally, so a
 * port held by another checkout would be silently adopted and the whole matrix
 * would report on code nobody is looking at. Losing a run to a clear error costs
 * a minute; losing one to a green report on the wrong code costs an afternoon.
 */
async function assertPortFree(port: number, label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `port ${port} (${label}) is already in use. Stop whatever holds it, or move the range with MYOWNNOTION_E2E_API_PORT_BASE / MYOWNNOTION_E2E_WEB_PORT_BASE.`,
            )
          : error,
      );
    });
    probe.once("listening", () => {
      probe.close(() => resolve());
    });
    probe.listen(port, "127.0.0.1");
  });
}

async function withAdminClient<T>(run: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: BASE_DATABASE_URL });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function createDatabases(stacks: readonly Stack[]): Promise<void> {
  await withAdminClient(async (client) => {
    for (const stack of stacks) {
      // Identifiers are built here from a fixed alphabet, never from input.
      await client.query(`CREATE DATABASE ${stack.databaseName}`);
    }
  });
}

async function dropDatabases(stacks: readonly Stack[]): Promise<void> {
  try {
    await withAdminClient(async (client) => {
      for (const stack of stacks) {
        // FORCE, because an API server that has not finished shutting down still
        // holds a connection and would keep the database alive for the next run
        // to trip over.
        await client.query(`DROP DATABASE IF EXISTS ${stack.databaseName} WITH (FORCE)`);
      }
    });
  } catch (error) {
    // Reported, never fatal. The run's result is what matters, and a leftover
    // database is a nuisance rather than a wrong answer.
    console.warn(`could not drop every temporary database: ${(error as Error).message}`);
  }
}

function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

async function migrate(stack: Stack): Promise<void> {
  const { code, output } = await run("bun", ["scripts/db/migrate.ts"], {
    DATABASE_URL: stack.databaseUrl,
    ...(stack.blobRoot === undefined ? {} : { MYOWNNOTION_BLOB_ROOT: stack.blobRoot }),
    ...(stack.backupRoot === undefined ? {} : { MYOWNNOTION_BACKUP_ROOT: stack.backupRoot }),
    ...(stack.deploymentKeyFile === undefined
      ? {}
      : { MYOWNNOTION_DEPLOYMENT_KEY_FILE: stack.deploymentKeyFile }),
  });
  if (code !== 0) {
    throw new Error(`migrating ${stack.databaseName} failed:\n${output}`);
  }
}

async function buildWebApplication(): Promise<void> {
  const { code, output } = await run("bun", ["run", "--filter", "@myownnotion/web", "build"], {
    MYOWNNOTION_E2E_BUILD: "1",
  });
  if (code !== 0) {
    throw new Error(`building the browser application failed:\n${output}`);
  }
}

function prepareStack(stack: Stack): void {
  if (stack.blobRoot !== undefined) {
    mkdirSync(stack.blobRoot, { recursive: true });
  }
  if (stack.backupRoot !== undefined) {
    mkdirSync(stack.backupRoot, { recursive: true });
  }
  if (stack.deploymentKeyFile !== undefined) {
    mkdirSync(path.dirname(stack.deploymentKeyFile), { recursive: true, mode: 0o700 });
    writeFileSync(stack.deploymentKeyFile, `${randomBytes(32).toString("base64")}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    chmodSync(stack.deploymentKeyFile, 0o600);
  }
}

function cleanUpStack(stack: Stack): void {
  if (stack.blobRoot !== undefined) {
    rmSync(stack.blobRoot, { recursive: true, force: true });
  }
  if (stack.backupRoot !== undefined) {
    rmSync(stack.backupRoot, { recursive: true, force: true });
  }
  if (stack.deploymentKeyFile !== undefined) {
    rmSync(stack.deploymentKeyFile, { force: true });
  }
}

async function runStack(
  stack: Stack,
  extraArgs: readonly string[],
): Promise<{ code: number; output: string }> {
  if (stack.inContainer) {
    return run(
      "bash",
      [
        "scripts/test-e2e-firefox-container.sh",
        `--project=${stack.project}`,
        // The container mounts this repository at /work, so its Playwright and
        // the host's share one `test-results/` — and each clears that directory
        // when it starts. Without its own subdirectory the container run dies on
        // `ENOTEMPTY` trying to remove a directory the host is writing into.
        `--output=test-results/${stack.project}`,
        ...extraArgs,
      ],
      {
        DATABASE_URL: containerDatabaseUrlFor(stack.databaseName),
        MYOWNNOTION_DEPLOYMENT_KEY_FILE: stack.deploymentKeyFile as string,
        MYOWNNOTION_E2E_PREBUILT_WEB: "1",
      },
    );
  }
  return run(
    "bun",
    [
      "run",
      "--bun",
      "playwright",
      "test",
      "--fail-on-flaky-tests",
      `--project=${stack.project}`,
      // Its own artefact directory. Playwright clears `test-results/` when it
      // starts, so five runs sharing it would delete each other's traces and
      // screenshots — the things somebody reads after a red run, gone by the
      // time they look.
      `--output=${path.join(repoRoot, "test-results", stack.project)}`,
      ...extraArgs,
    ],
    {
      DATABASE_URL: stack.databaseUrl,
      MYOWNNOTION_API_PORT: String(stack.apiPort),
      MYOWNNOTION_WEB_PORT: String(stack.webPort),
      MYOWNNOTION_BLOB_ROOT: stack.blobRoot as string,
      MYOWNNOTION_BACKUP_ROOT: stack.backupRoot as string,
      MYOWNNOTION_DEPLOYMENT_KEY_FILE: stack.deploymentKeyFile as string,
      MYOWNNOTION_E2E_PREBUILT_WEB: "1",
      // Playwright writes its report into one directory; five runs writing into
      // the same one would overwrite each other's failure artefacts, which are
      // exactly what someone reads after a red run.
      PLAYWRIGHT_HTML_REPORT: path.join(repoRoot, "playwright-report", stack.project),
      PLAYWRIGHT_BLOB_OUTPUT_DIR: path.join(repoRoot, "blob-report", stack.project),
    },
  );
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      results[index] = await worker(item);
    }
  });
  await Promise.all(runners);
  return results;
}

/** The last lines of a failing run, which is what someone actually reads. */
function tail(output: string, lines = 40): string {
  return output.trimEnd().split("\n").slice(-lines).join("\n");
}

async function main(): Promise<void> {
  const { selectedProjects, extraArgs } = parseMatrixArguments(process.argv.slice(2));
  const stacks = planStacks(selectedProjects);

  for (const stack of stacks) {
    if (stack.apiPort !== undefined) {
      await assertPortFree(stack.apiPort, `${stack.project} API`);
    }
    if (stack.webPort !== undefined) {
      await assertPortFree(stack.webPort, `${stack.project} web`);
    }
  }

  console.info(
    `Running ${stacks.length} browser projects, ${Math.min(JOBS, stacks.length)} at a time, each on its own database.`,
  );

  await createDatabases(stacks);
  try {
    for (const stack of stacks) {
      prepareStack(stack);
    }
    // Migrations run before any browser starts. Doing them inside each stack's
    // run would have five servers racing to create the same schema on databases
    // that are ready at different moments, and the first failure would look like
    // a journey failing rather than a setup one.
    await mapWithLimit(stacks, JOBS, migrate);
    await buildWebApplication();

    // Every project's full output on disk, always — not only when it fails.
    // Five runs interleaving into one terminal is unreadable, and a summary at
    // the end is at the mercy of whatever the caller piped it through: this
    // runner's own report was truncated by a `tail` the first time it found
    // something. A file cannot be truncated by scrollback.
    //
    // Outside `test-results/`, and that is not a detail. Playwright *clears* its
    // output directory when it starts, so logs written there were deleted by the
    // next stack to begin — which this runner discovered by crashing on a file it
    // had created seconds earlier. A directory two owners both clear belongs to
    // neither.
    const logDirectory = path.join(repoRoot, ".e2e-logs");

    const started = Date.now();
    const outcomes = await mapWithLimit(stacks, JOBS, async (stack) => {
      const result = await runStack(stack, extraArgs);
      const logFile = path.join(logDirectory, `${stack.project}.log`);
      // Created at write time rather than once up front, so nothing that ran in
      // between can have removed it.
      mkdirSync(logDirectory, { recursive: true });
      writeFileSync(logFile, result.output, "utf8");
      console.info(
        `${result.code === 0 ? "PASS" : "FAIL"}  ${stack.project}  → ${path.relative(repoRoot, logFile)}`,
      );
      return { stack, logFile, ...result };
    });
    const elapsed = Math.round((Date.now() - started) / 1000);

    const failed = outcomes.filter((outcome) => outcome.code !== 0);
    for (const outcome of failed) {
      console.info(
        `\n----- ${outcome.stack.project} (full log: ${path.relative(repoRoot, outcome.logFile)}) -----\n${tail(outcome.output)}`,
      );
    }
    console.info(
      `\n${outcomes.length - failed.length}/${outcomes.length} projects passed in ${elapsed}s.`,
    );
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    for (const stack of stacks) {
      cleanUpStack(stack);
    }
    await dropDatabases(stacks);
  }
}

await main();
