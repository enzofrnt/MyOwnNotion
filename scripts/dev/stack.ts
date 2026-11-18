/**
 * Local HTTPS development stack (postgres + hot-reload API/web + Caddy).
 *
 * Starting (and resetting) the stack can rebuild images (`docker compose up
 * --build`). A normal `bun run dev:stack` reuses the existing dev image so
 * bind-mounted sources reload without hitting Docker Hub. File changes are
 * picked up by Bun `--watch` and Vite HMR inside the running containers —
 * not by rebuilding or restarting those containers.
 *
 * Usage:
 *   bun run dev:stack
 *   bun run dev:stack --build
 *   bun run dev:stack --logs
 *   bun run dev:stack --down
 *   bun run dev:stack --reset
 *   bun run dev:stack --demo
 *   bun run dev:stack --demo-repeat
 *   bun run dev:trust
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = path.join(repoRoot, "compose.dev.yaml");
const projectName = "myownnotion-dev";
const keyPath = path.join(repoRoot, "secrets", "deployment-key");
const caPath = path.join(repoRoot, "secrets", "caddy-root.crt");
const resetVolumes = [
  `${projectName}_postgres-data`,
  `${projectName}_file-store`,
  `${projectName}_backup-store`,
] as const;
const upArgs = ["up", "-d", "--wait", "--remove-orphans"] as const;
const upWithBuildArgs = ["up", "-d", "--build", "--wait", "--remove-orphans"] as const;

function fail(message: string, status = 1): void {
  console.error(message);
  process.exit(status);
}

function compose(args: string[]): number {
  const result = spawnSync("docker", ["compose", "-f", composeFile, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`docker compose failed to start: ${result.error.message}`);
  }
  return result.status ?? 1;
}

function removeVolume(name: string): void {
  const result = spawnSync("docker", ["volume", "rm", name], { encoding: "utf8" });
  if (result.status === 0) {
    console.info(`Removed volume ${name}.`);
    return;
  }
  const output = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  if (/no such volume/i.test(output)) {
    console.info(`Volume ${name} was already absent.`);
    return;
  }
  fail(`Could not remove volume ${name}: ${output.trim()}`);
}

function resetDevData(): void {
  console.info("Wiping myownnotion-dev postgres, files, and backups. Caddy's local CA is kept.");
  if (compose(["down", "--remove-orphans"]) !== 0) {
    fail("Could not stop the development stack.");
  }
  for (const volume of resetVolumes) {
    removeVolume(volume);
  }
  ensureDeploymentKey();
  if (compose([...upWithBuildArgs]) !== 0) {
    fail("Could not recreate the development stack after the reset.");
  }
  console.info("Development data reset. Open http://localhost:8080 (or https://localhost:8443)");
}

function seedKnowledgeGraphDemo(): void {
  resetDevData();
  console.info("Seeding the disposable Knowledge Graph workspace through the local API.");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "-f",
      composeFile,
      "exec",
      "-T",
      "-e",
      "MYOWNNOTION_DEMO_CONFIRMATION=RESET_LOCAL_KNOWLEDGE_GRAPH_DEMO",
      "api",
      "bun",
      "scripts/dev/seed-knowledge-graph-demo.ts",
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  if (result.error !== undefined || result.status !== 0) {
    fail(
      `The demo workspace was not declared ready. Fix the cause and rerun bun run dev:stack:demo.`,
    );
  }
}

function ensureDeploymentKey(): void {
  mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  if (existsSync(keyPath)) {
    return;
  }
  writeFileSync(keyPath, `${randomBytes(32).toString("base64")}\n`, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  console.info(`Created ${path.relative(repoRoot, keyPath)} (mode 0600).`);
}

function trustCaddy(): void {
  if (compose(["cp", "caddy:/data/caddy/pki/authorities/local/root.crt", caPath]) !== 0) {
    fail(
      "Could not copy Caddy's local CA. Start the stack first (`bun run dev:stack`), then retry.",
    );
  }
  console.info(`Caddy local CA written to ${path.relative(repoRoot, caPath)}.`);
  if (process.platform === "darwin") {
    spawnSync("open", [caPath], { stdio: "inherit" });
    console.info(
      "In Keychain Access, open the certificate, expand Trust, and set SSL to Always Trust.",
    );
    return;
  }
  console.info("Import that certificate into your browser or system trust store, then reload.");
}

/**
 * Reports the stacks that exist on this machine, and fails when an ephemeral one
 * is still running.
 *
 * The two long-lived stacks (`myownnotion-dev`, `myownnotion`) are reported as
 * allowed. Everything else is a stack somebody created for a feature or an
 * investigation: it must carry the ownership labels, and it must not survive the
 * session that created it. Reading only; reclaiming stays explicit and scoped so
 * that no audit can delete another agent's work.
 */
