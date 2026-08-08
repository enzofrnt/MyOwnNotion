import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertRestoreGuardClear } from "../src/app.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("restore readiness guard", () => {
  it("allows startup when the configured guard is absent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-api-guard-"));
    roots.push(root);
    await expect(
      assertRestoreGuardClear(path.join(root, ".restore-in-progress")),
    ).resolves.toBeUndefined();
  });

  it("blocks startup with a redacted diagnostic while a restore guard exists", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mon-api-guard-"));
    roots.push(root);
    const guard = path.join(root, ".restore-in-progress");
    await mkdir(path.dirname(guard), { recursive: true });
    await writeFile(guard, JSON.stringify({ operationId: "private", databaseUrl: "secret" }));
    await expect(assertRestoreGuardClear(guard)).rejects.toThrow("restore is in progress");
    try {
      await assertRestoreGuardClear(guard);
    } catch (error) {
      expect(String(error)).not.toMatch(/private|secret|databaseUrl|mon-api-guard/);
    }
  });
});
