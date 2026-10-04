import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTrackedTextFile } from "../../scripts/ci/tracked-files.ts";

describe("tracked source reads for security scanning", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "myownnotion-tracked-read-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads ordinary tracked source without dropping credential-shaped content", () => {
    const source = `const probe = "ghp_${"A".repeat(40)}";`;
    writeFileSync(path.join(root, "source.ts"), source);
    expect(readTrackedTextFile(root, "source.ts", 4_096)).toBe(source);
  });

  it("reads the agent directory link as its tracked path while its files remain readable", () => {
    mkdirSync(path.join(root, ".agents"));
    writeFileSync(path.join(root, ".agents", "SKILL.md"), "maintained guidance");
    const target = process.platform === "win32" ? path.join(root, ".agents") : ".agents";
    symlinkSync(target, path.join(root, ".codex"), "junction");
    const link = readTrackedTextFile(root, ".codex", 4_096);
    expect(path.basename(link ?? "")).toBe(".agents");
    if (process.platform !== "win32") expect(link).toBe(".agents");
    expect(readTrackedTextFile(root, ".agents/SKILL.md", 4_096)).toBe("maintained guidance");
  });

  it("does not follow a tracked link into untracked private content", () => {
    const external = mkdtempSync(path.join(os.tmpdir(), "myownnotion-untracked-target-"));
    try {
      writeFileSync(path.join(external, "private.txt"), "untracked private content");
      symlinkSync(external, path.join(root, "external"), "junction");
      const link = readTrackedTextFile(root, "external", 4_096);
      expect(path.basename(link ?? "")).toBe(path.basename(external));
      expect(link).not.toContain("untracked private content");
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });

  it("retains the size bound and fails when a tracked file cannot be read", () => {
    writeFileSync(path.join(root, "large.txt"), "x".repeat(10));
    expect(readTrackedTextFile(root, "large.txt", 9)).toBeUndefined();
    expect(() => readTrackedTextFile(root, "missing.txt", 4_096)).toThrow();
  });
});
