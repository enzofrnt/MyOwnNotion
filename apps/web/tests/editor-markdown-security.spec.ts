import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const fixture = "tests/fixtures/tiptap-markdown-security-fixture.ts";

async function runFixture(mode: string): Promise<string> {
  const result = await run(process.execPath, [fixture, mode], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    // Leave a small margin under Vitest's default five-second test deadline;
    // the child itself is still hard-killed and cannot pin the test runner.
    timeout: 4_500,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

describe("Tiptap Markdown parser security boundary", () => {
  it("keeps ordinary quoted attributes working", async () => {
    await expect(runFixture("ordinary")).resolves.toBe("ordinary-ok");
  });

  it.each(["atom-block", "block-block", "inline"])(
    "finishes crafted %s input within the subprocess deadline",
    async (mode) => {
      await expect(runFixture(mode)).resolves.toBe(`${mode}-ok`);
    },
  );
});