function auditStacks(): number {
  const ps = spawnSync(
    "docker",
    [
      "ps",
      "-a",
      "--format",
      '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.myownnotion.stack"}}\t{{.Label "com.myownnotion.ephemeral"}}\t{{.Image}}\t{{.Status}}',
    ],
    { encoding: "utf8" },
  );
  if (ps.error) fail(`docker is not available: ${ps.error.message}`);
  if (ps.status !== 0) fail(`docker ps failed: ${(ps.stderr ?? "").trim()}`);

  // Containers are only one kind of leftover. Images built by the e2e matrix,
  // temporary web builds and repository artefacts also accumulate, and none of
  // them is visible in `docker ps`: a session that removed its containers can
  // still have left gigabytes behind.
  const count = (command: string[]): number => {
    const result = spawnSync("docker", command, { encoding: "utf8" });
    return (result.stdout ?? "").split("\n").filter((line) => line.trim().length > 0).length;
  };
  const e2eImages = count(["images", "myownnotion-e2e-playwright", "-q"]);
  const dangling = count(["images", "-f", "dangling=true", "-q"]);
  const volumes = count(["volume", "ls", "-q"]);
  const temporaryRoot = process.env["TMPDIR"] ?? "/tmp";
  const tempDirectories = readdirSync(temporaryRoot).filter((entry) =>
    entry.startsWith("myownnotion-e2e-web-"),
  );
  const artefacts = ["coverage", "playwright-report", "test-results", ".e2e-logs"].filter(
    (directory) => existsSync(path.join(repoRoot, directory)),
  );

  const allowed = new Set(["myownnotion-dev", "myownnotion"]);
  const rows = (ps.stdout ?? "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [name = "", project = "", stack = "", ephemeral = "", image = "", status = ""] =
        line.split("\t");
      return { name, project, stack, ephemeral, image, status };
    });

  // Testcontainers starts its own reaper beside the containers it will remove;
  // it terminates itself and owns nothing, so failing on it would make the audit
  // red right after any disposable-database run.
  const reaper = (row: { readonly name: string }): boolean =>
    row.name.startsWith("testcontainers-ryuk-");
  const ephemeral = rows.filter((row) =>
    reaper(row) ? false : row.project !== "" ? !allowed.has(row.project) : row.name !== "",
  );
  // A project with nothing but a database is its own violation: it exists only
  // because somebody wanted "just a postgres" for a few minutes and never closed
  // it. Testing uses the matrix or a disposable database instead.
  const servicesByProject = new Map<string, string[]>();
  for (const row of rows) {
    if (row.project === "" || allowed.has(row.project)) continue;
    const services = servicesByProject.get(row.project) ?? [];
    services.push(row.image.split(":")[0] ?? "");
    servicesByProject.set(row.project, services);
  }
  const databaseOnly = [...servicesByProject.entries()]
    .filter(([, images]) => images.length > 0 && images.every((image) => image === "postgres"))
    .map(([project]) => project);
  console.info(`${rows.length} container(s) on this machine:`);
  for (const row of rows) {
    const ownership =
      row.project !== ""
        ? allowed.has(row.project)
          ? `allowed stack ${row.project}`
          : `EPHEMERAL stack ${row.project}`
        : "no compose project";
    const labels =
      row.stack === "" && row.ephemeral === ""
        ? "unlabelled"
        : `stack=${row.stack || "-"} ephemeral=${row.ephemeral || "-"}`;
    console.info(`  ${row.name} | ${ownership} | ${labels} | ${row.image} | ${row.status}`);
  }

  const unlabelledEphemeral = ephemeral.filter(
    (row) => row.project !== "" && row.ephemeral !== "true",
  );
  if (ephemeral.length > 0) {
    console.error(
      `\n${ephemeral.length} ephemeral stack(s) still exist. Reap them before the next run:`,
    );
    for (const row of ephemeral) {
      const project = row.project === "" ? null : row.project;
      console.error(
        project === null
          ? `  docker rm -f ${row.name}`
          : `  docker compose -p ${project} down -v --remove-orphans`,
      );
    }
    if (unlabelledEphemeral.length > 0) {
      console.error(
        `\n${unlabelledEphemeral.length} of them carry no com.myownnotion.ephemeral=true label; see docs/testing/parallel-stacks.md.`,
      );
    }
  }
  if (databaseOnly.length > 0) {
    console.error(
      `\n${databaseOnly.length} standalone database stack(s): ${databaseOnly.join(", ")}. A database is not a stack; use the matrix or a disposable database.`,
    );
  }
  if (ephemeral.length > 0) return 1;
  const leftovers = e2eImages + dangling + tempDirectories.length + artefacts.length;
  console.info(`\nimages: ${e2eImages} e2e build(s), ${dangling} dangling | volumes: ${volumes}`);
  console.info(
    `temporary e2e roots: ${tempDirectories.length} | repository artefacts: ${artefacts.length === 0 ? "none" : artefacts.join(", ")}`,
  );
  if (leftovers > 0) {
    console.error(
      `\n${leftovers} build leftover(s). Reclaim them explicitly; a blanket prune is forbidden:`,
    );
    if (e2eImages > 0) {
      console.error(
        "  docker images 'myownnotion-e2e-playwright' -q | sort -u | xargs -r docker rmi -f",
      );
    }
    if (dangling > 0) console.error("  docker image prune -f");
    if (tempDirectories.length > 0) {
      console.error(`  rm -rf ${temporaryRoot}/myownnotion-e2e-web-*`);
    }
    if (artefacts.length > 0) console.error(`  rm -rf ${artefacts.join(" ")}`);
  }
  if (ephemeral.length > 0 || leftovers > 0 || databaseOnly.length > 0) return 1;
  console.info("\nNo ephemeral stack and no build leftover: parallel-stacks rules 5 and 6 hold.");
  return 0;
}

