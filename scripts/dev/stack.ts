/**
 * Local HTTPS development stack (postgres + hot-reload API/web + Caddy).
 *
 * Starting (and resetting) the stack rebuilds images (`docker compose up
 * --build`). The Compose project then stays detached: file changes are
 * picked up by Bun `--watch` and Vite HMR inside the running containers —
 * not by rebuilding or restarting those containers.
 *
 * Usage:
 *   bun run dev:stack
 *   bun run dev:stack --logs
 *   bun run dev:stack --down
 *   bun run dev:stack --reset
 *   bun run dev:stack --demo
 *   bun run dev:stack --demo-repeat
 *   bun run dev:trust
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
const upArgs = ["up", "-d", "--build", "--wait", "--remove-orphans"] as const;

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
  if (compose([...upArgs]) !== 0) {
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

const args = process.argv.slice(2);
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
if (compose([...upArgs]) !== 0) {
  fail("Could not start the development stack.");
}
console.info("Stack is detached. Open http://localhost:8080 (Cursor) or https://localhost:8443");
console.info("Bun --watch and Vite HMR reload inside the containers.");
console.info("Logs: bun run dev:stack:logs   Stop: bun run dev:stack:down");
console.info("System browsers: trust the local CA with `bun run dev:trust` if HTTPS warns.");
process.exit(0);
