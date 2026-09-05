import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateUuidV7 } from "@myownnotion/domain";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  type LegacyFileSource,
  readLegacyFileSource,
  retireLegacyFileSource,
} from "../src/security/file-storage-source.ts";

let root: string;
const bytes = Buffer.from("recoverable historical source");
const digest = createHash("sha256").update(bytes).digest("hex");
const relativePath = `ab/${"ab".repeat(32)}`;
const original: LegacyFileSource = {
  kind: "content",
  objectId: generateUuidV7(),
  path: relativePath,
  byteLength: bytes.length,
  sha256: digest,
};
async function consume(source: LegacyFileSource) {
  const chunks: Buffer[] = [];
  for await (const chunk of readLegacyFileSource(root, source)) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mon-source-contract-"));
  await mkdir(join(root, "ab"));
  await writeFile(join(root, relativePath), bytes);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("refuses corrupt inventory before returning bytes or removing the source", async () => {
  for (const changed of [
    { byteLength: -1 },
    { byteLength: 1.5 },
    { byteLength: Number.MAX_SAFE_INTEGER + 1 },
    { sha256: "not-a-digest" },
    { path: "../outside" },
    { path: "/etc/passwd" },
    { byteLength: bytes.length + 1 },
    { byteLength: bytes.length - 1 },
    { sha256: "00".repeat(32) },
  ]) {
    const source = { ...original, ...changed };
    await expect(consume(source)).rejects.toThrow();
    await expect(retireLegacyFileSource(root, source)).rejects.toThrow();
    expect(await readFile(join(root, relativePath))).toEqual(bytes);
  }
});

it("does not need a physical file for an unacknowledged empty upload, but authenticates its empty digest", async () => {
  const source: LegacyFileSource = {
    ...original,
    kind: "upload",
    path: `uploads/${generateUuidV7()}`,
    byteLength: 0,
    sha256: createHash("sha256").digest("hex"),
  };
  expect(await consume(source)).toEqual(Buffer.alloc(0));
  await expect(consume({ ...source, sha256: digest })).rejects.toThrow("empty upload digest");
});

it("does not follow a replaced store directory or retire an unexpected file type", async () => {
  const outside = await mkdtemp(join(tmpdir(), "mon-source-outside-"));
  try {
    await writeFile(join(outside, "ab".repeat(32)), bytes);
    await rm(join(root, "ab"), { recursive: true });
    await symlink(outside, join(root, "ab"));
    await expect(consume(original)).rejects.toThrow("symlinks");
    await expect(retireLegacyFileSource(root, original)).rejects.toThrow("symlinks");
    expect(await readFile(join(outside, "ab".repeat(32)))).toEqual(bytes);
    await rm(join(root, "ab"));
    await mkdir(join(root, relativePath), { recursive: true });
    await expect(retireLegacyFileSource(root, original)).rejects.toThrow("Unsafe historical");
    await rm(join(root, relativePath), { recursive: true });
    await symlink(join(outside, "ab".repeat(32)), join(root, relativePath));
    await expect(retireLegacyFileSource(root, original)).rejects.toThrow("Unsafe historical");
    expect(await readFile(join(outside, "ab".repeat(32)))).toEqual(bytes);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

it("retries source retirement after unlink, including a parent directory already removed", async () => {
  await retireLegacyFileSource(root, original);
  await retireLegacyFileSource(root, original);
  await expect(readFile(join(root, relativePath))).rejects.toMatchObject({ code: "ENOENT" });
  await rm(join(root, "ab"), { recursive: true });
  await expect(retireLegacyFileSource(root, original)).resolves.toBeUndefined();
});
