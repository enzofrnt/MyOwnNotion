import { ChildProcess, spawn } from "node:child_process";
import { expect, it } from "vitest";
import { closeProcess } from "../../../tests/e2e/desktop-process.ts";
import { nativeShutdownEvidence } from "../../../tests/e2e/desktop-process-evidence.ts";

it("distinguishes a missing wrapper from a surviving Electron process", () => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 123 });
  const evidence = nativeShutdownEvidence(child, 456, "", (pid) => {
    if (pid === 123) throw Object.assign(new Error("private native detail"), { code: "ESRCH" });
  });
  expect(evidence.wrapper).toBe("absent");
  expect(evidence.electron).toBe("alive");
  expect(evidence.sameProcess).toBe(false);
  expect(evidence.exitObserved).toBe(false);
});

it("does not mistake unavailable OS probes for process exit or expose native text", () => {
  const child = new ChildProcess();
  Object.defineProperty(child, "pid", { value: 123 });
  const evidence = nativeShutdownEvidence(
    child,
    456,
    '{"stage":"quit","secret":"private"}\n{"stage":"private"}\ninvalid',
    () => {
      throw Object.assign(new Error("private"), { code: "EPERM" });
    },
  );
  expect(evidence.wrapper).toBe("unavailable");
  expect(evidence.electron).toBe("unavailable");
  expect(evidence.lifecycle).toEqual(["quit"]);
  expect(JSON.stringify(evidence)).not.toContain("private");
});

it("bounds lifecycle evidence even when its input contains many events", () => {
  const evidence = nativeShutdownEvidence(
    new ChildProcess(),
    -1,
    '{"stage":"ready"}\n'.repeat(1000),
    () => {
      throw new Error("must not probe");
    },
  );
  expect(evidence.lifecycle).toHaveLength(32);
  expect(evidence.electron).toBe("unavailable");
});

it("observes a real owned process before and after termination", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    expect(nativeShutdownEvidence(child, child.pid ?? -1, "").electron).toBe("alive");
    await closeProcess(child, async () => {
      child.kill();
    });
    const after = nativeShutdownEvidence(child, child.pid ?? -1, "");
    expect(after.electron).toBe("absent");
    expect(after.exitObserved).toBe(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
});
