/**
 * The stack audit is the executable part of article IX.
 *
 * `docs/testing/parallel-stacks.md` says a session ends with no ephemeral stack
 * and no temporary database. That claim is only worth something if the audit
 * really reads Docker and really fails, so these tests drive it with a controlled
 * `docker` on PATH rather than describing what it should do.
 */

import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/dev/stack.ts");

function audit(rows: readonly string[]) {
  const cwd = mkdtempSync(path.join(tmpdir(), "stack-audit-"));
  // The table is written byte-for-byte, tabs included: a shell printf would turn
  // the separator into a literal backslash-t and the audit would read one column.
  const table = path.join(cwd, "table.txt");
  writeFileSync(table, `${rows.join("\n")}\n`);
  const docker = path.join(cwd, "docker");
  writeFileSync(
    docker,
    `#!/bin/bash
if [[ "$1" == "ps" ]]; then
  cat ${JSON.stringify(table)}
  exit 0
fi
echo "unexpected docker call: $*" >&2
exit 2
`,
  );
  chmodSync(docker, 0o755);
  const result = spawnSync(process.execPath, [script, "--audit"], {
    cwd,
    // Both roots are the test's own directory: the audit must judge the state it
    // was given, never the developer's machine or the repository's own coverage
    // output.
    env: {
      ...process.env,
      PATH: `${cwd}:${process.env["PATH"]}`,
      TMPDIR: cwd,
      MYOWNNOTION_STACK_AUDIT_ROOT: cwd,
    },
    encoding: "utf8",
    timeout: 20_000,
  });
  return { result, output: `${result.stdout}${result.stderr}` };
}

describe("stack audit", () => {
  it("accepts the two long-lived stacks and fails on anything else", () => {
    const { result, output } = audit([
      "myownnotion-dev-api-1\tmyownnotion-dev\t\t\tmyownnotion/dev:local\tUp 2 hours",
      "myownnotion-postgres-1\tmyownnotion\t\t\tpostgres:18\tUp 2 hours",
    ]);
    expect(result.status, output).toBe(0);
    expect(output).toContain("allowed stack myownnotion-dev");
    expect(output).toContain("allowed stack myownnotion");
    expect(output).toContain("No ephemeral stack and no build leftover");
  });

  it("names the ephemeral stacks and prints the exact commands that reclaim them", () => {
    const { result, output } = audit([
      "myownnotion-dev-api-1\tmyownnotion-dev\t\t\tmyownnotion/dev:local\tUp 2 hours",
      "investigation-postgres-1\t059-investigation\t059-investigation\t\ttrue\tpostgres:18\tUp 3 days",
      "stray-probe\t\t\t\toven/bun:1.4.2\tUp 5 hours",
    ]);
    expect(result.status, output).toBe(1);
    expect(output).toContain("EPHEMERAL stack 059-investigation");
    expect(output).toContain("no compose project");
    expect(output).toContain("docker compose -p 059-investigation down -v --remove-orphans");
    expect(output).toContain("docker rm -f stray-probe");
    // The labelled stack is not reported as unlabelled; the stray one is.
    expect(output).toContain("1 of them carry no com.myownnotion.ephemeral=true label");
  });

  it("names a project that is nothing but a database, separately from other stacks", () => {
    const { result, output } = audit([
      "myownnotion-dev-api-1\tmyownnotion-dev\t\t\tmyownnotion/dev:local\tUp 2 hours",
      "lonely-postgres-1\t059-investigation\t059-investigation\ttrue\tpostgres:18\tUp 3 days",
    ]);
    expect(result.status, output).toBe(1);
    expect(output).toContain("1 standalone database stack(s): 059-investigation");
    expect(output).toContain("A database is not a stack; use the matrix or a disposable database.");
  });

  it("fails loudly when Docker cannot be read at all", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "stack-audit-broken-"));
    const docker = path.join(cwd, "docker");
    writeFileSync(docker, '#!/bin/bash\necho "Cannot connect to the Docker daemon" >&2\nexit 1\n');
    chmodSync(docker, 0o755);
    const result = spawnSync(process.execPath, [script, "--audit"], {
      cwd,
      env: {
        ...process.env,
        PATH: `${cwd}:${process.env["PATH"]}`,
        TMPDIR: cwd,
        MYOWNNOTION_STACK_AUDIT_ROOT: cwd,
      },
      encoding: "utf8",
      timeout: 20_000,
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("docker ps failed");
    // An audit that cannot read must never look like a clean machine.
    expect(readdirSync(cwd).length).toBeGreaterThan(0);
  });
});
