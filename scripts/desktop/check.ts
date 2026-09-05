/** Local native equivalent of the desktop CI job, with real lifecycle journeys. */
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const run = async (args: string[]) => {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error(`Desktop gate failed: bun ${args.join(" ")}`);
};
await run(["run", "desktop:build"]);
await run(["run", "--filter", "@myownnotion/desktop", "package"]);
await run(["run", "desktop:smoke"]);
process.env["MYOWNNOTION_DESKTOP_E2E"] = "1";
await run(["scripts/e2e/run-local-matrix.ts", "--project=chromium-desktop", "tests/e2e/desktop-"]);
