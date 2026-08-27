import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string): string =>
  readFileSync(path.join(repoRoot, relativePath), "utf8");

describe("Bun quality gate", () => {
  it("keeps every workflow and composite action syntactically valid", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".github/actions/setup-bun/action.yml",
    ]) {
      expect(() => parse(read(file)), file).not.toThrow();
    }
  });

  it("installs exact Bun from an immutable action before frozen materialization", () => {
    const action = read(".github/actions/setup-bun/action.yml");
    expect(action).toContain("oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6");
    expect(action).toContain("bun-version: 1.4.0");
    expect(action).toContain("hashFiles('bun.lock')");
    expect(action.indexOf("run: bun ci")).toBeLessThan(
      action.indexOf('run: test "$(bun --version)" = "1.4.0"'),
    );
  });

  it("contains no retired runtime setup or executable workflow command", () => {
    const workflows = `${read(".github/workflows/ci.yml")}\n${read(
      ".github/workflows/release.yml",
    )}`;
    expect(workflows).not.toContain("actions/setup-node");
    expect(workflows).not.toContain("pnpm/action-setup");
    expect(workflows).not.toMatch(/^\s*(?:node|npx|npm|pnpm|yarn|corepack|tsx)\s/m);
  });

  it("runs Vitest in Bun threads with Istanbul and one shared PostgreSQL wrapper", () => {
    const config = read("vitest.config.ts");
    expect(config).toContain('pool: "threads"');
    expect(config).toContain('provider: "istanbul"');
    expect(config).toContain("statements: -2_216");
    expect(config).toContain("lines: -1_866");
    expect(config).toContain("functions: -337");
    expect(config).toContain("branches: -2_465");
    expect(config).not.toContain("globalSetup");
    expect(config).not.toContain('provider: "v8"');

    const wrapper = read("scripts/ci/run-vitest-with-postgres.ts");
    expect(wrapper).toContain("await startDisposablePostgres()");
    expect(wrapper).toContain("const child = Bun.spawn(");
    expect(wrapper).toContain('"run", "--bun", "vitest"');
  });

  it("retains the complete local gate behind one Bun command", () => {
    const manifest = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    const gate = manifest.scripts["checks:local"] ?? "";
    for (const command of [
      "toolchain:check",
      "shell:check",
      "lint:ci",
      "typecheck",
      "test:coverage",
      "test:performance",
      "test:integration",
      "db:test-migrations",
      "test:contract",
      "test:e2e:gate",
      "build",
      "images:build",
      "security:audit",
      "security:secrets",
      "security:static",
      "security:licenses",
      "compose:check",
    ]) {
      expect(gate, `checks:local lost ${command}`).toContain(`bun run ${command}`);
    }
  });
});
