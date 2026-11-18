import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import LoaderDiagnosticsReporter, {
  readLoaderDiagnostic,
} from "../../scripts/ci/vitest-loader-diagnostics.js";

function temporary(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "vitest-loader-diagnostics-"));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("Vitest loader diagnostics", () => {
  it("reads regular and missing files without reading contents", () => {
    temporary((directory) => {
      const file = join(directory, "regular.ts");
      writeFileSync(file, "private contents never emitted");
      const diagnostic = readLoaderDiagnostic(file);
      expect(diagnostic.module.lstat).toEqual({ code: null, exists: true, type: "file" });
      expect(diagnostic.module.stat).toEqual({ code: null, exists: true, type: "file" });
      expect(diagnostic.module.nativeRealpath).toEqual({
        code: null,
        exists: true,
        resolvedPath: diagnostic.module.realpath.resolvedPath,
      });
      expect(diagnostic.parents[0]?.stat).toEqual({ code: null, exists: true, type: "directory" });
      expect(JSON.stringify(diagnostic)).not.toContain("private contents");
      const missing = readLoaderDiagnostic(join(directory, "missing.ts"));
      for (const result of [
        missing.module.lstat,
        missing.module.stat,
        missing.module.nativeRealpath,
        missing.module.realpath,
      ]) {
        expect(result).toEqual({ code: "ENOENT", exists: false });
      }
    });
  });

  it("runs every reader independently even when native realpath fails", () => {
    const calls: string[] = [];
    const diagnostic = readLoaderDiagnostic("/module.ts", "/", {
      lstat: () => {
        calls.push("lstat");
        throw Object.assign(new Error(), { code: "EACCES" });
      },
      stat: () => {
        calls.push("stat");
        throw Object.assign(new Error(), { code: "ENOENT" });
      },
      nativeRealpath: () => {
        calls.push("native");
        throw Object.assign(new Error(), { code: "ENOENT" });
      },
      realpath: (path) => {
        calls.push("realpath");
        return path;
      },
    });
    expect(calls).toEqual([
      "lstat",
      "stat",
      "native",
      "realpath",
      "lstat",
      "stat",
      "native",
      "realpath",
    ]);
    expect(diagnostic.module.lstat).toEqual({ code: "EACCES", exists: null });
    expect(diagnostic.module.realpath).toEqual({
      code: null,
      exists: true,
      resolvedPath: "/module.ts",
    });
  });

  it("ignores non-loader errors and never changes errors when callbacks fail", () => {
    const errors = [{ name: "Error", message: "original", code: "ENOENT" }];
    let calls = 0;
    const reporter = new LoaderDiagnosticsReporter({}, () => {
      calls++;
      throw new Error("output failed");
    });
    const module = { moduleId: resolve("failed.spec.ts"), errors: () => errors };
    expect(() => reporter.onTestModuleEnd(module)).not.toThrow();
    expect(calls).toBe(1);
    expect(module.errors()).toBe(errors);
    expect(errors[0]?.message).toBe("original");
    reporter.onTestModuleEnd({
      moduleId: resolve("assertion.spec.ts"),
      errors: () => [{ name: "Error", message: "assertion failed" }],
    });
    reporter.onTestModuleEnd(module);
    expect(calls).toBe(1);
    expect(() =>
      new LoaderDiagnosticsReporter(
        {},
        () => {},
        () => {
          throw new Error("reader failed");
        },
      ).onTestModuleEnd(module),
    ).not.toThrow();
  });

  it("is invoked by Vitest for a missing import and preserves the failed child exit", () => {
    temporary((directory) => {
      const fixture = join(directory, "missing-import.spec.ts");
      // A missing import whose ENOENT loader error is produced deterministically by Vite.
      writeFileSync(fixture, 'import "./absent.ts";\n');
      const config = join(directory, "vitest.config.ts");
      // Ordinary unresolved imports use ERR_MODULE_NOT_FOUND, not ENOENT. This
      // resolver supplies an absent disk ID so the actual loader attempts I/O.
      writeFileSync(
        config,
        `import { readFileSync } from "node:fs";
export default { plugins: [{ name: "missing-disk-import", resolveId(id) { if (id === "./absent.ts") return ${JSON.stringify(join(directory, "absent.ts"))}; }, load(id) { if (id.endsWith("/absent.ts")) return readFileSync(id, "utf8"); } }], test: { root: ${JSON.stringify(directory)}, include: ["*.spec.ts"], reporters: ["default", ${JSON.stringify(resolve("scripts/ci/vitest-loader-diagnostics.ts"))}] } };`,
      );
      const child = spawnSync(
        process.execPath,
        ["--run", resolve("node_modules/vitest/vitest.mjs"), "run", "--config", config],
        { encoding: "utf8", timeout: 60_000 },
      );
      const output = child.stdout + child.stderr;
      expect(child.error).toBeUndefined();
      expect(child.status, output).toBe(1);
      expect(output).toContain("[vitest-loader-diagnostics]");
      const records = output
        .split("\n")
        .filter((line) => line.startsWith("[vitest-loader-diagnostics] "));
      expect(records).toHaveLength(1);
      const diagnostic = JSON.parse(
        (records[0] ?? "").slice("[vitest-loader-diagnostics] ".length),
      );
      // macOS /var is a symlink to /private/var; Vitest may canonicalize the ID.
      expect(diagnostic.module.path.endsWith("/missing-import.spec.ts")).toBe(true);
      expect(diagnostic.module.stat).toEqual({ code: null, exists: true, type: "file" });
      expect(output).toContain("ENOENT");
      const baseline = spawnSync(
        process.execPath,
        [
          "--run",
          resolve("node_modules/vitest/vitest.mjs"),
          "run",
          "--config",
          config,
          "--reporter",
          "default",
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      expect(baseline.error).toBeUndefined();
      expect(baseline.status, baseline.stdout + baseline.stderr).toBe(child.status);
      expect(baseline.stdout + baseline.stderr).not.toContain("[vitest-loader-diagnostics]");
    });
  });
});
