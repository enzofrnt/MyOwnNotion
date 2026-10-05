import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

function runProject(args: string[], failShard = "") {
  const directory = mkdtempSync(path.join(tmpdir(), "myownnotion-project-runner-"));
  const log = path.join(directory, "commands");
  try {
    // Record the commands actually launched without starting a browser or API.
    writeFileSync(
      path.join(directory, "bun"),
      `#!/usr/bin/env bash
printf '%s\\0' "$@" >> "$RUNNER_COMMAND_LOG"
printf '\\n' >> "$RUNNER_COMMAND_LOG"
for argument in "$@"; do
  if [[ -n "$RUNNER_FAIL_SHARD" && "$argument" == "--shard=$RUNNER_FAIL_SHARD" ]]; then
    exit 23
  fi
done
`,
      { mode: 0o755 },
    );
    const result = spawnSync("bash", ["scripts/e2e/run-container-project.sh", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}`,
        RUNNER_COMMAND_LOG: log,
        RUNNER_FAIL_SHARD: failShard,
      },
    });
    if (result.error !== undefined) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      commands: existsSync(log)
        ? readFileSync(log, "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => line.split("\0").slice(0, -1))
        : [],
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const playwright = ["run", "--bun", "playwright", "test", "--fail-on-flaky-tests"];

describe("shared E2E project runner", () => {
  it.each(["webkit-desktop", "webkit-mobile"])(
    "runs %s in three fresh processes with the exact selected journeys",
    (project) => {
      const args = [
        `--project=${project}`,
        "tests/e2e/protected-files.spec.ts",
        "tests/e2e/database-entry-properties.spec.ts",
        "--retries=0",
      ];
      const result = runProject(args);
      expect(result.status).toBe(0);
      expect(result.commands).toEqual(
        ["1/3", "2/3", "3/3"].map((shard) => [...playwright, ...args, `--shard=${shard}`]),
      );
    },
  );

  it.each(["chromium-desktop", "chromium-mobile", "firefox-desktop"])(
    "keeps %s in one invocation without changing its selection",
    (project) => {
      const args = ["--project", project, "tests/e2e/protected-files.spec.ts"];
      const result = runProject(args);
      expect(result.status).toBe(0);
      expect(result.commands).toEqual([[...playwright, ...args]]);
    },
  );

  it.each([["--grep", "protects a UI attachment"], ["--shard=1/1"], ["--list"]])(
    "preserves an explicit diagnostic invocation %j",
    (...diagnostic) => {
      const args = ["--project=webkit-desktop", ...diagnostic];
      const result = runProject(args);
      expect(result.status).toBe(0);
      expect(result.commands).toEqual([[...playwright, ...args]]);
    },
  );

  it("propagates failure and never retries or runs a later shard", () => {
    const args = ["--project=webkit-mobile", "tests/e2e/protected-files.spec.ts"];
    const result = runProject(args, "2/3");
    expect(result.status).toBe(23);
    expect(result.commands).toEqual([
      [...playwright, ...args, "--shard=1/3"],
      [...playwright, ...args, "--shard=2/3"],
    ]);
    expect(result.stdout).not.toContain("shard 3/3");
  });

  it("rejects a missing project argument before launching tests", () => {
    const result = runProject(["--project"]);
    expect(result.status).toBe(1);
    expect(result.commands).toEqual([]);
  });

  it("wires CI to the same runner and exact impact-plan selection as local Linux", () => {
    const workflow = readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const step = workflow.split("- name: Run selected journeys in this isolated project")[1];
    expect(step).toBeDefined();
    const run = step?.split("- uses: actions/upload-artifact@")[0];
    expect(run).toContain("jq -r '.e2e.testFiles[]' test-impact.json");
    expect(run).toContain("bash scripts/e2e/run-container-project.sh");
    expect(run).toContain(`--project="$PLAYWRIGHT_PROJECT" "\${journeys[@]}"`);
    expect(run).not.toContain("bun run --bun playwright test");
  });
});
