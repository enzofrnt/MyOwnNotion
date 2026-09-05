import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { ensureVaultFormat } from "../src/vault-migrations.ts";

it("persists the supported format and refuses corrupt or newer formats without overwriting data", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mon-vault-format-"));
  try {
    await ensureVaultFormat(directory);
    await ensureVaultFormat(directory);
    const file = path.join(directory, "vault-format.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ schemaVersion: 1 });
    for (const unsupported of [
      '{"schemaVersion":2}',
      '{"schemaVersion":',
      '{"schemaVersion":0,"inProgress":1}',
    ]) {
      await writeFile(file, unsupported);
      await expect(ensureVaultFormat(directory)).rejects.toThrow();
      expect(await readFile(file, "utf8")).toBe(unsupported);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
