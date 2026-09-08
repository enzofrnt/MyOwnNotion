import type { ChildProcess } from "node:child_process";

/** Capture a refused native command without retrying it or replacing its error. */
export async function observeNativeCommand<T>(
  command: () => Promise<T>,
  report: () => Promise<void>,
): Promise<T> {
  try {
    return await command();
  } catch (error) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve()
          .then(report)
          .catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    throw error;
  }
}

const stages = new Set([
  "preload",
  "uncaught-exception",
  "process-exit",
  "stderr-close",
  "stderr-error",
  "will-finish-launching",
  "ready",
  "window-created",
  "before-quit",
  "will-quit",
  "quit",
]);

export function nativeShutdownEvidence(
  child: ChildProcess,
  electronPid: number,
  trace: string,
  probe: (pid: number) => unknown = (pid) => process.kill(pid, 0),
) {
  const status = (pid: number | undefined) => {
    if (pid === undefined || !Number.isSafeInteger(pid) || pid <= 0) return "unavailable";
    try {
      probe(pid);
      return "alive";
    } catch (error) {
      return error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ESRCH"
        ? "absent"
        : "unavailable";
    }
  };
  const lifecycle: string[] = [];
  const pipe = (name: "stdout" | "stderr") => {
    try {
      const stream = child[name];
      return { destroyed: stream?.destroyed === true, ended: stream?.readableEnded === true };
    } catch {
      return "unavailable";
    }
  };
  for (const line of trace.slice(0, 4096).split("\n").slice(0, 32)) {
    try {
      const item: unknown = JSON.parse(line);
      if (
        item !== null &&
        typeof item === "object" &&
        "stage" in item &&
        typeof item.stage === "string" &&
        stages.has(item.stage)
      )
        lifecycle.push(item.stage);
    } catch {
      // Incomplete or unavailable diagnostic data cannot replace the test error.
    }
  }
  return {
    wrapper: status(child.pid),
    electron: status(electronPid),
    sameProcess: child.pid === electronPid,
    exitObserved: child.exitCode !== null || child.signalCode !== null,
    stdout: pipe("stdout"),
    stderr: pipe("stderr"),
    lifecycle,
  };
}
