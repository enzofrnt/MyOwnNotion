/**
 * The stable sealed form of an archive, in memory and on disk (FR-007).
 *
 * The streaming writer reserves sixteen bytes for the authentication tag before
 * it exists and seeks back to fill them; the in-memory form simply concatenates.
 * Both framings must open to the same plaintext, and neither may open anything
 * that was truncated or altered in transit.
 */

import { randomBytes } from "node:crypto";
import { mkdtempSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  openBackupArchive,
  sealBackupArchive,
  sealBackupArchiveFile,
} from "../src/backup/archive-crypto.ts";

const KEY = randomBytes(32);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function scratch(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "mon-archive-crypto-"));
  roots.push(root);
  return root;
}

describe("the in-memory sealed framing", () => {
  it("opens to exactly what was sealed", () => {
    const plaintext = Buffer.from("tonight's archive");
    expect(openBackupArchive(KEY, sealBackupArchive(KEY, plaintext))).toEqual(plaintext);
  });

  it("refuses a body too short to hold a nonce and a tag", () => {
    // Twenty-seven bytes is one short of the smallest legal framing; anything
    // that small cannot name its own nonce and tag, so there is nothing to try.
    expect(() => openBackupArchive(KEY, randomBytes(27))).toThrow(/truncated/);
  });

  it("refuses bytes that were altered after sealing", () => {
    const sealed = sealBackupArchive(KEY, Buffer.from("intact"));
    const last = sealed.length - 1;
    sealed[last] = (sealed[last] ?? 0) ^ 0x01;
    // GCM authenticates the whole body: one flipped bit is not a corrupt byte,
    // it is proof somebody rewrote the archive.
    expect(() => openBackupArchive(KEY, sealed)).toThrow();
  });

  it("refuses a key other than the one that sealed the archive", () => {
    const sealed = sealBackupArchive(KEY, Buffer.from("sealed under KEY"));
    expect(() => openBackupArchive(randomBytes(32), sealed)).toThrow();
  });
});

describe("sealing a staged file", () => {
  it("produces the same framing the in-memory sealer does", async () => {
    const root = scratch();
    const plaintextPath = path.join(root, "plain.bin");
    const sealedPath = path.join(root, "sealed.bin");
    const plaintext = randomBytes(5000);
    await writeFile(plaintextPath, plaintext);

    await sealBackupArchiveFile(KEY, plaintextPath, sealedPath);
    expect(openBackupArchive(KEY, await readFile(sealedPath))).toEqual(plaintext);
  });

  it("removes the sealed file when the plaintext cannot be read", async () => {
    const root = scratch();
    const sealedPath = path.join(root, "sealed.bin");
    // A half-sealed archive that kept its name would look like tonight's
    // backup; the failure reported is the missing plaintext, not the cleanup.
    await expect(
      sealBackupArchiveFile(KEY, path.join(root, "absent.bin"), sealedPath),
    ).rejects.toThrow(/ENOENT/);
    expect(() => statSync(sealedPath)).toThrow();
  });
});
