import path from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "win32")(
  "retains independent Windows handles after extra pipe cleanup",
  async () => {
    const child = Bun.spawn(
      [process.execPath, path.join(import.meta.dirname, "fixtures/windows-stdio-ownership.ts")],
      {
        env: { ...process.env, BUN_GARBAGE_COLLECTOR_LEVEL: "1" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
      },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ status, stderr, stdout: stdout.trim() }).toEqual({
      status: 0,
      stderr: "",
      stdout: JSON.stringify({ pipes: 9, independentFiles: 96 }),
    });
  },
  20_000,
);
