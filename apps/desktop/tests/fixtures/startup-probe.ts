// Test-only preload: observe native startup without changing the application
// entry point, handling errors, delaying readiness or retrying a failed launch.
import { type EventEmitter, errorMonitor } from "node:events";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";

const destination = process.env["MYOWNNOTION_DESKTOP_STARTUP_TRACE"];
if (destination !== undefined && path.isAbsolute(destination)) {
  let count = 0;
  const record = (stage: string, status?: number) => {
    if (count >= 32) return;
    count += 1;
    try {
      appendFileSync(
        destination,
        `${JSON.stringify({ stage, ...(status === undefined ? {} : { status }) })}\n`,
      );
    } catch {
      // An unavailable diagnostic must not change startup or exception behavior.
    }
  };
  record("preload");
  process.once("uncaughtExceptionMonitor", () => record("uncaught-exception"));
  process.once("exit", (status) => record("process-exit", status));
  process.stderr.once("close", () => record("stderr-close"));
  const stderrEvents: EventEmitter = process.stderr;
  stderrEvents.once(errorMonitor, () => record("stderr-error"));
  app.once("will-finish-launching", () => record("will-finish-launching"));
  app.once("ready", () => record("ready"));
  app.once("browser-window-created", () => record("window-created"));
  app.once("before-quit", () => record("before-quit"));
  app.once("will-quit", () => record("will-quit"));
  app.once("quit", () => record("quit"));
}