const args = process.argv.slice(2);
if (args.includes("--audit")) {
  process.exit(auditStacks());
}
if (args.includes("--down")) {
  process.exit(compose(["down", "--remove-orphans"]));
}
if (args.includes("--reset")) {
  resetDevData();
  process.exit(0);
}
if (args.includes("--demo")) {
  seedKnowledgeGraphDemo();
  process.exit(0);
}
if (args.includes("--demo-repeat")) {
  for (let run = 1; run <= 10; run += 1) {
    console.info(`Knowledge Graph reset and generation proof ${run}/10.`);
    seedKnowledgeGraphDemo();
  }
  console.info("Ten complete Knowledge Graph demo generations passed.");
  process.exit(0);
}
if (args.includes("--trust") || args.includes("--ca")) {
  trustCaddy();
  process.exit(0);
}
if (args.includes("--logs")) {
  process.exit(compose(["logs", "-f", "--tail", "80"]));
}

ensureDeploymentKey();
const buildRequested = args.includes("--build");
if (compose([...(buildRequested ? upWithBuildArgs : upArgs)]) !== 0) {
  const logs = spawnSync("docker", ["compose", "-f", composeFile, "logs", "migrate"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const migrateOutput = `${logs.stdout ?? ""}${logs.stderr ?? ""}`;
  if (
    /KeyUnavailableError|could not be unwrapped|deployment key|protected data is unavailable/i.test(
      migrateOutput,
    )
  ) {
    fail(
      "Could not start the development stack: the deployment key no longer matches the existing Postgres data.\n" +
        "Reset the local dev volumes with:\n\n" +
        "  bun run dev:stack:reset\n",
    );
  }
  fail("Could not start the development stack.");
}
console.info("Stack is detached. Open http://localhost:8080 (Cursor) or https://localhost:8443");
console.info("Bun --watch and Vite HMR reload inside the containers.");
console.info(
  "Rebuild the dev image after Dockerfile or lockfile changes: bun run dev:stack --build",
);
console.info("Logs: bun run dev:stack:logs   Stop: bun run dev:stack:down");
console.info("System browsers: trust the local CA with `bun run dev:trust` if HTTPS warns.");
process.exit(0);
