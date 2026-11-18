import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "../..");
const helper = path.join(root, "scripts/ci/trace-filesystem-failure.sh");
const syscalls =
  "openat,close,dup,dup2,dup3,fcntl,newfstatat,statx,readlink,readlinkat,unlink,unlinkat,rename,renameat,renameat2,read,pread64";

function run(group: string, exit: number) {
  const cwd = mkdtempSync(path.join(tmpdir(), "filesystem-trace-"));
  for (const [name, source] of Object.entries({
    strace: `#!/bin/bash
printf '%s\\n' "$@" > "$PWD/invocation"
while [[ "$1" != '-o' ]]; do shift; done
shift
output=$1
shift
printf 'metadata-only trace\\n' > "$output"
"$@"
`,
    bun: `#!/bin/bash
printf '%s\\n' "$@" > "$PWD/child-invocation"
echo 'child finished'
exit ${exit}
`,
  })) {
    const file = path.join(cwd, name);
    writeFileSync(file, source);
    chmodSync(file, 0o755);
  }
  const result = spawnSync("bash", [helper, group], {
    cwd,
    env: { ...process.env, PATH: `${cwd}:${process.env["PATH"]}` },
    timeout: 10_000,
    encoding: "utf8",
  });
  return { cwd, result };
}

describe("failure-only filesystem evidence", () => {
  for (const group of ["unit", "contract"]) {
    it(`traces exactly ${group}, retains failure and compresses evidence`, () => {
      const { cwd, result } = run(group, 37);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(37);
      expect(readFileSync(path.join(cwd, "invocation"), "utf8").trim().split("\n")).toEqual([
        "-f",
        "-ttt",
        "-T",
        "-s",
        "256",
        "-e",
        `trace=${syscalls}`,
        "-e",
        "raw=read,pread64",
        "-o",
        `filesystem-trace-${group}/trace.pipe`,
        "bun",
        "run",
        "ci:test:affected",
        "--plan",
        "test-impact.json",
        "--group",
        group,
      ]);
      expect(readFileSync(path.join(cwd, "child-invocation"), "utf8")).toBe(
        `run\nci:test:affected\n--plan\ntest-impact.json\n--group\n${group}\n`,
      );
      const out = path.join(cwd, `filesystem-trace-${group}`);
      expect(readFileSync(path.join(out, "status.txt"), "utf8")).toContain("diagnostic_exit=37");
      expect(gunzipSync(readFileSync(path.join(out, "syscalls.log.gz"))).toString()).toBe(
        "metadata-only trace\n",
      );
      expect(gunzipSync(readFileSync(path.join(out, "diagnostic.log.gz"))).toString()).toBe(
        "child finished\n",
      );
    });
  }

  it("names an unavailable tracer instead of reporting a correction", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "filesystem-trace-missing-"));
    // A controlled PATH has mkdir but deliberately no strace.
    const mkdir = path.join(cwd, "mkdir");
    writeFileSync(mkdir, '#!/bin/bash\n/bin/mkdir "$@"\n');
    chmodSync(mkdir, 0o755);
    const result = spawnSync("/bin/bash", [helper, "contract"], {
      cwd,
      env: { ...process.env, PATH: cwd },
      timeout: 10_000,
    });
    expect(result.status).toBe(127);
    const status = readFileSync(path.join(cwd, "filesystem-trace-contract/status.txt"), "utf8");
    expect(status).toContain("capture_unavailable=strace missing");
    expect(status).toContain("diagnostic_exit=127");
  });

  it("does not mislabel a successful diagnostic as a fixed gate", () => {
    const { cwd, result } = run("unit", 0);
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(cwd, "filesystem-trace-unit/status.txt"), "utf8")).toContain(
      "purpose=diagnostic rerun, not a fixed gate",
    );
  });

  it("keeps original gates blocking and only diagnoses their own failed group", () => {
    const workflow = parse(readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8"));
    for (const group of ["unit", "contract"]) {
      const job = workflow.jobs[group];
      const original = job.steps.find((step: { id?: string }) => step.id === "original-tests");
      expect(original.run).toBe(
        `bun run ci:test:affected --plan test-impact.json --group ${group}`,
      );
      expect(original["continue-on-error"]).toBeUndefined();
      const diagnostic = job.steps.find((step: { name?: string }) =>
        step.name?.startsWith("Diagnostic rerun"),
      );
      expect(diagnostic.if).toBe("failure() && steps.original-tests.outcome == 'failure'");
      expect(diagnostic["continue-on-error"]).toBe(true);
      expect(diagnostic["timeout-minutes"]).toBe(20);
      expect(diagnostic.run).toContain(`trace-filesystem-failure.sh ${group}`);
      expect(diagnostic.run).toContain("sudo apt-get install -y strace");
      const artifact = job.steps.find((step: { with?: { name?: string } }) =>
        step.with?.name?.startsWith("filesystem-trace-"),
      );
      expect(artifact.with.name).toBe(
        `filesystem-trace-${group}-attempt-\${{ github.run_attempt }}`,
      );
      expect(artifact.if).toBe("always() && steps.original-tests.outcome == 'failure'");
    }
  });
});
