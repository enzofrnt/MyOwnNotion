import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const EXPECTED_BUN_VERSION = "1.4.0";

interface RootManifest {
  readonly packageManager?: string;
  readonly engines?: Record<string, string>;
  readonly workspaces?: readonly string[];
  readonly scripts?: Record<string, string>;
}

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("the canonical Bun toolchain", () => {
  const manifest = JSON.parse(read("package.json")) as RootManifest;

  it("pins and executes the exact supported Bun release", () => {
    expect(Bun.version).toBe(EXPECTED_BUN_VERSION);
    expect(manifest.packageManager).toBe(`bun@${EXPECTED_BUN_VERSION}`);
    expect(manifest.engines).toEqual({ bun: EXPECTED_BUN_VERSION });
    expect(manifest.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(read("bunfig.toml")).toMatch(/^\[run\]\s+bun\s*=\s*true\s*$/m);
  });

  it("pins LF line endings for every checkout", () => {
    expect(read(".gitattributes")).toMatch(/^\*\s+text=auto\s+eol=lf\s*$/m);
    expect(read(".editorconfig")).toMatch(/^end_of_line\s*=\s*lf\s*$/m);
  });

  it("commits one Bun lock and no retired package-manager metadata", () => {
    expect(existsSync(path.join(repoRoot, "bun.lock"))).toBe(true);
    for (const retired of [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "bun.lockb",
      ".npmrc",
    ]) {
      expect(existsSync(path.join(repoRoot, retired)), retired).toBe(false);
    }
  });

  it("uses Bun's built-in ws compatibility module instead of an npm fallback", () => {
    expect(Bun.resolveSync("ws", repoRoot)).toBe("ws");
    expect(read("package.json")).not.toContain("ws-npm");
    expect(read("bun.lock")).not.toContain("patchedDependencies");
  });

  it("exposes Bun-only canonical root commands", () => {
    const scripts = manifest.scripts ?? {};
    for (const name of [
      "toolchain:check",
      "dev",
      "build",
      "typecheck",
      "checks:local",
      "db:migrate",
      "admin",
    ]) {
      expect(scripts[name], `missing scripts.${name}`).toBeTypeOf("string");
    }

    const retiredCommand =
      /(?:^|(?:&&|\|\||;|\|)\s*)(?:node|npx|npm|pnpm|yarn|corepack|tsx)(?:\s|$)/;
    for (const [name, command] of Object.entries(scripts)) {
      expect(retiredCommand.test(command), `scripts.${name}: ${command}`).toBe(false);
    }
  });

  it("keeps maintained procedures free of retired executable commands", () => {
    const maintainedProcedures = [
      "README.md",
      "docs/development.md",
      "docs/architecture/backup.md",
      "docs/deployment/reverse-proxy.md",
      "specs/014-desktop-clients/quickstart.md",
      "specs/019-bun-toolchain/quickstart.md",
    ];
    const executableLine = /^\s*(?:\$\s*)?(?:node|npx|npm|pnpm|yarn|corepack|tsx)(?:\s|$)/m;
    const executableInline = /`(?:node|npx|npm|pnpm|yarn|corepack|tsx)\s+[^`]+`/;
    for (const file of maintainedProcedures) {
      const content = read(file);
      expect(executableLine.test(content), file).toBe(false);
      expect(executableInline.test(content), file).toBe(false);
    }
  });
});
