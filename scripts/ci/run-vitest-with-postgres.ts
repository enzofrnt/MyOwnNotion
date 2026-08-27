import { readdirSync } from "node:fs";
import process from "node:process";
import { startDisposablePostgres } from "@myownnotion/test-utils";
import { planVitestInvocations, usesVitestProject } from "./vitest-run-plan.js";

const inheritedDatabaseUrl = process.env["TEST_DATABASE_URL"];
const postgres =
  inheritedDatabaseUrl === undefined || inheritedDatabaseUrl.length === 0
    ? await startDisposablePostgres()
    : null;
const databaseUrl = inheritedDatabaseUrl ?? postgres?.connectionString;

if (databaseUrl === undefined) {
  throw new Error("The shared PostgreSQL test server did not provide a connection URL");
}

const vitestArguments = process.argv.slice(2);
const usesPerformanceProject = usesVitestProject(vitestArguments, "performance");
const discoveredPerformanceTests = usesPerformanceProject
  ? readdirSync("tests/performance", { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
      .map((entry) => `tests/performance/${entry.name}`)
  : [];
const vitestInvocations = planVitestInvocations(vitestArguments, discoveredPerformanceTests);

type VitestChild = ReturnType<typeof Bun.spawn>;
let activeChild: VitestChild | null = null;

function spawnVitest(arguments_: string[]): VitestChild {
  const child = Bun.spawn(
    [
      process.execPath,
      ...(usesPerformanceProject ? ["--smol"] : []),
      "run",
      "--bun",
      "vitest",
      ...arguments_,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TEST_DATABASE_URL: databaseUrl,
      },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  activeChild = child;
  return child;
}

let interrupted = false;
function forwardSignal(signal: NodeJS.Signals): void {
  interrupted = true;
  activeChild?.kill(signal);
}

interface SignalProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  off(event: "SIGINT" | "SIGTERM", listener: () => void): void;
}
const signalProcess = process as unknown as SignalProcess;
const forwardSigint = (): void => forwardSignal("SIGINT");
const forwardSigterm = (): void => forwardSignal("SIGTERM");

signalProcess.once("SIGINT", forwardSigint);
signalProcess.once("SIGTERM", forwardSigterm);

let exitCode = 0;
try {
  for (const [index, invocation] of vitestInvocations.entries()) {
    if (interrupted) {
      exitCode = 130;
      break;
    }
    if (vitestInvocations.length > 1) {
      const testPath = invocation.find((argument) => argument.startsWith("tests/performance/"));
      console.info(
        `Running isolated performance benchmark ${index + 1}/${vitestInvocations.length}: ${String(testPath)}`,
      );
    }
    const child = spawnVitest(invocation);
    exitCode = await child.exited;
    activeChild = null;
    if (exitCode !== 0) break;
  }
} finally {
  signalProcess.off("SIGINT", forwardSigint);
  signalProcess.off("SIGTERM", forwardSigterm);
  await postgres?.stop();
}

process.exit(interrupted && exitCode === 0 ? 130 : exitCode);
