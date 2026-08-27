import process from "node:process";
import { startDisposablePostgres } from "@myownnotion/test-utils";

const inheritedDatabaseUrl = process.env["TEST_DATABASE_URL"];
const postgres =
  inheritedDatabaseUrl === undefined || inheritedDatabaseUrl.length === 0
    ? await startDisposablePostgres()
    : null;
const databaseUrl = inheritedDatabaseUrl ?? postgres?.connectionString;

if (databaseUrl === undefined) {
  throw new Error("The shared PostgreSQL test server did not provide a connection URL");
}

const child = Bun.spawn([process.execPath, "run", "--bun", "vitest", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    TEST_DATABASE_URL: databaseUrl,
  },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

let interrupted = false;
function forwardSignal(signal: NodeJS.Signals): void {
  interrupted = true;
  child.kill(signal);
}

interface SignalProcess {
  once(event: "SIGINT" | "SIGTERM", listener: (signal: NodeJS.Signals) => void): void;
  off(event: "SIGINT" | "SIGTERM", listener: (signal: NodeJS.Signals) => void): void;
}
const signalProcess = process as unknown as SignalProcess;

signalProcess.once("SIGINT", forwardSignal);
signalProcess.once("SIGTERM", forwardSignal);

let exitCode = 1;
try {
  exitCode = await child.exited;
} finally {
  signalProcess.off("SIGINT", forwardSignal);
  signalProcess.off("SIGTERM", forwardSignal);
  await postgres?.stop();
}

process.exit(interrupted && exitCode === 0 ? 130 : exitCode);
